// Helpers shared by the tool handlers.

import type { Commitment, NormalisedSession, ScheduleWire } from '@compass/contracts';
import { CompassError } from '../ports/errors.js';
import type { CatalogView, EventWindow } from '../ports/events-port.js';
import type { ToolContext } from '../server/types.js';

/** Throws NotSignedIn unless the attendee is signed in. Simulated mode is signed in at once. */
export async function ensureSignedIn(ctx: ToolContext): Promise<void> {
  if (!(await ctx.runtime.events.isSignedIn())) {
    throw new CompassError('NotSignedIn');
  }
}

/** A fresh, confirmed schedule and the event window it was read against. */
export interface FreshSchedule {
  schedule: ScheduleWire;
  window: EventWindow;
}

/**
 * Reads the schedule from S1 (never from a cache) and the event window, and updates the
 * Schedule_Snapshot (Requirement 12.8) so the hooks can read it.
 */
export async function readFreshSchedule(ctx: ToolContext): Promise<FreshSchedule> {
  const { events, snapshot, clock, mode } = ctx.runtime;
  const schedule = await events.getSchedule();
  const window = await events.eventWindow();
  await snapshot.write({
    version: 1,
    mode,
    fetchedAt: clock.now().toISOString(),
    eventWindow: window,
    schedule,
  });
  return { schedule, window };
}

/** A reserved-session commitment for a catalog session. Missing times become empty strings. */
export function commitmentFor(session: NormalisedSession): Commitment {
  return {
    kind: 'reservedSession',
    sessionId: session.sessionId,
    startsAt: session.startsAt ?? '',
    endsAt: session.endsAt ?? '',
    title: session.title,
    ...(session.venue === undefined ? {} : { venue: session.venue }),
  };
}

/**
 * The confirmed schedule as commitments: reserved sessions the catalog knows, and personal
 * time. A reserved session missing from the catalog cannot be placed in time and is left out.
 */
export function confirmedCommitments(schedule: ScheduleWire, lookup: CatalogView): Commitment[] {
  const commitments: Commitment[] = [];
  for (const id of schedule.reserved) {
    const entry = lookup.byId.get(id);
    if (entry !== undefined) {
      commitments.push(commitmentFor(entry.session));
    }
  }
  for (const time of schedule.personalTime) {
    commitments.push({
      kind: 'personalTime',
      title: time.title,
      startsAt: time.startDateTime,
      endsAt: time.endDateTime,
      personalTimeId: time.personalTimeId,
      ...(time.location === undefined ? {} : { location: time.location }),
    });
  }
  return commitments;
}
