// Per-day helpers (itinerary-rules, S2).
//
// The MCP server and the showcase site need the connections and the energy score for one day of
// a schedule. These two helpers build that from a schedule, so callers never rebuild the internal
// commitment resolution themselves. They only compose other rules: connection verdicts come from
// classifyConnection and the score from scoreEnergy.
//
// Both take an optional local day (YYYY-MM-DD). With a day, only commitments that start on that
// event day are used. Without one, every commitment in the schedule is treated as one day. A
// commitment with no usable start time cannot be placed on a day, so it is listed in skipped.
import { boardingFor } from './boarding.js';
import { classifyConnection, type ConnectionResult } from './connections.js';
import type { Context } from './context.js';
import { scoreEnergy, type EnergyResult } from './energy.js';
import * as reason from './reasons.js';
import {
  inheritStayPutVenues,
  resolveCommitment,
  type ResolvedCommitment,
  type ScheduleInput,
} from './resolve.js';
import { checkZone, dayKey, parseInstant } from './time.js';

/** The verdict for the walk between two consecutive commitments. */
export interface DayConnection {
  /** The name of the commitment the attendee walks from. */
  from: string;
  /** The name of the commitment the attendee walks to. */
  to: string;
  result: ConnectionResult;
}

/** A commitment left out of a day view because it has no usable start time. */
export interface DaySkipped {
  ref: string;
  reason: string;
}

/** The connections for one day, or "unknown" when the timezone is unusable. */
export type DayConnections =
  | { status: 'ok'; connections: DayConnection[]; skipped: DaySkipped[] }
  | { status: 'unknown'; reason: string };

/** The energy score for one day, or "unknown" when the timezone is unusable. */
export type DayEnergy =
  | { status: 'ok'; energy: EnergyResult; skipped: DaySkipped[] }
  | { status: 'unknown'; reason: string };

/** The commitments of a day, resolved, plus the ones that could not be placed on a day. */
function dayItems(
  schedule: ScheduleInput,
  zone: string,
  day: string | undefined,
): { items: ResolvedCommitment[]; skipped: DaySkipped[] } {
  const items: ResolvedCommitment[] = [];
  const skipped: DaySkipped[] = [];
  for (const commitment of schedule.commitments) {
    const resolved = resolveCommitment(commitment, schedule.sessions);
    if (resolved.startsAt === undefined) {
      skipped.push({ ref: resolved.ref, reason: reason.dayViewTimeMissing(resolved.ref) });
    } else if (
      day === undefined ||
      dayKey(parseInstant(resolved.startsAt) as number, zone) === day
    ) {
      items.push(resolved);
    }
  }
  return { items, skipped };
}

/**
 * The connection verdicts between consecutive commitments, in time order. All-day items are not
 * part of a walk, so they are left out. The schedule and context are not changed.
 */
export function connectionsForDay(
  schedule: ScheduleInput,
  context: Context,
  day?: string,
): DayConnections {
  const zone = checkZone(context.eventTimezone);
  if (!zone.ok) {
    return { status: 'unknown', reason: reason.zoneProblem(zone.reason) };
  }
  const { items, skipped } = dayItems(schedule, zone.zone, day);
  const sequence = items
    .filter((item) => !item.isAllDay)
    .sort((a, b) => (parseInstant(a.startsAt) as number) - (parseInstant(b.startsAt) as number));
  // Personal time with no location means "stay put": it takes the venue of what came before it,
  // and no connection is drawn into it (nobody walks anywhere to stay put).
  const filled = inheritStayPutVenues(sequence);
  const connections: DayConnection[] = [];
  for (let i = 1; i < filled.length; i += 1) {
    const from = filled[i - 1] as ResolvedCommitment;
    const to = filled[i] as ResolvedCommitment;
    if (to.stayPut === true || (from.stayPut === true && from.venue === undefined)) {
      continue;
    }
    const toBoarding = boardingFor(
      { isReservable: to.isReservable, startsAt: to.startsAt },
      context,
    );
    connections.push({
      from: from.ref,
      to: to.ref,
      result: classifyConnection(from, to, toBoarding, context),
    });
  }
  return { status: 'ok', connections, skipped };
}

/** The energy score for one day of a schedule. The schedule and context are not changed. */
export function energyForDay(schedule: ScheduleInput, context: Context, day?: string): DayEnergy {
  const zone = checkZone(context.eventTimezone);
  if (!zone.ok) {
    return { status: 'unknown', reason: reason.zoneProblem(zone.reason) };
  }
  const { items, skipped } = dayItems(schedule, zone.zone, day);
  return { status: 'ok', energy: scoreEnergy(items, context), skipped };
}
