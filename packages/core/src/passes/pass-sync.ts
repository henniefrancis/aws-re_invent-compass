// Pass_Sync for the pass side (boarding-passes, S4, Requirement 4).
//
// diffSchedule is a pure diff of the resolved sessions against the Issued_Pass_Record,
// keyed on the session code, into exactly four cases: added, changed, cancelled and
// unchanged. syncPasses drives the Compass_Client from that plan (issue the added ones in
// chunks, PUT the changed ones, void the cancelled ones, touch nothing else) and writes the
// resulting record after every completed operation, so a failure part-way keeps the
// progress already made.
//
// Every pass the run could need (each scheduled session, added, changed or unchanged, with
// its neighbours, which the injected builder resolves) is built before the first API call,
// so a session that cannot be turned into a pass stops the sync with zero calls made: it
// fails closed rather than voiding a pass for a session that is still on the schedule.
//
// Safety rules (review round 1). The caller must assert the session list came from a
// successful, complete GetSchedule (scheduleConfirmed). Voiding every recorded pass against an
// empty list needs confirmEmpty, and voiding more than five passes in one run needs
// allowBulkVoid; otherwise the run stops before any call. The server's answers are checked:
// an update or void must answer for the serial that was asked about, and an issue must answer
// only for requested codes, once each, with serials not already recorded. A failed record
// write after an issue voids the just-issued passes again so none is orphaned.
import type { PassFields } from '@compass/contracts';
import type { CompassClient } from './compass-client.js';
import { fieldsHash } from './field-hash.js';
import type { BuildPassFn, IssuedPass, IssuedPassRecord, SyncInput } from './models.js';
import type { PassStore } from './pass-store.js';
import { passError } from './redaction.js';

/** The most passes the contract accepts in one issue request. */
export const MAX_ISSUE_CHUNK = 25;
/** The most passes one run may void without allowBulkVoid. */
export const MAX_UNCONFIRMED_VOIDS = 5;

/** The four ways a session can stand against the record. */
export type DiffCase = 'added' | 'changed' | 'cancelled' | 'unchanged';

/** One line of the sync plan. serialNumber is present for every case except added. */
export interface SyncPlanEntry {
  sessionCode: string;
  serialNumber?: string;
  diffCase: DiffCase;
}

/** What a sync run did. */
export interface SyncResult {
  plan: SyncPlanEntry[];
  /** The number of Compass API calls made. */
  calls: number;
  /** The record as it stands after the run. */
  record: IssuedPassRecord;
}

/** What syncPasses needs. */
export interface SyncDeps {
  store: PassStore;
  client: CompassClient;
  builder: BuildPassFn;
  /** The platforms to issue added passes for. */
  platforms: ('apple' | 'google')[];
}

/**
 * Classify every session code in the union of the sessions and the record. Sessions come
 * first, in input order (added, changed or unchanged), then the record entries whose code
 * is no longer on the schedule (cancelled), in record order. A code that appears twice in
 * either list counts once, at its first occurrence.
 */
export function diffSchedule(
  input: SyncInput,
  record: IssuedPassRecord,
  rebuild: BuildPassFn,
): SyncPlanEntry[] {
  const recorded = new Map<string, IssuedPass>();
  for (const pass of record.passes) {
    if (!recorded.has(pass.sessionCode)) {
      recorded.set(pass.sessionCode, pass);
    }
  }

  const plan: SyncPlanEntry[] = [];
  const scheduled = new Set<string>();
  for (const session of input.sessions) {
    const code = session.code;
    if (scheduled.has(code)) {
      continue;
    }
    scheduled.add(code);
    const issued = recorded.get(code);
    if (issued === undefined) {
      plan.push({ sessionCode: code, diffCase: 'added' });
    } else {
      const changed = fieldsHash(rebuild(code)) !== issued.fieldsHash;
      plan.push({
        sessionCode: code,
        serialNumber: issued.serialNumber,
        diffCase: changed ? 'changed' : 'unchanged',
      });
    }
  }

  for (const [code, issued] of recorded) {
    if (!scheduled.has(code)) {
      plan.push({ sessionCode: code, serialNumber: issued.serialNumber, diffCase: 'cancelled' });
    }
  }
  return plan;
}

/** Split a list into chunks of at most the given size, keeping order. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/** Throw the fixed identity error: the server answered for something that was not asked. */
function identityMismatch(): never {
  throw passError(
    'sync.identity_mismatch',
    'The server answered for a different pass than the one asked about, so nothing was recorded.',
  );
}

/**
 * Bring the record in line with the schedule, holding the store lock for the whole run.
 * Returns the plan, the number of API calls made and the resulting record. A run whose plan is
 * all unchanged makes no call and does not touch the record.
 */
export function syncPasses(input: SyncInput, deps: SyncDeps): Promise<SyncResult> {
  return deps.store.withLock(() => runSync(input, deps));
}

