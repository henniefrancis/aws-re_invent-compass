// add_standby (Requirement 14.1, CTO review M2 and M4). A standby is a backup (a favorite), not a
// reservation. The tool checks identifiers first, looks sessions up in the catalog, asks the human
// to confirm when the client supports elicitation, sends AssociateFavorites once through the
// confirmed write, and reports a session as added only when the confirmed schedule lists it.

import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { describeTargets } from '../safety/targets.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import {
  confirmMessage,
  ensureSignedIn,
  humanConfirms,
  readFreshSchedule,
  readOnlyReply,
} from './common.js';
import { explainFailure } from './failure-codes.js';

/** The reminder shown with every standby result. */
export const STANDBY_NOTE = 'Standby is a backup, not a reservation. It does not hold a seat.';

/** add_standby. */
export async function addStandby(
  input: { sessionIds: string[] },
  ctx: ToolContext,
): Promise<ToolOutcome<'add_standby'>> {
  const { events, snapshot, clock, mode } = ctx.runtime;
  if (!checkIdentifiers(input.sessionIds).ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const catalog = await events.catalog();
  const targets = describeTargets(input.sessionIds, catalog);
  if (targets.missing > 0) {
    throw new CompassError('UnknownSession');
  }
  const { window } = await readFreshSchedule(ctx);
  const question = confirmMessage('Add these to your standby list?', targets.found);
  const readOnly = readOnlyReply(ctx, question);
  if (readOnly !== undefined) {
    return {
      ok: true,
      structured: { result: { successful: [], failed: [] } },
      text: `${readOnly}
${STANDBY_NOTE}`,
    };
  }
  if (!(await humanConfirms(ctx, question))) {
    return {
      ok: true,
      structured: { result: { successful: [], failed: [] } },
      text: `Nothing was added, because you did not confirm. ${STANDBY_NOTE}`,
    };
  }

  const written = await events.favorite(input.sessionIds);
  const favorites = written.kind === 'confirmed' ? new Set(written.schedule.favorites) : undefined;
  const results = input.sessionIds.map((id) => {
    const reference = targets.found.find((t) => t.sessionId === id);
    const failure = written.result.failed.find((f) => f.sessionId === id);
    if (failure !== undefined) {
      return {
        sessionId: id,
        code: reference?.code,
        title: reference?.title,
        outcome: 'refused',
        detail: explainFailure(failure, catalog),
      };
    }
    if (!written.result.successful.includes(id)) {
      return {
        sessionId: id,
        code: reference?.code,
        title: reference?.title,
        outcome: 'no answer',
        detail: 'The Events service gave no answer for this session.',
      };
    }
    return favorites?.has(id) === true
      ? {
          sessionId: id,
          code: reference?.code,
          title: reference?.title,
          outcome: 'added',
          detail: 'On your standby list, confirmed by your schedule.',
        }
      : {
          sessionId: id,
          code: reference?.code,
          title: reference?.title,
          outcome: 'unconfirmed',
          detail: 'Sent, but your schedule does not confirm it yet. Check before trying again.',
        };
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
  const added = results.filter((r) => r.outcome === 'added').map((r) => r.sessionId);
  return {
    ok: true,
    structured: {
      result: {
        successful: added,
        failed: [
          ...written.result.failed,
          ...results
            .filter((r) => r.outcome === 'unconfirmed')
            .map((r) => ({ sessionId: r.sessionId, code: 'notConfirmed' })),
        ],
      },
    },
    text: [
      written.kind === 'unconfirmed'
        ? 'The request was sent, but Compass could not read your schedule back, so it is unconfirmed. Check your schedule before trying again. Compass did not send it twice.'
        : `${added.length} of ${input.sessionIds.length} sessions are on your standby list.`,
      STANDBY_NOTE,
      labelUntrusted('catalog', results),
    ].join('\n'),
  };
}
