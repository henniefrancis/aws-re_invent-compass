import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createQuotaTracker } from '../../src/api/quota-tracker.js';
import type { OperationName } from '../../src/api/transport.js';

// Property and unit tests for the client-side quota tracker (events-client, S1,
// Component 7). Covers Property 22: the tracker blocks exactly the call that would
// exceed a per-operation limit, resets on window elapse, leaves unmetered operations
// unblocked, and honours a 429 Retry-After block (Requirements 12.1 to 12.9).

// Metered operations paired with their per-minute limit (units are sessions for the
// two bulk operations, calls for the rest).
const METERED: ReadonlyArray<{ op: OperationName; limit: number }> = [
  { op: 'GetSession', limit: 120 },
  { op: 'ListSessions', limit: 120 },
  { op: 'GetSchedule', limit: 60 },
  { op: 'ReserveSessions', limit: 30 },
  { op: 'AssociateFavorites', limit: 30 },
  { op: 'CancelReservation', limit: 30 },
  { op: 'DisassociateFavorite', limit: 30 },
  { op: 'CreatePersonalTime', limit: 30 },
  { op: 'UpdatePersonalTime', limit: 30 },
  { op: 'DeletePersonalTime', limit: 30 },
];

const UNMETERED: readonly OperationName[] = ['ListEvents', 'GetEvent'];

const WINDOW_MS = 60_000;
const T0 = 1_000_000;

describe('Feature: events-client, Property 22: Quota tracker blocks exactly the call that would exceed a per-operation limit', () => {
  test('single-unit calls are allowed up to the limit and the next is blocked', () => {
    for (const { op, limit } of METERED) {
      const tracker = createQuotaTracker();
      // Exactly `limit` single-unit calls are allowed; each is checked then recorded.
      for (let i = 0; i < limit; i += 1) {
        expect(tracker.check(op, 1, T0)).toBe('allow');
        tracker.record(op, 1, T0);
      }
      // The call that would push the count to limit+1 is blocked.
      expect(tracker.check(op, 1, T0)).toBe('blocked-until-reset');
    }
  });

  test('a multi-unit call is allowed only while it does not cross the limit', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...METERED),
        fc.integer({ min: 1, max: 10 }),
        ({ op, limit }, units) => {
          const tracker = createQuotaTracker();
          // Fill to just below the limit so that `units` may or may not fit.
          const prefill = limit - 1;
          tracker.record(op, prefill, T0);
          const decision = tracker.check(op, units, T0);
          // Allowed exactly when prefill + units <= limit.
          const expected = prefill + units <= limit ? 'allow' : 'blocked-until-reset';
          expect(decision).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  test('the count resets when the one-minute window elapses', () => {
    for (const { op, limit } of METERED) {
      const tracker = createQuotaTracker();
      tracker.record(op, limit, T0); // window full
      expect(tracker.check(op, 1, T0)).toBe('blocked-until-reset');
      // Just before the window elapses it is still blocked.
      expect(tracker.check(op, 1, T0 + WINDOW_MS - 1)).toBe('blocked-until-reset');
      // At or after the full window it resets and allows again.
      expect(tracker.check(op, 1, T0 + WINDOW_MS)).toBe('allow');
    }
  });

  test('unmetered operations are never counted and never blocked', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...UNMETERED),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: WINDOW_MS * 3 }),
        (op, units, dt) => {
          const tracker = createQuotaTracker();
          tracker.record(op, units, T0);
          expect(tracker.check(op, units, T0 + dt)).toBe('allow');
          // A 429 note on an unmetered op is a no-op: still allowed.
          tracker.note429(op, 60, T0);
          expect(tracker.check(op, 1, T0)).toBe('allow');
        },
      ),
      { numRuns: 200 },
    );
  });

  test('a 429 blocks the next call of that operation until Retry-After has elapsed', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...METERED),
        fc.integer({ min: 1, max: 60 }),
        ({ op }, retryAfter) => {
          const tracker = createQuotaTracker();
          tracker.note429(op, retryAfter, T0);
          const blockMs = retryAfter * 1000;
          // Blocked right up until the Retry-After duration has elapsed.
          expect(tracker.check(op, 1, T0)).toBe('blocked-until-reset');
          expect(tracker.check(op, 1, T0 + blockMs - 1)).toBe('blocked-until-reset');
          // Allowed once the duration has elapsed (assuming the count window is fresh).
          expect(tracker.check(op, 1, T0 + blockMs)).toBe('allow');
        },
      ),
      { numRuns: 200 },
    );
  });
});
