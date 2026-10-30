// The next session of a hand-off (showcase-site task 40).

import { parseIsoWithOffset } from '../time/iso';
import type { BoardSession } from './handoff-view';

/**
 * The index of the next session: the one that starts soonest after now. A start is an instant
 * (the time carries its offset), so this is the event's own time whatever zone the phone is in.
 * A session that has started is not next. When two start together the first in the list wins.
 * Returns -1 when every session has started.
 */
export function nextSessionIndex(sessions: readonly BoardSession[], nowMs: number): number {
  let best = -1;
  let bestStart = Number.POSITIVE_INFINITY;
  sessions.forEach((session, index) => {
    const start = parseIsoWithOffset(session.startsAt);
    if (start !== null && start > nowMs && start < bestStart) {
      best = index;
      bestStart = start;
    }
  });
  return best;
}
