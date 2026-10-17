// Layovers and personal time (itinerary-rules, S2).
//
// A layover is personal time for a meal, water or rest. For each event day this checks two
// things, both in event-timezone wall-clock time (Req 4.8):
//   - the meal window: the day needs at least mealWindow.requiredFreeMinutes of free time
//     inside the window, where free means not overlapping any commitment (Req 4.1, 4.2);
//   - the longest unbroken stretch: a run of commitments with no gap between them that is
//     longer than maxStretchMinutes is flagged (Req 4.3, 4.4).
// When either is reported, a suggested personal-time block is placed in a gap that clashes
// with nothing, or the report says that none could be placed (Req 4.5 to 4.7). A meal block
// goes in the clash-free gap nearest the meal window; a rest block goes right after the
// longest long stretch, or right before it when the gap after is not clear.
//
// All-day items are left out of these checks: an all-day item does not use up a specific
// part of the day. A commitment with no usable start or end time cannot be placed, so it is
// listed in skipped and left out.
import type { Context } from './context.js';
import * as reason from './reasons.js';
import { intervalOf, type Interval } from './clashes.js';
import { resolveCommitment, type ScheduleInput } from './resolve.js';
import {
  checkZone,
  clockToMinutes,
  dayBounds,
  dayKey,
  instantAt,
  minutesBetween,
  toZonedIso,
} from './time.js';

/** Length of a suggested rest break, in minutes. */
export const REST_BREAK_MINUTES = 15;

const MS_PER_MINUTE = 60_000;

/** A suggested personal-time block. start and end are ISO instants in the event timezone. */
export interface SuggestedBlock {
  start: string;
  end: string;
  reason: string;
}

/** The layover findings for one event day. */
export interface DayLayover {
  /** The local day, YYYY-MM-DD. */
  day: string;
  mealLayoverMissing: boolean;
  /** Free minutes inside the meal window. */
  freeMealMinutes: number;
  /** Present when the longest unbroken stretch is over the maximum. */
  longStretchMinutes?: number;
  /** One plain-English reason for each finding. */
  reasons: string[];
  suggestions: SuggestedBlock[];
  /** Present when a needed block could not be placed in a clash-free gap. */
  noPlacementReason?: string;
}

/** A commitment left out because it has no usable start or end time. */
export interface SkippedCommitment {
  ref: string;
  reason: string;
}

/** The outcome of checking layovers. */
export type LayoverReport =
  | { status: 'ok'; days: DayLayover[]; skipped: SkippedCommitment[] }
  | { status: 'unknown'; reason: string };

