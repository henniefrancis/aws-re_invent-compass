import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { SeatAvailabilitySchema } from '../src/wire/session.js';
import { BulkFailureCodeSchema } from '../src/wire/bulk-result.js';

// Property test for wire enum forward-compatibility (foundation-contracts, S0).
//
// Property 4: Wire enums are forward-compatible.
// Validates: Requirements 4.3.
//
// For all wire enum fields, parsing maps a known string to its literal value and
// preserves an unknown string rather than failing the whole response: an unknown
// seatAvailability becomes the sentinel "unknown", and an unrecognised BulkFailureCode
// is kept as-is as a generic refusal. A value of the wrong type is still rejected.
//
// Two schemas are exercised:
//   SeatAvailabilitySchema. Known string parses to itself; unknown string maps to the
//     sentinel "unknown"; non-string is rejected.
//   BulkFailureCodeSchema. Known string parses to itself; unknown string is preserved
//     unchanged (not a sentinel); non-string is rejected.

// The five known seat availability bands.
const KNOWN_SEAT_AVAILABILITY = [
  'available',
  'limited',
  'veryLimited',
  'unavailable',
  'walkUp',
] as const;

// The nine known bulk failure codes.
const KNOWN_BULK_FAILURE_CODES = [
  'sessionNotReservable',
  'scheduleConflict',
  'alreadyScheduled',
  'sessionFull',
  'insufficientAccess',
  'timePassed',
  'alreadyFavorited',
  'notFavorited',
  'other',
] as const;

const KNOWN_SEAT_SET = new Set<string>(KNOWN_SEAT_AVAILABILITY);
const KNOWN_BULK_SET = new Set<string>(KNOWN_BULK_FAILURE_CODES);

// An arbitrary for non-string values, used to check that a wrong type is rejected before
// any enum mapping runs. Covers integers, doubles, booleans, null, objects and arrays.
const nonStringArbitrary = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.integer(),
    fc.double(),
    fc.boolean(),
    fc.constant(null),
    fc.dictionary(fc.string(), fc.string()),
    fc.array(fc.string()),
  );

// At least 100 iterations per property block, as required for this spec's property tests.
const NUM_RUNS = 200;

describe('Feature: foundation-contracts, Property 4: Wire enums are forward-compatible', () => {
  test('Feature: foundation-contracts, Property 4: Wire enums are forward-compatible', () => {
    // 1. Known seatAvailability values map to their own literal.
    fc.assert(
      fc.property(fc.constantFrom(...KNOWN_SEAT_AVAILABILITY), (value) => {
        const result = SeatAvailabilitySchema.safeParse(value);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(value);
        }
      }),
      { numRuns: NUM_RUNS },
    );

    // 2. Known BulkFailureCode values map to their own literal.
    fc.assert(
      fc.property(fc.constantFrom(...KNOWN_BULK_FAILURE_CODES), (value) => {
        const result = BulkFailureCodeSchema.safeParse(value);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(value);
        }
      }),
      { numRuns: NUM_RUNS },
    );

    // 3. Unknown seatAvailability strings map to the sentinel "unknown". Any known value
    // is filtered out so the generated string is genuinely unrecognised.
    fc.assert(
      fc.property(
        fc.string().filter((s) => !KNOWN_SEAT_SET.has(s)),
        (value) => {
          const result = SeatAvailabilitySchema.safeParse(value);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data).toBe('unknown');
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 4. Unknown BulkFailureCode strings are preserved as-is, not collapsed to a sentinel.
    // Known codes are filtered out so the generated string is genuinely unrecognised.
    fc.assert(
      fc.property(
        fc.string().filter((s) => !KNOWN_BULK_SET.has(s)),
        (value) => {
          const result = BulkFailureCodeSchema.safeParse(value);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data).toBe(value);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // 5. A wrong type is rejected by both schemas: no coercion. safeParse must fail.
    fc.assert(
      fc.property(nonStringArbitrary(), (value) => {
        expect(SeatAvailabilitySchema.safeParse(value).success).toBe(false);
        expect(BulkFailureCodeSchema.safeParse(value).success).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
