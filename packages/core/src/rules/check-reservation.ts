// The checkReservation guardrail (itinerary-rules, S2).
//
// One function answers "should this reservation go ahead?" for every surface: the MCP server,
// the Kiro hook and the browser demo all call this same code. It composes the lower-level
// rules and never re-implements them, so each concept keeps one definition (Tight in
// connections.ts, clash in clashes.ts, and so on). It never throws and never reads a clock.
//
// Block rules:  the candidate clashes with a commitment, or makes an impossible connection based
//               on an official walking time. An impossible connection based on an estimated walk
//               is only a warning ("likely impossible").
// Warn rules:   a tight connection, losing the day's only meal break, or pushing the day over
//               the overload line.
// Missing data: a rule that cannot be judged is skipped, never blocked on, and the verdict is
//               at least "warn" with a reason that names the rule.
// Precedence:   block if any block rule applies, else warn if any warn rule or missing-data
//               case applies, else allow. There is one reason for every rule that applied.
import type { NormalisedSession, Verdict } from '@compass/contracts';
import { boardingFor } from './boarding.js';
import { findClashes, intervalOf, type ClashReport, type Interval } from './clashes.js';
import { classifyConnection, type ConnectionResult } from './connections.js';
import { ContextSchema, type Context } from './context.js';
import { isOverloaded } from './energy.js';
import { checkLayovers, type LayoverReport } from './layovers.js';
import * as reason from './reasons.js';
import {
  inheritStayPutVenues,
  isSeatFull,
  resolveCommitment,
  sessionToCommitment,
  type ResolvedCommitment,
  type ScheduleInput,
} from './resolve.js';
import { checkZone, dayKey, parseInstant } from './time.js';

// The four rules that need a usable timezone and candidate times. The timing check is separate.
const RULES: readonly reason.RuleName[] = [
  reason.RULE_NAMES.clash,
  reason.RULE_NAMES.connection,
  reason.RULE_NAMES.meal,
  reason.RULE_NAMES.energy,
];

/** How far away, in either direction and across midnight, a neighbouring commitment can be. */
export const NEIGHBOUR_WINDOW_HOURS = 12;
const NEIGHBOUR_WINDOW_MS = NEIGHBOUR_WINDOW_HOURS * 3_600_000;

type OkClashReport = Extract<ClashReport, { status: 'ok' }>;
type OkLayoverReport = Extract<LayoverReport, { status: 'ok' }>;

/** A resolved neighbour of the candidate, with the interval it occupies. */
interface Neighbour {
  resolved: ResolvedCommitment;
  interval: Interval;
  isCandidate: boolean;
}

function mealMissingOn(report: OkLayoverReport, day: string): boolean {
  return report.days.find((entry) => entry.day === day)?.mealLayoverMissing ?? false;
}

/** The most commitments in a schedule that the guardrail will judge in one call. */
export const MAX_COMMITMENTS = 200;

/**
 * Check whether a candidate session can be reserved, given the current schedule.
 *
 * schedule is the attendee's commitments plus the sessions they refer to. A candidate that is
 * already in the schedule is ignored there, so it never clashes with itself.
 *
 * This function never throws. It fails closed: if anything unexpected goes wrong, it returns a
 * "block" verdict with a fixed internal-error reason. Consumers must still treat a throw (from a
 * caller bug outside this function) as a block. A Context that is not valid (a bad tuning value
 * or bad venue data) and a schedule with more than MAX_COMMITMENTS commitments both give "warn"
 * with a reason, never "allow".
 */
export function checkReservation(
  candidate: NormalisedSession,
  schedule: ScheduleInput,
  context: Context,
): Verdict {
  try {
    return judgeReservation(candidate, schedule, context);
  } catch {
    return { decision: 'block', reasons: [reason.guardInternalError()] };
  }
}