async function runSync(input: SyncInput, deps: SyncDeps): Promise<SyncResult> {
  const { store, client, platforms } = deps;
  if (input.scheduleConfirmed !== true) {
    throw passError(
      'sync.schedule_unconfirmed',
      'The schedule was not confirmed as complete, so nothing was changed.',
    );
  }

  // Build each pass once, up front: the diff, the issue bodies and the PUT bodies share it, and
  // a builder error surfaces before any API call.
  const built = new Map<string, PassFields>();
  const rebuild: BuildPassFn = (code) => {
    let fields = built.get(code);
    if (fields === undefined) {
      fields = deps.builder(code);
      built.set(code, fields);
    }
    return fields;
  };
  for (const session of input.sessions) {
    rebuild(session.code);
  }

  const { record, superseded } = await store.readWithSuperseded();
  const plan = diffSchedule(input, record, rebuild);
  const added = plan.filter((entry) => entry.diffCase === 'added');
  const changed = plan.filter((entry) => entry.diffCase === 'changed');
  const cancelled = plan.filter((entry) => entry.diffCase === 'cancelled');

  if (input.sessions.length === 0 && record.passes.length > 0 && input.confirmEmpty !== true) {
    throw passError(
      'sync.empty_schedule_refused',
      `The schedule is empty but ${String(record.passes.length)} pass(es) are recorded. Confirm an empty schedule to void them all.`,
    );
  }
  const voidTotal = cancelled.length + superseded.length;
  if (voidTotal > MAX_UNCONFIRMED_VOIDS && input.allowBulkVoid !== true) {
    throw passError(
      'sync.bulk_void_refused',
      `This sync would void ${String(voidTotal)} passes, more than ${String(MAX_UNCONFIRMED_VOIDS)} at once. Confirm a bulk void to continue.`,
    );
  }
  if (added.length + changed.length + cancelled.length + superseded.length === 0) {
    return { plan, calls: 0, record };
  }

  let passes = [...record.passes];
  let calls = 0;
  const persist = async (): Promise<void> => {
    try {
      await store.write({ passes });
    } catch {
      throw passError(
        'sync.store_failed',
        'The issued-pass record could not be saved. The next sync repeats the step.',
      );
    }
  };
  const voidChecked = async (serialNumber: string): Promise<void> => {
    const result = await client.voidPass(serialNumber);
    calls += 1;
    if (result.outcome === 'voided' && result.response.serialNumber !== serialNumber) {
      identityMismatch();
    }
  };

  // Older duplicates for a session code first, before anything is written: a write would drop
  // them from the record, so their passes must be voided while they are still recorded.
  for (const old of superseded) {
    await voidChecked(old.serialNumber);
  }
  if (superseded.length > 0) {
    await persist();
  }

  for (const group of chunk(added, MAX_ISSUE_CHUNK)) {
    const response = await client.issuePasses({
      platforms,
      passes: group.map((entry) => rebuild(entry.sessionCode)),
    });
    calls += 1;

    // Trust nothing the server says about identity: every answer is for a requested code,
    // once, with a serial the record does not already hold. Otherwise record nothing.
    const requested = new Set(group.map((entry) => entry.sessionCode));
    const answered = new Set<string>();
    const serials = new Set(passes.map((pass) => pass.serialNumber));
    for (const issued of response.passes) {
      if (
        !requested.has(issued.sessionCode) ||
        answered.has(issued.sessionCode) ||
        serials.has(issued.serialNumber)
      ) {
        identityMismatch();
      }
      answered.add(issued.sessionCode);
      serials.add(issued.serialNumber);
    }

    for (const entry of group) {
      const issued = response.passes.find((pass) => pass.sessionCode === entry.sessionCode);
      if (issued !== undefined) {
        passes.push({
          serialNumber: issued.serialNumber,
          sessionCode: entry.sessionCode,
          fieldsHash: fieldsHash(rebuild(entry.sessionCode)),
          platforms: issued.platforms,
        });
      }
    }
    try {
      await store.write({ passes });
    } catch {
      // The passes exist on the server but the record does not hold them. Void them again
      // at once so none is orphaned, and say how that went.
      let voided = 0;
      let stuck = 0;
      for (const issued of response.passes) {
        try {
          await client.voidPass(issued.serialNumber);
          calls += 1;
          voided += 1;
        } catch {
          stuck += 1;
        }
      }
      throw passError(
        'sync.store_failed',
        `The issued-pass record could not be saved after issuing. ${String(voided)} just-issued pass(es) were voided again${stuck > 0 ? `, and ${String(stuck)} could not be voided` : ''}.`,
      );
    }
    if (response.passes.length < group.length) {
      throw passError(
        'sync.partial_issue',
        `The server issued ${String(response.passes.length)} of ${String(group.length)} requested passes. The ones that came back were recorded.`,
      );
    }
  }

  const same = (target: SyncPlanEntry) => (pass: IssuedPass) =>
    pass.serialNumber === target.serialNumber && pass.sessionCode === target.sessionCode;

  for (const entry of changed) {
    const fields = rebuild(entry.sessionCode);
    const serialNumber = entry.serialNumber as string;
    const result = await client.updatePass(serialNumber, fields);
    calls += 1;
    if (result.outcome === 'updated' && result.response.serialNumber !== serialNumber) {
      identityMismatch();
    }
    passes =
      result.outcome === 'gone'
        ? passes.filter((pass) => !same(entry)(pass))
        : passes.map((pass) =>
            same(entry)(pass) ? { ...pass, fieldsHash: fieldsHash(fields) } : pass,
          );
    await persist();
  }

  for (const entry of cancelled) {
    await voidChecked(entry.serialNumber as string);
    passes = passes.filter((pass) => !same(entry)(pass));
    await persist();
  }

  return { plan, calls, record: { passes } };
}
