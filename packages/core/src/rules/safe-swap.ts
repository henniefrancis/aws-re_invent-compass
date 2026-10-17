// Safe swap (itinerary-rules, S2).
//
// Moving to a repeat must never leave the attendee without a seat. The plan has three
// ordered steps: reserve the repeat, confirm it is held by reading the schedule back, then
// cancel the original. The cancel step stays blocked until the confirmation schedule shows
// the repeat held and the repeat clashes with nothing (Req 7.1, 7.2).
//
// The engine does no input or output. The caller reads GetSchedule and passes the resulting
// schedule in as confirmationSchedule; the engine only inspects it. Nothing is ever changed:
// the original reservation and every input are left as they were.
//
// Outcome:
//   unsafe   the repeat clashes with the original or another commitment; each is named
//   failed   the confirmation schedule does not show the repeat held
//   safe     no clash and the repeat is held. "Safe" means only that: nothing overlaps. It does
//            not say the walks between venues are comfortable, or that seats are available.
//   unknown  the timezone, the current time or the repeat's times are unusable, the repeat is already
//            over (relative to Context.now), or another commitment has times
//            that cannot be checked, so a clash cannot be ruled out
import type { Commitment, NormalisedSession } from '@compass/contracts';
import { findClashes, intervalOf, type ClashReport } from './clashes.js';
import type { Context } from './context.js';
import * as reason from './reasons.js';
import {
  resolveCommitment,
  sessionRef,
  sessionToCommitment,
  type ScheduleInput,
} from './resolve.js';
import { checkZone, parseInstant } from './time.js';

/** One step of a swap plan. */
export interface SwapStep {
  order: 1 | 2 | 3;
  action: 'reserveRepeat' | 'confirmHeld' | 'cancelOriginal';
  /** True on the cancel step until the swap is confirmed safe. Always false on the others. */
  blockedUntilConfirmed: boolean;
  reason: string;
}

/** A swap plan and its overall outcome. */
export interface SwapPlan {
  outcome: 'safe' | 'unsafe' | 'failed' | 'unknown';
  /** Always three steps, in order. */
  steps: SwapStep[];
  /** The commitments the repeat clashes with, when unsafe. */
  clashesWith: string[];
  reason: string;
}

/** A key that tells whether two commitments are the same entry. */
function commitmentKey(commitment: Commitment): string {
  const identity = commitment.kind === 'reservedSession' ? commitment.sessionId : commitment.title;
  return [commitment.kind, identity, commitment.startsAt, commitment.endsAt].join('|');
}

function plan(
  outcome: SwapPlan['outcome'],
  repeat: NormalisedSession,
  clashesWith: string[],
  overall: string,
): SwapPlan {
  return {
    outcome,
    steps: [
      {
        order: 1,
        action: 'reserveRepeat',
        blockedUntilConfirmed: false,
        reason: reason.swapReserveStep(sessionRef(repeat)),
      },
      {
        order: 2,
        action: 'confirmHeld',
        blockedUntilConfirmed: false,
        reason: reason.swapConfirmStep(),
      },
      {
        order: 3,
        action: 'cancelOriginal',
        blockedUntilConfirmed: outcome !== 'safe',
        reason: reason.swapCancelStep(outcome !== 'safe'),
      },
    ],
    clashesWith,
    reason: overall,
  };
}

/**
 * Plan a safe swap from an original reservation to a repeat session.
 *
 * confirmationSchedule is the schedule the caller read back from GetSchedule. The repeat is
 * checked against the original and every other commitment in it, never against itself.
 */
export function planSafeSwap(
  original: Commitment,
  repeat: NormalisedSession,
  confirmationSchedule: ScheduleInput,
  context: Context,
): SwapPlan {
  const zone = checkZone(context.eventTimezone);
  if (!zone.ok) {
    return plan('unknown', repeat, [], reason.swapZoneProblem(zone.reason));
  }

  const nowMs = parseInstant(context.now);
  if (nowMs === undefined) {
    return plan('unknown', repeat, [], reason.swapNowUnusable());
  }

  const sessions = { ...confirmationSchedule.sessions, [repeat.sessionId]: repeat };
  const repeatCommitment = sessionToCommitment(repeat);
  const resolvedRepeat = resolveCommitment(repeatCommitment, sessions);
  const repeatInterval = intervalOf(resolvedRepeat, zone.zone);
  if ('missing' in repeatInterval) {
    return plan('unknown', repeat, [], reason.swapUnknown());
  }
  // A repeat that is already over cannot be swapped to, whatever the schedule says.
  if (repeatInterval.end <= nowMs) {
    return plan('unknown', repeat, [], reason.swapRepeatPast(sessionRef(repeat)));
  }

  const held = confirmationSchedule.commitments.some(
    (commitment) =>
      commitment.kind === 'reservedSession' && commitment.sessionId === repeat.sessionId,
  );
  const others = confirmationSchedule.commitments.filter(
    (commitment) =>
      !(commitment.kind === 'reservedSession' && commitment.sessionId === repeat.sessionId),
  );
  const originalKey = commitmentKey(original);
  if (!others.some((commitment) => commitmentKey(commitment) === originalKey)) {
    others.push(original);
  }

  // The timezone was checked above, so the report is always an "ok" report.
  const report = findClashes({ commitments: [repeatCommitment, ...others], sessions }, context);
  const { clashes, unknown } = report as Extract<ClashReport, { status: 'ok' }>;
  const clashesWith = clashes.filter((clash) => clash.aIndex === 0).map((clash) => clash.b);

  if (clashesWith.length > 0) {
    return plan('unsafe', repeat, clashesWith, reason.swapUnsafe(clashesWith));
  }
  // A commitment that could not be checked might clash, so the swap cannot be called safe.
  // Position 0 is the repeat itself, whose times were checked above.
  const unchecked = unknown.find((entry) => entry.index !== 0);
  if (unchecked !== undefined) {
    return plan('unknown', repeat, [], reason.swapOthersUnknown(unchecked.ref));
  }
  if (!held) {
    return plan('failed', repeat, [], reason.swapFailed());
  }
  return plan('safe', repeat, [], reason.swapSafe());
}