function judgeReservation(
  candidate: NormalisedSession,
  schedule: ScheduleInput,
  context: Context,
): Verdict {
  const validation = ContextSchema.safeParse(context);
  if (!validation.success) {
    const first = validation.error.issues[0] as { path: PropertyKey[] };
    const setting = String(first.path[0] ?? 'context');
    return { decision: 'warn', reasons: [reason.guardContextInvalid(setting)] };
  }
  if (schedule.commitments.length > MAX_COMMITMENTS) {
    return { decision: 'warn', reasons: [reason.guardScheduleTooLarge(MAX_COMMITMENTS)] };
  }

  const blocks: string[] = [];
  const warns: string[] = [];
  const missing: string[] = [];
  const skip = (rule: reason.RuleName, detail: string): void => {
    missing.push(reason.guardMissingData(rule, detail));
  };
  const skipAll = (detail: string): void => RULES.forEach((rule) => skip(rule, detail));
  const verdict = (): Verdict => {
    if (blocks.length > 0) {
      return { decision: 'block', reasons: [...blocks, ...warns, ...missing] };
    }
    if (warns.length > 0 || missing.length > 0) {
      return { decision: 'warn', reasons: [...warns, ...missing] };
    }
    return { decision: 'allow', reasons: [] };
  };

  const candidateCommitment = sessionToCommitment(candidate);
  const sessions = { ...schedule.sessions, [candidate.sessionId]: candidate };
  const others = schedule.commitments.filter(
    (commitment) =>
      !(commitment.kind === 'reservedSession' && commitment.sessionId === candidate.sessionId),
  );
  const resolvedCandidate = resolveCommitment(candidateCommitment, sessions);

  // Every rule is time-dependent, so a missing timezone or candidate time skips all of them.
  const zone = checkZone(context.eventTimezone);
  if (!zone.ok) {
    skipAll(reason.zoneProblem(zone.reason));
    return verdict();
  }
  const candidateInterval = intervalOf(resolvedCandidate, zone.zone);
  if ('missing' in candidateInterval) {
    skipAll(reason.missingTime(resolvedCandidate.ref, candidateInterval.missing));
    return verdict();
  }
  const day = dayKey(candidateInterval.start, zone.zone);

  // Rule 1: clash. Position 0 is the candidate.
  const clashReport = findClashes(
    { commitments: [candidateCommitment, ...others], sessions },
    context,
  ) as OkClashReport;
  const clashing = new Set<number>();
  for (const clash of clashReport.clashes) {
    if (clash.aIndex === 0) {
      clashing.add(clash.bIndex - 1);
      blocks.push(clash.reason);
    }
  }
  const unknownOther = clashReport.unknown.find((entry) => entry.index !== 0);
  if (unknownOther !== undefined) {
    skip(reason.RULE_NAMES.clash, unknownOther.reason);
  }

  // Rule 2: connections to the nearest earlier and later commitment within 12 hours, across
  // midnight. A commitment that clashes is already reported above, so it is not judged again.
  // Personal time with no location means "stay put": it takes the venue of the commitment before
  // it, and no connection is drawn into it.
  if (!resolvedCandidate.isAllDay) {
    const entries: Neighbour[] = [
      { resolved: resolvedCandidate, interval: candidateInterval, isCandidate: true },
    ];
    others.forEach((commitment, index) => {
      const resolved = resolveCommitment(commitment, sessions);
      const interval = intervalOf(resolved, zone.zone);
      if ('missing' in interval || resolved.isAllDay || clashing.has(index)) {
        return;
      }
      entries.push({ resolved, interval, isCandidate: false });
    });
    entries.sort((a, b) => a.interval.start - b.interval.start);
    const filled = inheritStayPutVenues(entries.map((entry) => entry.resolved));
    const view = entries.map((entry, i) => ({
      ...entry,
      resolved: filled[i] as ResolvedCommitment,
    }));
    const me = view.find((entry) => entry.isCandidate) as Neighbour;
    const earlier = view
      .filter(
        (n) =>
          !n.isCandidate &&
          n.interval.end <= me.interval.start &&
          me.interval.start - n.interval.end <= NEIGHBOUR_WINDOW_MS,
      )
      .sort((a, b) => b.interval.end - a.interval.end)[0];
    const later = view
      .filter(
        (n) =>
          !n.isCandidate &&
          n.interval.start >= me.interval.end &&
          n.interval.start - me.interval.end <= NEIGHBOUR_WINDOW_MS,
      )
      .sort((a, b) => a.interval.start - b.interval.start)[0];
    const boardingOf = (item: ResolvedCommitment) =>
      boardingFor({ isReservable: item.isReservable, startsAt: item.startsAt }, context);
    const results: ConnectionResult[] = [];
    // Stay-put time with nothing before it has no venue to leave from, so there is no connection.
    if (
      earlier !== undefined &&
      !(earlier.resolved.stayPut === true && earlier.resolved.venue === undefined)
    ) {
      const toBoarding = boardingOf(me.resolved);
      results.push(classifyConnection(earlier.resolved, me.resolved, toBoarding, context));
    }
    // Nobody walks anywhere to stay put, so no connection is drawn into stay-put time.
    if (later !== undefined && later.resolved.stayPut !== true) {
      const toBoarding = boardingOf(later.resolved);
      results.push(classifyConnection(me.resolved, later.resolved, toBoarding, context));
    }
    for (const result of results) {
      if (result.classification === 'impossible' && result.estimate === true) {
        // An impossible walk that rests on an estimate is a warning, never a block.
        warns.push(reason.connectionAlert('likely', result.reason));
      } else if (result.classification === 'impossible') {
        blocks.push(reason.connectionAlert('impossible', result.reason));
      } else if (result.classification === 'tight') {
        warns.push(reason.connectionAlert('tight', result.reason));
      } else if (result.classification === 'unknown') {
        skip(reason.RULE_NAMES.connection, result.reason);
      }
    }
  }

  // Rule 3: the day's only meal break. Warn only when it goes from present to missing.
  if (!resolvedCandidate.isAllDay) {
    const before = checkLayovers(
      { commitments: others, sessions },
      context,
      day,
    ) as OkLayoverReport;
    const after = checkLayovers(
      { commitments: [candidateCommitment, ...others], sessions },
      context,
      day,
    ) as OkLayoverReport;
    if (after.skipped.length > 0) {
      skip(reason.RULE_NAMES.meal, (after.skipped[0] as { reason: string }).reason);
    }
    if (!mealMissingOn(before, day) && mealMissingOn(after, day)) {
      warns.push(reason.guardMealLost(day));
    }
  }

  // Rule 4: the day's energy. Warn only when overload goes from false to true.
  const resolvedOthers = others.map((commitment) => resolveCommitment(commitment, sessions));
  const unplaced = resolvedOthers.find((item) => item.startsAt === undefined);
  if (unplaced !== undefined) {
    skip(reason.RULE_NAMES.energy, reason.missingTime(unplaced.ref, 'start'));
  }
  const onDay = (item: ResolvedCommitment): boolean =>
    item.startsAt !== undefined && dayKey(parseInstant(item.startsAt) as number, zone.zone) === day;
  const dayOthers = resolvedOthers.filter(onDay);
  const overloadBefore = isOverloaded(dayOthers, context);
  const overloadAfter = isOverloaded([resolvedCandidate, ...dayOthers], context);
  if (!overloadBefore.overloaded && overloadAfter.overloaded) {
    warns.push(reason.guardOverload(day, overloadAfter.explanation));
  }

  // Timing: the current time comes only from Context.now. Warn when the session is already over,
  // or boarding has closed so a reserved seat would already be released.
  const nowMs = parseInstant(context.now);
  if (nowMs === undefined) {
    skip(reason.RULE_NAMES.timing, reason.guardNowUnusable());
  } else if (nowMs >= candidateInterval.end) {
    warns.push(reason.guardPast(resolvedCandidate.ref));
  } else {
    const boarding = boardingFor(
      { isReservable: resolvedCandidate.isReservable, startsAt: resolvedCandidate.startsAt },
      context,
    );
    if (boarding.status === 'closes' && nowMs >= (parseInstant(boarding.at) as number)) {
      warns.push(reason.guardBoardingClosed(resolvedCandidate.ref));
    }
  }

  // Seats: a full session means the attendee would have to join the walk-up line.
  if (isSeatFull(candidate)) {
    warns.push(reason.guardSeatsFull(resolvedCandidate.ref));
  }

  return verdict();
}
