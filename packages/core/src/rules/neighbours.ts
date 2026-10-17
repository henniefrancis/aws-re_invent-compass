// Connections around one commitment (itinerary-rules, S2). Internal, not exported by index.ts.
//
// Given a commitment (the candidate in the guardrail, the repeat in a swap) and the rest of the
// schedule, this works out the connection from the nearest earlier commitment and the connection
// to the nearest later commitment. It only composes other rules: the verdicts come from
// classifyConnection. Both checkReservation and planSafeSwap use it, so they agree.
//
// Neighbours are the nearest commitments within 12 hours, across midnight. All-day items and
// commitments that cannot be placed in time are not neighbours. Personal time with no location
// means "stay put": it takes the venue of the commitment before it, and no connection is drawn
// into it, because nobody walks anywhere to stay put. When a stay-put item has nothing before it,
// there is no venue to leave from, and that is reported as an unknown connection.
import type { Commitment } from '@compass/contracts';
import { boardingFor } from './boarding.js';
import type { Interval } from './clashes.js';
import { intervalOf } from './clashes.js';
import { classifyConnection, type ConnectionResult } from './connections.js';
import type { Context } from './context.js';
import * as reason from './reasons.js';
import {
  inheritStayPutVenues,
  resolveCommitment,
  type ResolvedCommitment,
  type SessionsLookup,
} from './resolve.js';

/** How far away, in either direction and across midnight, a neighbouring commitment can be. */
export const NEIGHBOUR_WINDOW_HOURS = 12;
const NEIGHBOUR_WINDOW_MS = NEIGHBOUR_WINDOW_HOURS * 3_600_000;

interface Entry {
  resolved: ResolvedCommitment;
  interval: Interval;
  isSubject: boolean;
}

/**
 * The connection results around a commitment. subject is the commitment, with the interval it
 * occupies. others is the rest of the schedule. excluded holds the positions in others to leave
 * out (for example commitments that clash, which are reported elsewhere).
 */
export function connectionsAround(
  subject: ResolvedCommitment,
  subjectInterval: Interval,
  others: readonly Commitment[],
  sessions: SessionsLookup,
  zone: string,
  context: Context,
  excluded: ReadonlySet<number>,
): ConnectionResult[] {
  const entries: Entry[] = [{ resolved: subject, interval: subjectInterval, isSubject: true }];
  others.forEach((commitment, index) => {
    const resolved = resolveCommitment(commitment, sessions);
    const interval = intervalOf(resolved, zone);
    if ('missing' in interval || resolved.isAllDay || excluded.has(index)) {
      return;
    }
    entries.push({ resolved, interval, isSubject: false });
  });
  entries.sort((a, b) => a.interval.start - b.interval.start);
  const filled = inheritStayPutVenues(entries.map((entry) => entry.resolved));
  const view = entries.map((entry, i) => ({ ...entry, resolved: filled[i] as ResolvedCommitment }));
  const me = view.find((entry) => entry.isSubject) as Entry;

  const earlier = view
    .filter(
      (n) =>
        !n.isSubject &&
        n.interval.end <= me.interval.start &&
        me.interval.start - n.interval.end <= NEIGHBOUR_WINDOW_MS,
    )
    .sort((a, b) => b.interval.end - a.interval.end)[0];
  const later = view
    .filter(
      (n) =>
        !n.isSubject &&
        n.interval.start >= me.interval.end &&
        n.interval.start - me.interval.end <= NEIGHBOUR_WINDOW_MS,
    )
    .sort((a, b) => a.interval.start - b.interval.start)[0];

  const boardingOf = (item: ResolvedCommitment) =>
    boardingFor({ isReservable: item.isReservable, startsAt: item.startsAt }, context);
  const results: ConnectionResult[] = [];
  if (earlier !== undefined) {
    if (earlier.resolved.stayPut === true && earlier.resolved.venue === undefined) {
      // Stay-put time with nothing before it has no venue to leave from.
      results.push({
        classification: 'unknown',
        reason: reason.connectionStayPutUnknown(earlier.resolved.ref),
      });
    } else {
      results.push(
        classifyConnection(earlier.resolved, me.resolved, boardingOf(me.resolved), context),
      );
    }
  }
  // Nobody walks anywhere to stay put, so no connection is drawn into stay-put time.
  if (later !== undefined && later.resolved.stayPut !== true) {
    results.push(
      classifyConnection(me.resolved, later.resolved, boardingOf(later.resolved), context),
    );
  }
  return results;
}