/** Merge intervals that overlap or touch, sorted by start. */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && item.start <= last.end) {
      last.end = Math.max(last.end, item.end);
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

/** The parts of a window that no interval covers. busy must already be merged. */
function freeGaps(busy: readonly Interval[], window: Interval): Interval[] {
  const gaps: Interval[] = [];
  let cursor = window.start;
  for (const item of busy) {
    if (item.start > cursor) {
      gaps.push({ start: cursor, end: Math.min(item.start, window.end) });
    }
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < window.end) {
    gaps.push({ start: cursor, end: window.end });
  }
  return gaps.filter((gap) => gap.end > gap.start);
}

/** Does a candidate block overlap any busy interval? */
function isClear(candidate: Interval, busy: readonly Interval[]): boolean {
  return !busy.some((item) => item.start < candidate.end && item.end > candidate.start);
}

function block(interval: Interval, zone: string, text: string): SuggestedBlock {
  return {
    start: toZonedIso(interval.start, zone),
    end: toZonedIso(interval.end, zone),
    reason: text,
  };
}

/**
 * Check meal windows and unbroken stretches for every event day that has a commitment, or
 * only for onlyDay (a local day, YYYY-MM-DD) when it is given.
 */
export function checkLayovers(
  schedule: ScheduleInput,
  context: Context,
  onlyDay?: string,
): LayoverReport {
  const zone = checkZone(context.eventTimezone);
  if (!zone.ok) {
    return { status: 'unknown', reason: reason.zoneProblem(zone.reason) };
  }

  const skipped: SkippedCommitment[] = [];
  const busy: Interval[] = [];
  for (const commitment of schedule.commitments) {
    const resolved = resolveCommitment(commitment, schedule.sessions);
    if (resolved.isAllDay) {
      continue;
    }
    const interval = intervalOf(resolved, zone.zone);
    if ('missing' in interval) {
      skipped.push({
        ref: resolved.ref,
        reason: reason.layoverTimeMissing(resolved.ref, interval.missing),
      });
    } else {
      busy.push(interval);
    }
  }

  const merged = mergeIntervals(busy);
  const maxStretchMs = context.maxStretchMinutes * MS_PER_MINUTE;
  const requiredMinutes = context.mealWindow.requiredFreeMinutes;
  const allDays = [...new Set(busy.map((interval) => dayKey(interval.start, zone.zone)))].sort();
  const days = onlyDay === undefined ? allDays : allDays.filter((day) => day === onlyDay);

  const report = days.map((day): DayLayover => {
    const bounds = dayBounds(day, zone.zone);
    const window: Interval = {
      start: instantAt(day, clockToMinutes(context.mealWindow.start), 0, zone.zone),
      end: instantAt(day, clockToMinutes(context.mealWindow.end), 0, zone.zone),
    };
    const gaps = freeGaps(merged, window);
    const freeMealMinutes = gaps.reduce(
      (total, gap) => total + minutesBetween(gap.start, gap.end),
      0,
    );
    const mealLayoverMissing = freeMealMinutes < requiredMinutes;

    // Unbroken stretches are built from the commitments that start on this day.
    const stretches = mergeIntervals(
      busy.filter((interval) => dayKey(interval.start, zone.zone) === day),
    );
    // A listed day always has at least one commitment that starts on it.
    const longest = stretches.reduce(
      (best, stretch) => (stretch.end - stretch.start > best.end - best.start ? stretch : best),
      stretches[0] as Interval,
    );
    const long = longest.end - longest.start > maxStretchMs ? longest : undefined;

    const reasons: string[] = [];
    const suggestions: SuggestedBlock[] = [];
    const failures: string[] = [];
    const placed: Interval[] = [];

    if (mealLayoverMissing) {
      reasons.push(reason.mealLayoverMissing(day, freeMealMinutes, requiredMinutes));
      // Free time inside the window can never be long enough (it is below the need), so the
      // block goes in the clash-free gap of the day that lies nearest to the window.
      const needed = requiredMinutes * MS_PER_MINUTE;
      const candidates = freeGaps(merged, bounds)
        .filter((gap) => gap.end - gap.start >= needed)
        .map((gap) => Math.min(Math.max(window.start, gap.start), gap.end - needed))
        .sort((x, y) => Math.abs(x - window.start) - Math.abs(y - window.start));
      const start = candidates[0];
      if (start === undefined) {
        failures.push(reason.noPlacement('meal'));
      } else {
        const meal = { start, end: start + needed };
        placed.push(meal);
        suggestions.push(block(meal, zone.zone, reason.suggestMealBlock()));
      }
    }

    if (long !== undefined) {
      const longMinutes = minutesBetween(long.start, long.end);
      reasons.push(reason.longStretch(day, longMinutes, context.maxStretchMinutes));
      const length = REST_BREAK_MINUTES * MS_PER_MINUTE;
      const taken = [...busy, ...placed];
      const after = { start: long.end, end: long.end + length };
      const before = { start: long.start - length, end: long.start };
      if (after.end <= bounds.end && isClear(after, taken)) {
        suggestions.push(block(after, zone.zone, reason.suggestRestBlock('after')));
      } else if (before.start >= bounds.start && isClear(before, taken)) {
        suggestions.push(block(before, zone.zone, reason.suggestRestBlock('before')));
      } else {
        failures.push(reason.noPlacement('rest'));
      }
    }

    return {
      day,
      mealLayoverMissing,
      freeMealMinutes,
      longStretchMinutes: long && minutesBetween(long.start, long.end),
      reasons,
      suggestions,
      noPlacementReason: failures.length > 0 ? failures.join(' ') : undefined,
    };
  });

  return { status: 'ok', days: report, skipped };
}
