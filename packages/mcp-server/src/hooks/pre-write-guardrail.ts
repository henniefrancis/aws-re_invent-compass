// The pre-write guardrail hook (Requirements 19.1 to 19.4, 19.7). It runs the same S2 check as
// the server before a write tool is called, against the Schedule_Snapshot and the cached
// catalog, and never writes or touches the network. It fails open: when it cannot judge a call
// (bad input, unknown tool, a missing or stale snapshot, no catalog, invalid ids) it exits 0 with
// a note, because the Compass server checks the call again. It blocks only a call through the
// remote awsevents write tools and a reserve_with_guardrails call that the guardrail blocks.
// Kiro sends a Power's tools as `kiro_powers` calls (ADR-024); `unwrapPowerCall` finds the tool.

import type { Clock } from '../ports/clock.js';
import type { CatalogView } from '../ports/events-port.js';
import type { RulesPort } from '../ports/rules-port.js';
import { guardBatch } from '../guardrail/reserve-guard.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import type { SnapshotStore } from '../state/schedule-snapshot.js';
import { confirmedCommitments } from '../tools/common.js';
import { exitCodeFor } from './exit-policy.js';
import type { HookDecision } from './exit-policy.js';
import { parseHookInput, unwrapPowerCall } from './hook-input.js';
import { identifyTool } from './tool-names.js';

/** A snapshot older than this is not trusted. */
export const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

/** The note shown when the hook cannot judge a call. */
export const COULD_NOT_CHECK_NOTE =
  'Compass could not check this call here. The Compass server still checks it.';

/** The reason shown when a remote write tool is blocked. */
export const AWSEVENTS_BLOCK_REASON =
  'Compass blocks this call. Use reserve_with_guardrails (or the matching Compass tool) so your booking is checked first.';

/** What the hook reads. */
export interface HookDeps {
  rules: RulesPort;
  snapshot: SnapshotStore;
  clock: Clock;
  /** The cached catalog. Throws when there is none. */
  catalog(): Promise<CatalogView>;
}

const note = (): HookDecision => ({ exitCode: exitCodeFor('note'), stdout: COULD_NOT_CHECK_NOTE });
const silent = (): HookDecision => ({ exitCode: exitCodeFor('silent') });

async function judgeReserve(sessionIds: unknown, deps: HookDeps): Promise<HookDecision> {
  const ids =
    Array.isArray(sessionIds) && sessionIds.every((id) => typeof id === 'string') ? sessionIds : [];
  if (ids.length === 0 || ids.length > 10 || !checkIdentifiers(ids).ok) {
    return note();
  }
  const snapshot = await deps.snapshot.read();
  if (
    snapshot === undefined ||
    deps.clock.now().getTime() - Date.parse(snapshot.fetchedAt) > SNAPSHOT_MAX_AGE_MS
  ) {
    return note();
  }
  const catalog = await deps.catalog();
  const sessions = ids.flatMap((id) => {
    const entry = catalog.byId.get(id);
    return entry === undefined ? [] : [entry.session];
  });
  if (sessions.length !== ids.length) {
    return note();
  }
  const guard = await guardBatch(
    sessions,
    confirmedCommitments(snapshot.schedule, catalog),
    deps.rules,
    catalog,
  );
  const titles = sessions.map((s) => `${s.code} "${s.title}"`).join(', ');
  switch (guard.verdict.decision) {
    case 'block':
      return {
        exitCode: exitCodeFor('block'),
        stderr: ['Compass blocks this booking:', ...guard.verdict.reasons].join('\n'),
      };
    case 'warn':
      return {
        exitCode: exitCodeFor('warn'),
        stdout: [`Compass warns about ${titles}:`, ...guard.verdict.reasons].join('\n'),
      };
    case 'allow':
      return silent();
  }
}

/** The pre-write guardrail. Never throws; any failure to judge is a note and exit 0. */
export async function preWriteGuardrail(raw: string, deps: HookDeps): Promise<HookDecision> {
  const input = parseHookInput(raw);
  if (input === undefined) {
    return note();
  }
  const call = unwrapPowerCall(input);
  if (call === 'ignore') {
    return silent();
  }
  const identity = identifyTool(call.toolName);
  if (identity.server === 'awsevents') {
    return { exitCode: exitCodeFor('block'), stderr: AWSEVENTS_BLOCK_REASON };
  }
  if (identity.server === 'unknown') {
    return note();
  }
  if (identity.tool !== 'reserve_with_guardrails') {
    return silent();
  }
  const toolInput: unknown = call.toolInput;
  const sessionIds =
    typeof toolInput === 'object' && toolInput !== null
      ? (toolInput as { sessionIds?: unknown }).sessionIds
      : undefined;
  try {
    return await judgeReserve(sessionIds, deps);
  } catch {
    return note();
  }
}
