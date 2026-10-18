// Schedule helpers for the pass side (boarding-passes, S4): buildPassFor and buildItinerary.
//
// Consumers (the MCP server, the CLI) hold a schedule: the reserved sessions already resolved
// to NormalisedSession values by S1, and the attendee's personal time. These helpers turn
// that into the two things S4 needs, so no consumer rebuilds the ordering and neighbour logic:
//
//  - buildPassFor(schedule, deps) returns the BuildPassFn that Pass_Sync injects. For a session
//    code it finds the session's place in the schedule, takes the commitment immediately before
//    it as the previous neighbour and the next reserved session after it as the next
//    neighbour, and calls buildPass, which asks the injected walk lookup for the minutes.
//  - buildItinerary(schedule, walks) returns the Itinerary for the calendar and the page, in
//    start order, with each reserved commitment's walk minutes from the commitment before it.
//
// A neighbour counts only within 12 hours before or after (across midnight is fine), as in S2;
// otherwise the walk fields are omitted rather than describing a stop from another day.
// Ordering is by start time, then end time, then input order. A reserved session with no
// start or end time cannot be placed: it is left out of the itinerary and has no neighbours,
// and buildPassFor for its code fails with builder.invalid_input, as buildPass does.
import type { Commitment, NormalisedSession, PersonalTime } from '@compass/contracts';
import { clampedWalk, parseInstant } from './boarding.js';
import type { ConnectionProvider } from './interfaces.js';
import type { AdjacentSession, BuildPassFn, EventWindow, Itinerary } from './models.js';
import { buildPass } from './pass-builder.js';
import { passError } from './redaction.js';

/** The schedule as S4 sees it: the reserved sessions resolved, and the personal time. */
export interface ScheduleView {
  /** The reserved sessions, resolved from the schedule's reserved ids (by S1). */
  sessions: NormalisedSession[];
  /** The attendee's personal time (layovers) from GetSchedule. */
  personalTime: PersonalTime[];
}

/** What buildPassFor needs besides the schedule. */
export interface PassBuildDeps {
  /** The walk lookup (S2, mocked until it merges). */
  connections: ConnectionProvider;
  /** The event window from GetEvent. */
  eventWindow: EventWindow;
  /** The displayed name, only when the attendee has opted in. */
  attendeeName?: string;
}

/** One placed commitment. */
interface Slot {
  commitment: Commitment;
  session?: NormalisedSession;
  start: number;
  end: number;
}

/** Place every datable commitment in start order. */
function layout(schedule: ScheduleView): Slot[] {
  const slots: Slot[] = [];
  const seen = new Set<string>();
  for (const session of schedule.sessions) {
    if (seen.has(session.code)) {
      continue;
    }
    seen.add(session.code);
    if (session.startsAt === undefined || session.endsAt === undefined) {
      continue;
    }
    slots.push({
      session,
      start: parseInstant(session.startsAt).getTime(),
      end: parseInstant(session.endsAt).getTime(),
      commitment: {
        kind: 'reservedSession',
        sessionId: session.sessionId,
        title: session.title,
        venue: session.venue,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
      },
    });
  }
  for (const time of schedule.personalTime) {
    slots.push({
      start: parseInstant(time.startDateTime).getTime(),
      end: parseInstant(time.endDateTime).getTime(),
      commitment: {
        kind: 'personalTime',
        personalTimeId: time.personalTimeId,
        title: time.title,
        location: time.location,
        startsAt: time.startDateTime,
        endsAt: time.endDateTime,
      },
    });
  }
  return slots.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * How far apart two commitments can be, in either direction and across midnight, and still count
 * as neighbours. The same rule as the rules engine (S2, NEIGHBOUR_WINDOW_HOURS): a Friday session
 * is not "5 minutes from your previous stop" when that stop was on Tuesday.
 */
export const NEIGHBOUR_WINDOW_MS = 12 * 3_600_000;

/** Where a commitment is: a session venue or a layover location, empty when unknown. */
function whereIs(commitment: Commitment): string {
  return (commitment.kind === 'reservedSession' ? commitment.venue : commitment.location) ?? '';
}

/** Build the BuildPassFn for Pass_Sync from a schedule. */
export function buildPassFor(schedule: ScheduleView, deps: PassBuildDeps): BuildPassFn {
  const slots = layout(schedule);
  return (sessionCode) => {
    const session = schedule.sessions.find((candidate) => candidate.code === sessionCode);
    if (session === undefined) {
      throw passError('builder.unknown_session', 'The session is not in the schedule.');
    }
    const index = slots.findIndex((slot) => slot.session === session);
    const mine = slots[index];
    const candidate = index > 0 ? slots[index - 1] : undefined;
    const before =
      mine && candidate && mine.start - candidate.end <= NEIGHBOUR_WINDOW_MS
        ? candidate
        : undefined;
    const following = slots.slice(index + 1).find((slot) => slot.session !== undefined);
    const next: AdjacentSession | undefined =
      mine && following?.session && following.start - mine.end <= NEIGHBOUR_WINDOW_MS
        ? {
            sessionCode: following.session.code,
            startsAt: following.commitment.startsAt,
            venue: following.session.venue ?? '',
          }
        : undefined;
    return buildPass(
      {
        session,
        previous: before ? { commitment: before.commitment } : undefined,
        next,
        attendeeName: deps.attendeeName,
        eventWindow: deps.eventWindow,
      },
      { connections: deps.connections },
    ).fields;
  };
}

/** Build the Itinerary for the calendar and the page, with the walk before each reserved session. */
export function buildItinerary(schedule: ScheduleView, walks: ConnectionProvider): Itinerary {
  const slots = layout(schedule);
  return {
    commitments: slots.map((slot, index) => {
      const before = index > 0 ? slots[index - 1] : undefined;
      if (
        slot.session === undefined ||
        before === undefined ||
        slot.start - before.end > NEIGHBOUR_WINDOW_MS
      ) {
        return { commitment: slot.commitment };
      }
      const walkMinutes = clampedWalk(
        walks.walkMinutes(whereIs(before.commitment), slot.session.venue ?? ''),
      );
      return walkMinutes === undefined
        ? { commitment: slot.commitment }
        : { commitment: slot.commitment, walkMinutes };
    }),
  };
}
