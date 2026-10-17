// The checkReservation guardrail (itinerary-rules, S2).
//
// One function answers "should this reservation go ahead?" for every surface: the MCP server,
// the Kiro hook and the browser demo all call this same code. It composes the lower-level
// rules and never re-implements them, so each concept keeps one definition (Tight in
// connections.ts, clash in clashes.ts, and so on). It never throws and never reads a clock.
//
// Block rules:  the candidate clashes with a commitment, or makes an impossible connection.
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
import type { Context } from './context.js';
import { isOverloaded } from './energy.js';
import { checkLayovers, type LayoverReport } from './layovers.js';
import * as reason from './reasons.js';
import {
  resolveCommitment,
  sessionToCommitment,
  type ResolvedCommitment,
  type ScheduleInput,
} from './resolve.js';
import { checkZone, dayKey, parseInstant } from './time.js';

const RULES: readonly reason.RuleName[] = Object.values(reason.RULE_NAMES);

type OkClashReport = Extract<ClashReport, { status: 'ok' }>;
type OkLayoverReport = Extract<LayoverReport, { status: 'ok' }>;

/** A resolved neighbour of the candidate, with the interval it occupies. */
interface Neighbour {
  resolved: ResolvedCommitment;
  interval: Interval;
}

function mealMissingOn(report: OkLayoverReport, day: string): boolean {
  return report.days.find((entry) => entry.day === day)?.mealLayoverMissing ?? false;
}

/**
 * Check whether a candidate session can be reserved, given the current schedule.
 *
 * schedule is the attendee's commitments plus the sessions they refer to. A candidate that is
 * already in the schedule is ignored there, so it never clashes with itself.
 */
export function checkReservation(
  candidate: NormalisedSession,
  schedule: ScheduleInput,
  context: Context,
): Verdict {
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

  // Rule 2: connections to the nearest earlier and later commitment on the same event day.
  // A commitment that clashes is already reported above, so it is not judged again here.
  if (!resolvedCandidate.isAllDay) {
    const neighbours: Neighbour[] = [];
    others.forEach((commitment, index) => {
      const resolved = resolveCommitment(commitment, sessions);
      const interval = intervalOf(resolved, zone.zone);
      if (
        'missing' in interval ||
        resolved.isAllDay ||
        clashing.has(index) ||
        dayKey(interval.start, zone.zone) !== day
      ) {
        return;
      }
      neighbours.push({ resolved, interval });
    });
    const earlier = neighbours
      .filter((n) => n.interval.end <= candidateInterval.start)
      .sort((a, b) => b.interval.end - a.interval.end)[0];
    const later = neighbours
      .filter((n) => n.interval.start >= candidateInterval.end)
      .sort((a, b) => a.interval.start - b.interval.start)[0];
    const boardingOf = (item: ResolvedCommitment) =>
      boardingFor({ isReservable: item.isReservable, startsAt: item.startsAt }, context);
    const results: ConnectionResult[] = [];
    if (earlier !== undefined) {
      const toBoarding = boardingOf(resolvedCandidate);
      results.push(classifyConnection(earlier.resolved, resolvedCandidate, toBoarding, context));
    }
    if (later !== undefined) {
      const toBoarding = boardingOf(later.resolved);
      results.push(classifyConnection(resolvedCandidate, later.resolved, toBoarding, context));
    }
    for (const result of results) {
      if (result.classification === 'impossible') {
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

  return verdict();
}
