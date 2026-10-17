// The commitments next to a session in the demo week (showcase-site, Components 8 and 9).
//
// The sample pass and the sample calendar both need the walk from the previous commitment and
// the connection to the next one, on the same event day. Both come from the rules port
// (connectionsForDay), so the walking minutes are the engine's: the walk plus its buffer.

import type { Commitment } from '@compass/contracts';
import type { DemoDeps } from './demo-deps';
import type { DemoState } from './demo-state';
import { commitmentRef, dayOfIso, toScheduleInput } from './schedule';
import { gateText } from './week-view';

export interface NeighbourStop {
  /** The code of a session, or the title of personal time. */
  readonly ref: string;
  readonly sessionCode: string | null;
  readonly startsAt: string;
  /** "Venue, Room" or "Venue not published". */
  readonly gate: string;
  readonly venue: string;
  /** Walk plus buffer in minutes, or null when the engine could not say. */
  readonly walkMinutes: number | null;
}

export interface Neighbours {
  readonly previous: NeighbourStop | null;
  readonly next: NeighbourStop | null;
}

function refOf(commitment: Commitment, deps: DemoDeps): string {
  return commitment.kind === 'personalTime'
    ? commitment.title
    : (deps.catalog.get(commitment.sessionId)?.code ?? commitment.sessionId);
}

function stopOf(commitment: Commitment, walkMinutes: number | null, deps: DemoDeps): NeighbourStop {
  const ref = refOf(commitment, deps);
  if (commitment.kind === 'personalTime') {
    return {
      ref,
      sessionCode: null,
      startsAt: commitment.startsAt,
      gate: gateText(commitment.location, undefined),
      venue: commitment.location ?? '',
      walkMinutes,
    };
  }
  const session = deps.catalog.get(commitment.sessionId);
  return {
    ref,
    sessionCode: session?.code ?? null,
    startsAt: commitment.startsAt,
    gate: gateText(session?.venue ?? commitment.venue, session?.room),
    venue: session?.venue ?? commitment.venue ?? '',
    walkMinutes,
  };
}

/** The previous and next commitment of a commitment on its event day, with the engine's walks. */
export function neighboursOf(ref: string, state: DemoState, deps: DemoDeps): Neighbours {
  const index = state.commitments.findIndex((c) => commitmentRef(c) === ref);
  const mine = state.commitments[index];
  if (mine === undefined) {
    return { previous: null, next: null };
  }
  const day = dayOfIso(mine.startsAt);
  const sameDay = state.commitments.filter((c) => dayOfIso(c.startsAt) === day);
  const at = sameDay.indexOf(mine);
  const before = sameDay[at - 1];
  const after = sameDay[at + 1];
  const report = deps.rules.connectionsForDay(
    toScheduleInput(state.commitments, deps.catalog),
    deps.context,
    day,
  );
  const walk = (from: Commitment, to: Commitment): number | null => {
    if (report.status !== 'ok') {
      return null;
    }
    const found = report.connections.find(
      (c) => c.from === refOf(from, deps) && c.to === refOf(to, deps),
    );
    return found?.result.walkingMinutes ?? null;
  };
  return {
    previous: before === undefined ? null : stopOf(before, walk(before, mine), deps),
    next: after === undefined ? null : stopOf(after, walk(mine, after), deps),
  };
}
