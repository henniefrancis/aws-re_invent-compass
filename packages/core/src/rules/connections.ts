// Connections between commitments (itinerary-rules, S2).
//
// A connection is the walk between two consecutive commitments. Walking minutes are the
// Walking_Time_Matrix value plus the buffer from Context (Req 2.1). The attendee must be
// at the next commitment by its due time: Boarding_Closes when it is reservable, otherwise
// its start time (Req 2.2, 2.8). The spare time left decides the class:
//   comfortable  spare time is tightMarginMinutes or more
//   tight        spare time is below tightMarginMinutes (the one shared Tight definition)
//   impossible   the attendee arrives after the due time
//   unknown      a needed fact is missing, and the reason names it
// Every reason names both venues and the walking minutes (Req 2.9).
import type { Context } from './context.js';
import type { BoardingResult } from './boarding.js';
import * as reason from './reasons.js';
import type { ResolvedCommitment } from './resolve.js';
import { checkZone, minutesBetween, parseInstant } from './time.js';
import { lookupWalk } from './venue-data.js';

const MS_PER_MINUTE = 60_000;

/** How well the attendee can make a walk. */
export type ConnectionClass = 'comfortable' | 'tight' | 'impossible' | 'unknown';

/** The outcome of classifying one connection. */
export interface ConnectionResult {
  classification: ConnectionClass;
  /** The matrix value plus the buffer. Absent when the connection is unknown. */
  walkingMinutes?: number;
  /** Minutes between arrival and the due time, negative when late. Absent when unknown. */
  spareMinutes?: number;
  /** True when the walking time is an estimate. Absent when the connection is unknown. */
  estimate?: boolean;
  /** Plain English. Names both venues and the walking minutes unless data is missing. */
  reason: string;
}

function unknown(text: string): ConnectionResult {
  return { classification: 'unknown', reason: text };
}

/**
 * Classify the walk from one commitment to the next one.
 *
 * toBoarding is the boarding result of the next commitment (see boardingFor). The two
 * commitments' times are instants, so the arithmetic is the same whatever the local offset.
 */
export function classifyConnection(
  from: ResolvedCommitment,
  to: ResolvedCommitment,
  toBoarding: BoardingResult,
  context: Context,
): ConnectionResult {
  const zone = checkZone(context.eventTimezone);
  if (!zone.ok) {
    return unknown(reason.zoneProblem(zone.reason));
  }
  if (from.venue === undefined) {
    return unknown(reason.connectionVenueMissing(from.ref));
  }
  if (to.venue === undefined) {
    return unknown(reason.connectionVenueMissing(to.ref));
  }
  const walk = lookupWalk(context.venueData, from.venue, to.venue);
  if (!walk.found) {
    return unknown(
      walk.reason === 'venueNotListed'
        ? reason.connectionVenueNotListed(walk.venue)
        : reason.connectionPairMissing(from.venue, to.venue),
    );
  }
  if (from.endsAt === undefined) {
    return unknown(reason.connectionTimeMissing(from.ref, 'end'));
  }
  if (from.missing.includes('order')) {
    return unknown(reason.connectionTimeMissing(from.ref, 'order'));
  }
  let dueText: string | undefined;
  if (toBoarding.status === 'closes') {
    dueText = toBoarding.at;
  } else if (toBoarding.status === 'notApplicable') {
    dueText = to.startsAt;
    if (dueText === undefined) {
      return unknown(reason.connectionTimeMissing(to.ref, 'start'));
    }
  } else {
    return unknown(reason.connectionBoardingMissing(to.ref));
  }

  const walkingMinutes = walk.minutes + context.bufferMinutes;
  const estimate = walk.source.kind === 'estimate';
  const arrival = (parseInstant(from.endsAt) as number) + walkingMinutes * MS_PER_MINUTE;
  const spareMinutes = minutesBetween(arrival, parseInstant(dueText) as number);
  // A bad tuning value (for example an infinite buffer) must never turn into a verdict.
  if (!Number.isFinite(spareMinutes)) {
    return unknown(reason.connectionSpareUnknown());
  }

  const text = {
    from: from.venue,
    to: to.venue,
    walk: walk.minutes,
    buffer: context.bufferMinutes,
    estimate,
  };
  // Spare time is shown rounded down and lateness rounded up, so the words match the class.
  if (spareMinutes < 0) {
    const late = Math.ceil(-spareMinutes);
    return {
      classification: 'impossible',
      walkingMinutes,
      spareMinutes,
      estimate,
      reason: reason.connectionImpossible(text, late),
    };
  }
  const spare = Math.floor(spareMinutes);
  if (spareMinutes < context.tightMarginMinutes) {
    return {
      classification: 'tight',
      walkingMinutes,
      spareMinutes,
      estimate,
      reason: reason.connectionTight(text, spare),
    };
  }
  return {
    classification: 'comfortable',
    walkingMinutes,
    spareMinutes,
    estimate,
    reason: reason.connectionComfortable(text, spare),
  };
}
