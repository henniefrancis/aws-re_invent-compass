// Boarding time (itinerary-rules, S2).
//
// A reserved seat is released to the walk-up line 10 minutes before the session starts.
// "Boarding closes" is that moment. It is computed by instant arithmetic (start minus 10
// minutes) and expressed in the event timezone, so a change of the local offset can never
// shift it (Req 11.2).
//
// Reservability comes only from the isReservable flag. The session type name is never used
// (Req 1.3, 1.4). Missing data gives "unknown" with a reason, never a default.
import type { NormalisedSession } from '@compass/contracts';
import type { Context } from './context.js';
import * as reason from './reasons.js';
import { sessionReservability, usableTime } from './resolve.js';
import { checkZone, formatLocal, parseInstant, toZonedIso } from './time.js';

/** Minutes before the session start at which a reserved seat is released. */
export const BOARDING_OFFSET_MINUTES = 10;

const MS_PER_MINUTE = 60_000;

/** The outcome of working out when boarding closes. */
export type BoardingResult =
  /** Boarding closes at an ISO instant, written in the event timezone. */
  | { status: 'closes'; at: string; reason: string }
  /** The session needs no reservation, so it has no boarding time. */
  | { status: 'notApplicable'; reason: string }
  /** Data needed to decide was missing. */
  | { status: 'unknown'; reason: string };

/** The two facts boarding depends on, already resolved. */
export interface BoardingInput {
  /** Absent when the reservation flag is missing. */
  isReservable: boolean | undefined;
  /** A usable ISO 8601 start, absent when unusable. */
  startsAt: string | undefined;
}

/**
 * Work out boarding from resolved facts. Checks run in a fixed order: the timezone, then the
 * reservation flag, then the start time. Shared by computeBoarding and the connection layer.
 */
export function boardingFor(input: BoardingInput, context: Context): BoardingResult {
  const zone = checkZone(context.eventTimezone);
  if (!zone.ok) {
    return { status: 'unknown', reason: reason.zoneProblem(zone.reason) };
  }
  if (input.isReservable === undefined) {
    return { status: 'unknown', reason: reason.boardingMissingReservability() };
  }
  if (!input.isReservable) {
    return { status: 'notApplicable', reason: reason.boardingNotApplicable() };
  }
  if (input.startsAt === undefined) {
    return { status: 'unknown', reason: reason.boardingMissingStart() };
  }
  const closesAt =
    (parseInstant(input.startsAt) as number) - BOARDING_OFFSET_MINUTES * MS_PER_MINUTE;
  return {
    status: 'closes',
    at: toZonedIso(closesAt, zone.zone),
    reason: reason.boardingCloses(formatLocal(closesAt, zone.zone)),
  };
}

/** When does the seat for this session get released? */
export function computeBoarding(session: NormalisedSession, context: Context): BoardingResult {
  return boardingFor(
    { isReservable: sessionReservability(session), startsAt: usableTime(session, 'startsAt') },
    context,
  );
}
