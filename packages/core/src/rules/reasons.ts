// Plain-English reason builders (itinerary-rules, S2). Internal, not exported by index.ts.
//
// Every reason and warning string the engine produces is built here, so this is the one
// place that guarantees the product voice (Req 8.10, 11.6, 12.3):
//   - no em dash and no en dash ever reach output (clean replaces them with a hyphen),
//   - every sentence stays within 20 words (names and times are capped before use),
//   - sentences are short and calm, written for a first-time attendee.
//
// Free text that comes from a caller (a session code, a title, a venue name) is capped
// at four words and 30 characters by label. Times and days are capped at two words by
// stamp. Templates are short, so even a sentence naming two things stays under 20 words.
import type { ZoneProblem } from './time.js';

// An em dash, an en dash and the horizontal bar. All are replaced by a hyphen.
const DASHES = new RegExp(
  `[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}${String.fromCharCode(0x2015)}]`,
  'g',
);

/** Replace every em dash and en dash with a hyphen. */
export function clean(text: string): string {
  return text.replace(DASHES, '-');
}

/** A short, safe name for a commitment, venue or code: at most four words, 30 characters. */
export function label(text: string): string {
  const words = clean(text).split(/\s+/).filter(Boolean).slice(0, 4).join(' ').slice(0, 30).trim();
  return words === '' ? 'unnamed item' : words;
}

/** A short, safe time or day stamp: at most two words, 20 characters. */
export function stamp(text: string): string {
  return clean(text).split(/\s+/).filter(Boolean).slice(0, 2).join(' ').slice(0, 20);
}

/** Whole minutes with the right noun, for example "1 minute" or "20 minutes". */
export function mins(count: number): string {
  const rounded = Math.round(count);
  return rounded === 1 ? '1 minute' : `${rounded} minutes`;
}

/** The names of the guardrail rules, used when a rule cannot be judged. */
export const RULE_NAMES = {
  clash: 'clash check',
  connection: 'connection check',
  meal: 'meal break check',
  energy: 'energy check',
} as const;

export type RuleName = (typeof RULE_NAMES)[keyof typeof RULE_NAMES];

// ---------------------------------------------------------------------------
// Timezone and missing data
// ---------------------------------------------------------------------------

/** The event timezone is missing or not recognised. */
export function zoneProblem(reason: ZoneProblem): string {
  return reason === 'missing'
    ? 'The event timezone is missing. Times cannot be judged.'
    : 'The event timezone is not recognised. Times cannot be judged.';
}

/** A start or end time is missing for a commitment. */
export function missingTime(ref: string, what: 'start' | 'end'): string {
  return `The ${what} time of ${label(ref)} is missing.`;
}

// ---------------------------------------------------------------------------
// Boarding
// ---------------------------------------------------------------------------

export function boardingCloses(localTime: string): string {
  return `Boarding closes at ${stamp(localTime)}. Your seat is released then.`;
}

export function boardingNotApplicable(): string {
  return 'This session needs no reservation, so it has no boarding time.';
}

export function boardingMissingStart(): string {
  return 'The start time is missing, so the boarding time is unknown.';
}

