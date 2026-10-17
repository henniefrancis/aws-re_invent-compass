import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { isOverloaded } from '../../src/rules/energy.js';
import type { ResolvedCommitment } from '../../src/rules/resolve.js';
import { testContext } from './helpers.js';

// Tests for the overload interface (itinerary-rules, S2).
// Requirements: 5.3, 5.9. All sample data is self-made.

function items(count: number): ResolvedCommitment[] {
  return Array.from({ length: count }, (_, i) => ({
    ref: `ITEM${i}`,
    venue: 'Alpha Hall',
    startsAt: '2026-12-01T10:00:00-08:00',
    endsAt: '2026-12-01T11:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    missing: [],
  }));
}

describe('isOverloaded (count-only fallback)', () => {
  test('the default count threshold is 6: seven commitments are overloaded, six are not', () => {
    const seven = isOverloaded(items(7), testContext());
    expect(seven).toEqual({
      overloaded: true,
      explanation: '7 commitments is more than the limit of 6.',
    });
    const six = isOverloaded(items(6), testContext());
    expect(six).toEqual({
      overloaded: false,
      explanation: '6 commitments is within the limit of 6.',
    });
  });

  test('an empty day is not overloaded', () => {
    expect(isOverloaded([], testContext()).overloaded).toBe(false);
  });

  // Feature: itinerary-rules, Property 11: Energy budget formula, overload threshold and count-only fallback, and explanation
  test('Property 11: the count-only fallback flags a day exactly when the count is over the threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        (count, threshold) => {
          const result = isOverloaded(
            items(count),
            testContext({ overloadCountThreshold: threshold }),
          );
          expect(result.overloaded).toBe(count > threshold);
        },
      ),
      { numRuns: 200 },
    );
  });
});
