// Pass_Sync for the pass side (boarding-passes, S4, Requirement 4).
//
// diffSchedule is a pure diff of the resolved sessions against the Issued_Pass_Record,
// keyed on the session code, into exactly four cases: added, changed, cancelled and
// unchanged. syncPasses drives the Compass_Client from that plan (issue the added ones in
// chunks, PUT the changed ones, void the cancelled ones, touch nothing else) and writes the
// resulting record after every completed operation, so a failure part-way keeps the
// progress already made.
//
// The pass for a session is rebuilt once per sync. If a session in the schedule cannot be
// turned into a pass, the PassError from the builder propagates before any API call is
// made: the sync fails closed rather than voiding a pass for a session that is still on the
// schedule.
import type { PassFields } from '@compass/contracts';
import type { CompassClient } from './compass-client.js';
import { fieldsHash } from './field-hash.js';
import type { BuildPassFn, IssuedPass, IssuedPassRecord, SyncInput } from './models.js';
import type { PassStore } from './pass-store.js';

/** The most passes the contract accepts in one issue request. */
export const MAX_ISSUE_CHUNK = 25;

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

/**
 * Bring the record in line with the schedule. Returns the plan, the number of API calls
 * made and the resulting record. A run whose plan is all unchanged makes no call and does
 * not touch the record.
 */
export async function syncPasses(input: SyncInput, deps: SyncDeps): Promise<SyncResult> {
  const { store, client, platforms } = deps;

  // Build each pass at most once: the diff, the issue bodies and the PUT bodies share it.
  const built = new Map<string, PassFields>();
  const rebuild: BuildPassFn = (code) => {
    let fields = built.get(code);
    if (fields === undefined) {
      fields = deps.builder(code);
      built.set(code, fields);
    }
    return fields;
  };

  const record = await store.read();
  const plan = diffSchedule(input, record, rebuild);
  const added = plan.filter((entry) => entry.diffCase === 'added');
  const changed = plan.filter((entry) => entry.diffCase === 'changed');
  const cancelled = plan.filter((entry) => entry.diffCase === 'cancelled');
  if (added.length + changed.length + cancelled.length === 0) {
    return { plan, calls: 0, record };
  }

  let passes = [...record.passes];
  let calls = 0;
  const persist = async (): Promise<void> => {
    await store.write({ passes });
  };

  for (const group of chunk(added, MAX_ISSUE_CHUNK)) {
    const response = await client.issuePasses({
      platforms,
      passes: group.map((entry) => rebuild(entry.sessionCode)),
    });
    calls += 1;
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
    await persist();
  }

  for (const entry of changed) {
    const fields = rebuild(entry.sessionCode);
    const result = await client.updatePass(entry.serialNumber as string, fields);
    calls += 1;
    passes =
      result.outcome === 'gone'
        ? passes.filter((pass) => pass.serialNumber !== entry.serialNumber)
        : passes.map((pass) =>
            pass.serialNumber === entry.serialNumber
              ? { ...pass, fieldsHash: fieldsHash(fields) }
              : pass,
          );
    await persist();
  }

  for (const entry of cancelled) {
    await client.voidPass(entry.serialNumber as string);
    calls += 1;
    passes = passes.filter((pass) => pass.serialNumber !== entry.serialNumber);
    await persist();
  }

  return { plan, calls, record: { passes } };
}
