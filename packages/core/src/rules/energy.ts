// Energy budget and the single overload interface (itinerary-rules, S2).
//
// The guardrail asks one question about a day: is it overloaded? It asks it only through
// isOverloaded, so whichever implementation stands behind that interface can change without
// the guardrail changing. At this point the count-only fallback stands behind it: a day with
// more commitments than Context.overloadCountThreshold is overloaded (Req 5.9).
import type { Context } from './context.js';
import * as reason from './reasons.js';
import type { ResolvedCommitment } from './resolve.js';

/** The answer to "is this day overloaded?", with a plain-English explanation. */
export interface OverloadResult {
  overloaded: boolean;
  explanation: string;
}

/**
 * Is the day overloaded? The day is the commitments that fall on one event day. A day with
 * more commitments than Context.overloadCountThreshold is overloaded; equal or fewer is not.
 */
export function isOverloaded(
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
