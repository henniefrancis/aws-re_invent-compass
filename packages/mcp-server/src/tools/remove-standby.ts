// remove_standby (Requirement 14.2, CTO review M2 and M4): removes one favorite, sending
// DisassociateFavorite once through the confirmed write, and reports `removed` only when the
// confirmed schedule no longer lists it.

import { CompassError } from '../ports/errors.js';
import { checkIdentifier } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { describeTargets } from '../safety/targets.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import { confirmMessage, ensureSignedIn, humanConfirms, readFreshSchedule } from './common.js';

/** remove_standby. */
export async function removeStandby(
  input: { sessionId: string },
  ctx: ToolContext,
): Promise<ToolOutcome<'remove_standby'>> {
  const { events, snapshot, clock, mode } = ctx.runtime;
  if (!checkIdentifier(input.sessionId).ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const catalog = await events.catalog();
  const targets = describeTargets([input.sessionId], catalog);
  if (targets.missing > 0) {
    throw new CompassError('UnknownSession');
  }
  const { schedule, window } = await readFreshSchedule(ctx);
  if (!schedule.favorites.includes(input.sessionId)) {
    return {
      ok: true,
      structured: { removed: false },
      text: 'That session is not on your standby list, so nothing was removed.',
    };
  }
  if (
    !(await humanConfirms(
      ctx,
      confirmMessage('Remove this from your standby list?', targets.found),
    ))
  ) {
    return {
      ok: true,
      structured: { removed: false },
      text: 'Nothing was removed, because you did not confirm.',
    };
  }
  const written = await events.unfavorite(input.sessionId);
  if (written.kind === 'unconfirmed') {
    return {
      ok: true,
      structured: { removed: false },
      text: 'The request was sent, but Compass could not read your schedule back, so it is unconfirmed. Check your schedule before trying again. Compass did not send it twice.',
    };
  }
  await snapshot.write({
    version: 1,
    mode,
    fetchedAt: clock.now().toISOString(),
    eventWindow: window,
    schedule: written.schedule,
  });
  const removed = !written.schedule.favorites.includes(input.sessionId);
  return {
    ok: true,
    structured: { removed },
    text: [
      removed
        ? 'The session is off your standby list and your schedule confirms it.'
        : 'The request was sent, but your schedule still lists the session, so it is not removed.',
      labelUntrusted('catalog', targets.found),
    ].join('\n'),
  };
}
