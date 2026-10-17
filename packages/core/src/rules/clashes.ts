// Clash detection (itinerary-rules, S2).
//
// Two commitments clash when they overlap by one second or more (Req 3.1). Identical
// start and end instants clash (Req 3.4). Touching at a single instant does not (Req 3.5).
// An all-day item occupies 00:00:00 to 23:59:59 of its event day in the event timezone
// (Req 3.2). A commitment that crosses midnight is judged on its start and end instants
// (Req 3.3). A commitment with no usable end time cannot be checked, so it is reported as
// unknown and takes no part in any pair (Req 3.7). A missing or unrecognised timezone makes
// the whole check unknown (Req 3.8).
import type { Context } from './context.js';
import * as reason from './reasons.js';
import { resolveCommitment, type ResolvedCommitment, type ScheduleInput } from './resolve.js';
import { checkZone, dayKey, formatLocal, instantAt, parseInstant } from './time.js';

/** A span of time, in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

/** Two commitments that overlap. a and b are their positions in the input. */
export interface ClashPair {
  a: string;
  b: string;
  aIndex: number;
  bIndex: number;
  /** The overlapping range in the event timezone, for example "2026-12-01 10:00 to 10:30". */
  overlap: string;
  reason: string;
}

/** A commitment that could not be checked, and why. */
export interface ClashUnknown {
  ref: string;
  index: number;
  reason: string;
}

/** The outcome of checking a schedule for clashes. */
export type ClashReport =
  | { status: 'ok'; clashes: ClashPair[]; unknown: ClashUnknown[] }
  | { status: 'unknown'; reason: string };

const LAST_SECOND_OF_DAY = 23 * 60 + 59;

/**
 * The interval a resolved commitment occupies, or the name of the time that is missing.
 * An all-day item needs only a start: it occupies the whole event day of that start.
 */
export function intervalOf(
  resolved: ResolvedCommitment,
  zone: string,
): Interval | { missing: 'start' | 'end' } {
  if (resolved.startsAt === undefined) {
    return { missing: 'start' };
  }
  const start = parseInstant(resolved.startsAt) as number;
  if (resolved.isAllDay) {
    const day = dayKey(start, zone);
    return { start: instantAt(day, 0, 0, zone), end: instantAt(day, LAST_SECOND_OF_DAY, 59, zone) };
  }
  if (resolved.endsAt === undefined) {
    return { missing: 'end' };
  }
  return { start, end: parseInstant(resolved.endsAt) as number };
}

/** Do two intervals clash: identical, or overlapping by one second or more? */
export function intervalsClash(a: Interval, b: Interval): boolean {
  const identical = a.start === b.start && a.end === b.end;
  return identical || Math.min(a.end, b.end) - Math.max(a.start, b.start) >= 1000;
}

/** Find every pair of clashing commitments in a schedule. */
export function findClashes(schedule: ScheduleInput, context: Context): ClashReport {
  const zone = checkZone(context.eventTimezone);
  if (!zone.ok) {
    return { status: 'unknown', reason: reason.zoneProblem(zone.reason) };
  }
  const resolved = schedule.commitments.map((commitment) =>
    resolveCommitment(commitment, schedule.sessions),
  );
  const intervals = resolved.map((item) => intervalOf(item, zone.zone));

  const unknown: ClashUnknown[] = [];
  intervals.forEach((interval, index) => {
    if ('missing' in interval) {
      const item = resolved[index] as ResolvedCommitment;
      unknown.push({
        ref: item.ref,
        index,
        reason: reason.clashTimeMissing(item.ref, interval.missing),
      });
    }
  });

  const clashes: ClashPair[] = [];
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      const a = intervals[i] as Interval | { missing: 'start' | 'end' };
      const b = intervals[j] as Interval | { missing: 'start' | 'end' };
      if ('missing' in a || 'missing' in b || !intervalsClash(a, b)) {
        continue;
      }
      const from = formatLocal(Math.max(a.start, b.start), zone.zone);
      const to = formatLocal(Math.min(a.end, b.end), zone.zone);
      const aRef = (resolved[i] as ResolvedCommitment).ref;
      const bRef = (resolved[j] as ResolvedCommitment).ref;
      clashes.push({
        a: aRef,
        b: bRef,
        aIndex: i,
        bIndex: j,
        overlap: `${from} to ${to}`,
        reason: reason.clashOverlap(aRef, bRef, from, to),
      });
    }
  }
  return { status: 'ok', clashes, unknown };
}
