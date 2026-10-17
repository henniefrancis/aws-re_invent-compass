// check_itinerary (Requirements 10.3, 11.1, 11.4, 12.2): runs the booking guardrail over a
// proposed itinerary without writing anything. Reserved sessions are checked with guardBatch
// against the confirmed schedule (minus themselves) plus the proposed personal time and the
// sessions before them; on a block it also suggests a rebooking or a safe swap. The text lists
// ids, codes and catalog titles (inside a Labelled_Data_Block), never titles the model supplied.

import type { Commitment, NormalisedSession } from '@compass/contracts';
import { guardBatch } from '../guardrail/reserve-guard.js';
import { suggestForBlock } from '../guardrail/suggestions.js';
import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import { confirmedCommitments, ensureSignedIn, readFreshSchedule } from './common.js';

/** check_itinerary. */
export async function checkItinerary(
  input: { commitments: Commitment[] },
  ctx: ToolContext,
): Promise<ToolOutcome<'check_itinerary'>> {
  const proposedIds = input.commitments.flatMap((c) =>
    c.kind === 'reservedSession' ? [c.sessionId] : [],
  );
  const identifiers = checkIdentifiers(proposedIds);
  if (!identifiers.ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const { rules, events } = ctx.runtime;
  const catalog = await events.catalog();
  const sessions: NormalisedSession[] = [];
  for (const id of proposedIds) {
    const entry = catalog.byId.get(id);
    if (entry === undefined) {
      throw new CompassError('UnknownSession');
    }
    sessions.push(entry.session);
  }

  const { schedule } = await readFreshSchedule(ctx);
  const proposedSet = new Set(proposedIds);
  const personal = input.commitments.filter((c) => c.kind === 'personalTime');
  const confirmed = [
    ...confirmedCommitments(schedule, catalog).filter(
      (c) => !(c.kind === 'reservedSession' && proposedSet.has(c.sessionId)),
    ),
    ...personal,
  ];
  const guard = await guardBatch(sessions, confirmed, rules, catalog);

  const blockedSession =
    sessions[guard.perSession.findIndex(({ verdict }) => verdict.decision === 'block')];
  const suggestions =
    blockedSession === undefined
      ? undefined
      : await suggestForBlock(blockedSession, confirmed, rules, catalog, schedule.favorites);

  const lines = [
    `Verdict: ${guard.verdict.decision}.`,
    ...(guard.verdict.decision === 'block' ? ['Do not reserve these sessions as they are.'] : []),
  ];
  lines.push(
    labelUntrusted('catalog', {
      sessions: guard.perSession.map((entry) => ({
        sessionId: entry.sessionId,
        code: entry.code,
        title: entry.title,
        verdict: entry.verdict.decision,
      })),
      reasons: guard.verdict.reasons,
      rebooking: suggestions?.rebooking.map((option) => ({
        code: option.session.code,
        title: option.session.title,
        reason: option.reason,
      })),
      safeSwap: suggestions?.swap?.steps,
    }),
  );
  return { ok: true, structured: { verdict: guard.verdict }, text: lines.join('\n') };
}