export function boardingMissingReservability(): string {
  return 'The reservation flag is missing, so the boarding time is unknown.';
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function walkSentence(from: string, to: string, minutes: number, estimate: boolean): string {
  const tail = estimate ? ', an estimate' : '';
  return `The walk from ${label(from)} to ${label(to)} is ${mins(minutes)}${tail}.`;
}

export function connectionComfortable(
  from: string,
  to: string,
  minutes: number,
  estimate: boolean,
  spare: number,
): string {
  return `${walkSentence(from, to, minutes, estimate)} You arrive ${mins(spare)} before it is due.`;
}

export function connectionTight(
  from: string,
  to: string,
  minutes: number,
  estimate: boolean,
  spare: number,
): string {
  return `${walkSentence(from, to, minutes, estimate)} That leaves only ${mins(spare)} to spare.`;
}

export function connectionImpossible(
  from: string,
  to: string,
  minutes: number,
  estimate: boolean,
  late: number,
): string {
  return `${walkSentence(from, to, minutes, estimate)} You would arrive ${mins(late)} late.`;
}

export function connectionVenueMissing(ref: string): string {
  return `The venue for ${label(ref)} is missing. The connection is unknown.`;
}

export function connectionVenueNotListed(venue: string): string {
  return `${label(venue)} is not in the venue list. The connection is unknown.`;
}

export function connectionPairMissing(from: string, to: string): string {
  return `No walking time is listed from ${label(from)} to ${label(to)}. The connection is unknown.`;
}

export function connectionBoardingMissing(ref: string): string {
  return `The boarding time for ${label(ref)} is missing. The connection is unknown.`;
}

export function connectionTimeMissing(ref: string, what: 'start' | 'end'): string {
  return `${missingTime(ref, what)} The connection is unknown.`;
}

/** A guardrail headline placed in front of a connection reason. */
export function connectionAlert(kind: 'tight' | 'impossible', reason: string): string {
  return kind === 'tight' ? `Tight connection. ${reason}` : `Impossible connection. ${reason}`;
}

// ---------------------------------------------------------------------------
// Clashes
// ---------------------------------------------------------------------------

export function clashOverlap(a: string, b: string, from: string, to: string): string {
  return `${label(a)} and ${label(b)} overlap from ${stamp(from)} to ${stamp(to)}.`;
}

export function clashTimeMissing(ref: string, what: 'start' | 'end'): string {
  return `${missingTime(ref, what)} It cannot be checked for clashes.`;
}

// ---------------------------------------------------------------------------
// Layovers
// ---------------------------------------------------------------------------

export function mealLayoverMissing(
  day: string,
  freeMinutes: number,
  requiredMinutes: number,
): string {
  return `On ${stamp(day)} you have ${mins(freeMinutes)} free in the meal window. You need ${mins(requiredMinutes)}.`;
}

export function longStretch(day: string, minutes: number, maxMinutes: number): string {
  return `On ${stamp(day)} you have ${mins(minutes)} without a break. The limit is ${mins(maxMinutes)}.`;
}

export function layoverTimeMissing(ref: string, what: 'start' | 'end'): string {
  return `${missingTime(ref, what)} It is left out of the break checks.`;
}

export function dayViewTimeMissing(ref: string): string {
  return `${missingTime(ref, 'start')} It is left out of the day view.`;
}

export function suggestMealBlock(): string {
  return 'Take a meal break in this gap.';
}

export function suggestRestBlock(placement: 'after' | 'before'): string {
  return `Take a short rest ${placement} the long stretch.`;
}

export function noPlacement(kind: 'meal' | 'rest'): string {
  return `No clash-free gap was found for a ${kind} block.`;
}

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

export function energyExplanation(
  score: number,
  commitments: number,
  walkingMinutes: number,
  venueChanges: number,
): string {
  return (
    `Energy score is ${Math.round(score)}: ${Math.round(commitments)} commitments times 10, ` +
    `${Math.round(walkingMinutes)} walking minutes, ${Math.round(venueChanges)} venue changes times 15. ` +
    'Formula: commitments times 10 plus walking minutes plus venue changes times 15.'
  );
}

export function energyDataMissing(ref: string): string {
  return `Data was missing for ${label(ref)}. It is left out of walking and venue totals.`;
}

export function energyWalkUnknown(from: string, to: string): string {
  return `The walk from ${label(from)} to ${label(to)} is unknown and is left out.`;
}

export function energyCountOnly(count: number, limit: number, overloaded: boolean): string {
  const c = Math.round(count);
  const l = Math.round(limit);
  return overloaded
    ? `${c} commitments is more than the limit of ${l}.`
    : `${c} commitments is within the limit of ${l}.`;
}

export function energyOverloadVerdict(overloaded: boolean, threshold: number): string {
  return overloaded
    ? `That is above the limit of ${Math.round(threshold)}, so the day is overloaded.`
    : `That is within the limit of ${Math.round(threshold)}.`;
}

// ---------------------------------------------------------------------------
// Rebooking
// ---------------------------------------------------------------------------

export function rebookRepeat(code: string, startsAt: string): string {
  return `Repeat ${label(code)} starts ${stamp(startsAt)}.`;
}

export function rebookStandby(code: string, startsAt: string): string {
  return `You favorited ${label(code)} as a backup. It starts ${stamp(startsAt)}.`;
}

export function rebookWalkUp(code: string, startsAt: string, isFull: boolean): string {
  return isFull
    ? `${label(code)} is full, so join the walk-up line. It starts ${stamp(startsAt)}.`
    : `${label(code)} needs no reservation, so walk up. It starts ${stamp(startsAt)}.`;
}

export function rebookNone(): string {
  return 'No alternative was found for this session.';
}

export function rebookFound(count: number): string {
  return count === 1
    ? 'Found 1 way to still attend.'
    : `Found ${Math.round(count)} ways to still attend.`;
}

export function rebookZoneProblem(reason: ZoneProblem): string {
  return `${zoneProblem(reason)} No options can be listed.`;
}

export function rebookNowUnusable(): string {
  return 'The current time is not usable. No options can be listed.';
}

// ---------------------------------------------------------------------------
// Safe swap
// ---------------------------------------------------------------------------

export function swapReserveStep(code: string): string {
  return `Reserve the repeat ${label(code)} first.`;
}

export function swapConfirmStep(): string {
  return 'Read the schedule back and check that the repeat is held.';
}

export function swapCancelStep(blocked: boolean): string {
  return blocked
    ? 'Do not cancel the original until the repeat is confirmed and safe.'
    : 'The repeat is confirmed. You can cancel the original now.';
}

export function swapSafe(): string {
  return 'The repeat is held and clashes with nothing. The swap is safe.';
}

export function swapUnsafe(refs: readonly string[]): string {
  const clashes = refs.map((ref) => `The repeat clashes with ${label(ref)}.`).join(' ');
  return `${clashes} The swap cannot be made safely. The original stays unchanged.`;
}

export function swapFailed(): string {
  return 'The schedule does not show the repeat as held. The swap cannot be completed. The original stays unchanged.';
}

export function swapZoneProblem(problem: ZoneProblem): string {
  return `${zoneProblem(problem)} The swap cannot be checked. The original stays unchanged.`;
}

export function swapUnknown(): string {
  return 'The repeat has no usable start or end time. The swap cannot be checked. The original stays unchanged.';
}

// ---------------------------------------------------------------------------
// Guardrail
// ---------------------------------------------------------------------------

export function guardMealLost(day: string): string {
  return `This removes your only meal break on ${stamp(day)}.`;
}

export function guardOverload(day: string, explanation: string): string {
  return `This makes ${stamp(day)} too busy. ${explanation}`;
}

export function guardMissingData(rule: RuleName, detail: string): string {
  return `The ${rule} could not be judged because data was missing. ${detail}`;
}
