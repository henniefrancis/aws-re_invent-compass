// Energy budget and the single overload interface (itinerary-rules, S2).
//
// The Energy_Budget scores one event day for load, with a named, explainable formula:
//
//   Energy_Budget = (commitmentCount * 10) + totalWalkingMinutes + (venueChangeCount * 15)
//
// commitmentCount is every commitment on the day. totalWalkingMinutes is the sum of the
// connection walking minutes (matrix value plus buffer) between consecutive commitments.
// venueChangeCount is the number of consecutive pairs whose venues differ. A day is overloaded
// when the score is strictly greater than Context.overloadThreshold (Req 5.1 to 5.6).
//
// A commitment with no venue or no usable time is counted but left out of the walking and
// venue-change totals, and the explanation names it (Req 5.7). All-day items are counted but not
// sequenced, because they do not sit between two other commitments.
//
// The guardrail asks about overload only through isOverloaded. The full formula stands behind
// it. The count-only fallback (Req 5.9) is kept in isOverloadedByCount: a day with more than
// overloadCountThreshold commitments is overloaded. Either can stand behind isOverloaded without
// the guardrail changing.
import type { Context } from './context.js';
import * as reason from './reasons.js';
import type { ResolvedCommitment } from './resolve.js';
import { parseInstant } from './time.js';
import { extraBufferMinutes, lookupWalk, sameVenue } from './venue-data.js';

const COMMITMENT_WEIGHT = 10;
const VENUE_CHANGE_WEIGHT = 15;

/** The Energy_Budget for one day, with everything that went into it. */
export interface EnergyResult {
  score: number;
  commitmentCount: number;
  totalWalkingMinutes: number;
  venueChangeCount: number;
  overloaded: boolean;
  /** Plain English. Names the three inputs, the formula and any missing data. */
  explanation: string;
  /** One note for each commitment or walk that was left out of the totals. */
  missingDataNotes: string[];
}

/** The answer to "is this day overloaded?", with a plain-English explanation. */
export interface OverloadResult {
  overloaded: boolean;
  explanation: string;
}

/** Is a commitment complete enough to count toward walking and venue changes? */
function isPlaceable(item: ResolvedCommitment): boolean {
  return (
    item.venue !== undefined &&
    item.startsAt !== undefined &&
    (item.isAllDay || item.endsAt !== undefined) &&
    !item.missing.includes('order')
  );
}

/** Score one day. dayCommitments are the resolved commitments that fall on the day. */
export function scoreEnergy(
  dayCommitments: readonly ResolvedCommitment[],
  context: Context,
): EnergyResult {
  // Personal time with no location is "stay put", not missing data: it is counted, not sequenced.
  const missingDataNotes = dayCommitments
    .filter((item) => !isPlaceable(item) && item.stayPut !== true)
    .map((item) => reason.energyDataMissing(item.ref));

  // Consecutive commitments, in time order. All-day items are counted but not sequenced.
  const sequence = dayCommitments
    .filter((item) => isPlaceable(item) && !item.isAllDay)
    .sort((a, b) => (parseInstant(a.startsAt) as number) - (parseInstant(b.startsAt) as number));

  let totalWalkingMinutes = 0;
  let venueChangeCount = 0;
  let usedEstimate = false;
  for (let i = 1; i < sequence.length; i += 1) {
    const from = sequence[i - 1] as ResolvedCommitment;
    const to = sequence[i] as ResolvedCommitment;
    const fromVenue = from.venue as string;
    const toVenue = to.venue as string;
    if (!sameVenue(context.venueData, fromVenue, toVenue)) {
      venueChangeCount += 1;
    }
    const walk = lookupWalk(context.venueData, fromVenue, toVenue);
    if (walk.found) {
      totalWalkingMinutes += walk.minutes + extraBufferMinutes(walk.source, context.bufferMinutes);
      usedEstimate = usedEstimate || walk.source.kind === 'estimate';
    } else {
      missingDataNotes.push(reason.energyWalkUnknown(fromVenue, toVenue));
    }
  }

  const commitmentCount = dayCommitments.length;
  const score =
    commitmentCount * COMMITMENT_WEIGHT +
    totalWalkingMinutes +
    venueChangeCount * VENUE_CHANGE_WEIGHT;
  const overloaded = score > context.overloadThreshold;
  const explanation = [
    reason.energyExplanation(score, commitmentCount, totalWalkingMinutes, venueChangeCount),
    reason.energyOverloadVerdict(overloaded, context.overloadThreshold),
    ...(usedEstimate ? [reason.energyEstimateNote()] : []),
    ...missingDataNotes,
  ].join(' ');
  return {
    score,
    commitmentCount,
    totalWalkingMinutes,
    venueChangeCount,
    overloaded,
    explanation,
    missingDataNotes,
  };
}

/**
 * The count-only fallback: a day with more commitments than Context.overloadCountThreshold is
 * overloaded; equal or fewer is not (Req 5.9).
 */
export function isOverloadedByCount(
  dayCommitments: readonly ResolvedCommitment[],
  context: Context,
): OverloadResult {
  const count = dayCommitments.length;
  const overloaded = count > context.overloadCountThreshold;
  return {
    overloaded,
    explanation: reason.energyCountOnly(count, context.overloadCountThreshold, overloaded),
  };
}

/**
 * Is the day overloaded? This is the one interface the guardrail calls. The full energy
 * formula stands behind it.
 */
export function isOverloaded(
  dayCommitments: readonly ResolvedCommitment[],
  context: Context,
): OverloadResult {
  const { overloaded, explanation } = scoreEnergy(dayCommitments, context);
  return { overloaded, explanation };
}
