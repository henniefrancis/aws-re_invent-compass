// reserve_with_guardrails (Requirement 12, CTO review M2 and M4): the guarded booking.
//
// Order: identifier check, catalog lookup (unknown ids are refused), a fresh schedule, then the
// guardrail for every session against the confirmed schedule plus the sessions before it. A
// block sends nothing and returns the verdict with rebooking options and, when one exists, a
// safe swap (recorded in the ledger). Otherwise, where the client supports elicitation, the
// human confirms the exact ids, codes, titles and warnings; then ReserveSessions is sent once
// through the confirmed write and never resent. A session counts as reserved only when the
// confirmed schedule lists it. Warnings come first in the text.

import { guardBatch } from '../guardrail/reserve-guard.js';
import { suggestForBlock } from '../guardrail/suggestions.js';
import type { Suggestions } from '../guardrail/suggestions.js';
import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { describeTargets } from '../safety/targets.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import {
  confirmMessage,
  confirmedCommitments,
  ensureSignedIn,
  humanConfirms,
  readFreshSchedule,
} from './common.js';
import { explainFailure } from './failure-codes.js';

type Outcome = 'reserved' | 'refused' | 'unconfirmed' | 'no answer';

/** reserve_with_guardrails. */
export async function reserveWithGuardrails(
  input: { sessionIds: string[] },
  ctx: ToolContext,
): Promise<ToolOutcome<'reserve_with_guardrails'>> {
  const { events, rules, snapshot, clock, mode } = ctx.runtime;
  if (!checkIdentifiers(input.sessionIds).ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const catalog = await events.catalog();
  const targets = describeTargets(input.sessionIds, catalog);
  if (targets.missing > 0) {
    throw new CompassError('UnknownSession');
  }
  const { sessions } = targets;

  const { schedule, window } = await readFreshSchedule(ctx);
  const confirmed = confirmedCommitments(schedule, catalog);
  const guard = await guardBatch(sessions, confirmed, rules, catalog);
  const warnings = guard.verdict.decision === 'warn' ? guard.verdict.reasons : [];

  if (guard.verdict.decision === 'block') {
    let suggestions: Suggestions = { rebooking: [] };
    for (const entry of guard.perSession) {
      if (entry.verdict.decision === 'block') {
        suggestions = await suggestForBlock(
          entry.session,
          confirmed,
          rules,
          catalog,
          schedule.favorites,
        );
        break;
      }
    }
    if (suggestions.swap !== undefined) {
      ctx.state.swaps.propose({
        originalId: suggestions.swap.originalId,
        repeatId: suggestions.swap.repeatId,
        blockedId: suggestions.swap.blockedId,
      });
    }
    return {
      ok: true,
      structured: { verdict: guard.verdict },
      text: [
        'Nothing was reserved, because the booking guardrail blocked it.',
        labelUntrusted('catalog', {
          actingOn: targets.found,
          reasons: guard.verdict.reasons,
          rebooking: suggestions.rebooking.map((option) => ({
            code: option.session.code,
            title: option.session.title,
            reason: option.reason,
          })),
          safeSwap: suggestions.swap?.steps,
        }),
      ].join('\n'),
    };
  }

  const approved = await humanConfirms(
    ctx,
    confirmMessage('Reserve these sessions?', targets.found, warnings),
  );
  if (!approved) {
    return {
      ok: true,
      structured: { verdict: guard.verdict },
      text: 'Nothing was reserved, because you did not confirm.',
    };
  }

  const written = await events.reserve(input.sessionIds);
  const bulk = written.result;
  const reservedNow = written.kind === 'confirmed' ? new Set(written.schedule.reserved) : undefined;
  const results = input.sessionIds.map((id) => {
    const reference = targets.found.find((t) => t.sessionId === id);
    const failure = bulk.failed.find((f) => f.sessionId === id);
    let outcome: Outcome = 'no answer';
    let detail = 'The Events service gave no answer for this session.';
    if (failure !== undefined) {
      outcome = 'refused';
      detail = explainFailure(failure, catalog);
    } else if (bulk.successful.includes(id)) {
      outcome = reservedNow?.has(id) === true ? 'reserved' : 'unconfirmed';
      detail =
        outcome === 'reserved'
          ? 'Reserved and confirmed on your schedule.'
          : 'Sent, but your schedule does not confirm it yet. Check your schedule before trying again.';
    }
    return { sessionId: id, code: reference?.code, title: reference?.title, outcome, detail };
  });

  if (written.kind === 'confirmed') {
    await snapshot.write({
      version: 1,
      mode,
      fetchedAt: clock.now().toISOString(),
      eventWindow: window,
      schedule: written.schedule,
    });
  }

  const fullIds = new Set(
    bulk.failed.filter((f) => f.code === 'sessionFull').map((f) => f.sessionId),
  );
  const rebooking: { forCode: string; code: string; title: string; reason: string }[] = [];
  for (const session of sessions) {
    if (fullIds.has(session.sessionId)) {
      for (const option of await rules.rebooking(
        session.code,
        catalog,
        schedule.favorites,
        session.sessionId,
      )) {
        rebooking.push({
          forCode: session.code,
          code: option.session.code,
          title: option.session.title,
          reason: option.reason,
        });
      }
    }
  }

  const reservedIds = results.filter((r) => r.outcome === 'reserved').map((r) => r.sessionId);
  const lines = [
    ...(warnings.length > 0 ? ['Warnings first:', labelUntrusted('catalog', warnings)] : []),
    written.kind === 'unconfirmed'
      ? 'The booking was sent, but Compass could not read your schedule back, so it is unconfirmed. Check your schedule before trying again. Compass did not send it twice.'
      : `${reservedIds.length} of ${input.sessionIds.length} sessions are reserved and confirmed on your schedule.`,
    labelUntrusted('catalog', { results, rebooking }),
  ];

  return {
    ok: true,
    structured: {
      verdict: guard.verdict,
      result: {
        successful: reservedIds,
        failed: [
          ...bulk.failed,
          ...results
            .filter((r) => r.outcome === 'unconfirmed')
            .map((r) => ({ sessionId: r.sessionId, code: 'notConfirmed' })),
        ],
      },
    },
    text: lines.join('\n'),
  };
}
