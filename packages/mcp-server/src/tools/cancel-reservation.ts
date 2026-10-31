// cancel_reservation (Requirement 13, CTO review M1, M2 and M4).
//
// A cancel for a session that is part of a Pending_Swap goes through S2 planSafeSwap on a fresh
// schedule, and cancels only when the outcome is safe, so the attendee is never left with
// neither seat. The first refusal is remembered. A second call for the same session overrides
// it only with an explicit, elicited "cancel anyway". A client that cannot ask never gets the
// override (security M5): every call is refused until the repeat is confirmed on the schedule,
// and the text says to reserve and confirm the repeat first. The cancellation is sent once
// through the confirmed write and reported only when the confirmed schedule no longer lists the
// session.

import { CompassError } from '../ports/errors.js';
import { checkIdentifier } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { describeTargets } from '../safety/targets.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import {
  commitmentFor,
  confirmMessage,
  confirmedCommitments,
  ensureSignedIn,
  humanConfirms,
  readFreshSchedule,
  readOnlyReply,
  catalogTargets,
} from './common.js';

function notCancelled(text: string): ToolOutcome<'cancel_reservation'> {
  return { ok: true, structured: { cancelled: false }, text };
}

/** cancel_reservation. */
export async function cancelReservation(
  input: { sessionId: string },
  ctx: ToolContext,
): Promise<ToolOutcome<'cancel_reservation'>> {
  const { events, rules, passes, snapshot, clock, mode } = ctx.runtime;
  if (!checkIdentifier(input.sessionId).ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const catalog = await events.catalog();
  const targets = describeTargets([input.sessionId], catalog);
  const [session] = targets.sessions;
  if (session === undefined) {
    throw new CompassError('UnknownSession');
  }

  const { schedule, window } = await readFreshSchedule(ctx);
  if (!schedule.reserved.includes(input.sessionId)) {
    return notCancelled('That session is not on your reserved list, so nothing was cancelled.');
  }

  const swap = ctx.state.swaps.forOriginal(input.sessionId);
  const repeat = swap === undefined ? undefined : catalog.byId.get(swap.repeatId)?.session;
  let confirmedByOverride = false;
  const readOnly = readOnlyReply(ctx, 'cancel this reservation.', catalogTargets(targets.found));
  if (readOnly !== undefined) {
    return notCancelled(readOnly);
  }

  if (swap !== undefined && repeat !== undefined) {
    const plan = await rules.planSafeSwap(
      commitmentFor(session),
      repeat,
      confirmedCommitments(schedule, catalog),
      catalog,
    );
    if (plan.outcome !== 'safe') {
      const rule =
        ctx.elicit === undefined
          ? 'Compass will not cancel this until your repeat is confirmed on your schedule. Reserve the repeat first, check your schedule, then ask again.'
          : 'If you still want to cancel, ask again and Compass will ask you to confirm "cancel anyway".';
      const refusal = [
        'Nothing was cancelled. Cancelling now could leave you with neither seat.',
        labelUntrusted('catalog', {
          explanation: plan.explanation,
          repeat: describeTargets([swap.repeatId], catalog).found,
        }),
        rule,
      ].join('\n');
      if (ctx.elicit === undefined) {
        // No override without a way to ask: the refusal repeats until the repeat is confirmed.
        return notCancelled(refusal);
      }
      if (swap.refusedAt === undefined) {
        ctx.state.swaps.markRefused(input.sessionId);
        return notCancelled(refusal);
      }
      const answer = await ctx.elicit({
        message: confirmMessage(
          'Cancel anyway? Your repeat seat is not confirmed, so you could end up with neither seat.',
          targets.found,
        ),
      });
      if (answer !== 'accept') {
        return notCancelled('Nothing was cancelled, because you did not confirm "cancel anyway".');
      }
      confirmedByOverride = true;
    }
  }

  if (!confirmedByOverride) {
    const approved = await humanConfirms(
      ctx,
      confirmMessage('Cancel this reservation?', targets.found),
    );
    if (!approved) {
      return notCancelled('Nothing was cancelled, because you did not confirm.');
    }
  }

  const written = await events.cancel(input.sessionId);
  ctx.state.swaps.clear(input.sessionId);
  if (written.kind === 'unconfirmed') {
    return notCancelled(
      'The cancellation was sent, but Compass could not read your schedule back, so it is unconfirmed. Check your schedule before trying again. Compass did not send it twice.',
    );
  }
  await snapshot.write({
    version: 1,
    mode,
    fetchedAt: clock.now().toISOString(),
    eventWindow: window,
    schedule: written.schedule,
  });
  const cancelled = !written.schedule.reserved.includes(input.sessionId);
  const lines = [
    cancelled
      ? 'The reservation is cancelled and your schedule confirms it.'
      : 'The cancellation was sent, but your schedule still lists the session, so it is not cancelled.',
    labelUntrusted('catalog', targets.found),
  ];
  if (
    cancelled &&
    (await passes.issuedRecord()).some((record) => record.sessionCode === session.code)
  ) {
    lines.push('You have a Boarding Pass for this session. Run sync_passes to void it.');
  }
  return { ok: true, structured: { cancelled }, text: lines.join('\n') };
}
