import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { boardingFor, computeBoarding } from '../../src/rules/boarding.js';
import { parseInstant } from '../../src/rules/time.js';
import { session, testContext } from './helpers.js';

// Tests for boarding time (itinerary-rules, S2).
// Requirements: 1.1 to 1.8. All sample data is self-made.

const ZONES = ['America/Los_Angeles', 'Europe/London', 'Australia/Lord_Howe', 'UTC'];

// A start instant on a whole minute between late November and mid December 2026.
const startMs = fc
  .integer({ min: 0, max: 20 * 24 * 60 })
  .map((minutes) => Date.parse('2026-11-25T00:00:00Z') + minutes * 60_000);

describe('computeBoarding examples', () => {
  test('a reservable session closes ten minutes before start, in the event timezone', () => {
    const s = session({
      startsAt: '2026-12-01T10:30:00-08:00',
      endsAt: '2026-12-01T11:30:00-08:00',
    });
    const result = computeBoarding(s, testContext());
    expect(result).toEqual({
      status: 'closes',
      at: '2026-12-01T10:20:00-08:00',
      reason: 'Boarding closes at 2026-12-01 10:20. Your seat is released then.',
    });
  });

  test('is written in the event timezone even when the start uses another offset', () => {
    const s = session({ startsAt: '2026-12-01T18:30:00Z' });
    const result = computeBoarding(s, testContext());
    expect(result).toMatchObject({ status: 'closes', at: '2026-12-01T10:20:00-08:00' });
  });

  test('a session that needs no reservation has no boarding time', () => {
    const result = computeBoarding(session({ isReservable: false }), testContext());
    expect(result).toEqual({
      status: 'notApplicable',
      reason: 'This session needs no reservation, so it has no boarding time.',
    });
  });

  test('a missing start time is unknown', () => {
    const noStart = computeBoarding(session({ startsAt: undefined }), testContext());
    expect(noStart.status).toBe('unknown');
    expect(noStart.reason).toContain('start time is missing');
    const listed = computeBoarding(session({ missingFields: ['startsAt'] }), testContext());
    expect(listed.status).toBe('unknown');
  });

  test('a missing reservation flag is unknown', () => {
    const result = computeBoarding(session({ missingFields: ['isReservable'] }), testContext());
    expect(result.status).toBe('unknown');
    expect(result.reason).toContain('reservation flag is missing');
  });

  test('a missing or unrecognised timezone is unknown, with no default', () => {
    const missing = computeBoarding(session(), testContext({ eventTimezone: undefined }));
    expect(missing).toMatchObject({ status: 'unknown' });
    expect(missing.reason).toContain('timezone is missing');
    const bad = computeBoarding(session(), testContext({ eventTimezone: 'Nope/Nowhere' }));
    expect(bad).toMatchObject({ status: 'unknown' });
    expect(bad.reason).toContain('not recognised');
  });

  test('boardingFor works on resolved facts', () => {
    const result = boardingFor(
      { isReservable: true, startsAt: '2026-12-01T09:00:00-08:00' },
      testContext(),
    );
    expect(result).toMatchObject({ status: 'closes', at: '2026-12-01T08:50:00-08:00' });
  });

  test('stays exact across a daylight saving change', () => {
    // 2026-03-08 03:05 PDT is 10:05Z, five minutes after the clocks jump forward.
    const s = session({ startsAt: '2026-03-08T03:05:00-07:00' });
    const result = computeBoarding(s, testContext());
    // The clocks jumped forward at 10:00Z. Ten real minutes before 10:05Z is 09:55Z,
    // which is 01:55 on the old offset, not 02:55.
    expect(result).toMatchObject({ status: 'closes', at: '2026-03-08T01:55:00-08:00' });
  });
});

describe('computeBoarding properties', () => {
  // Feature: itinerary-rules, Property 1: Boarding closes at start minus ten minutes
  test('Property 1: boarding closes exactly ten minutes before a reservable start', () => {
    fc.assert(
      fc.property(startMs, fc.constantFrom(...ZONES), (start, zone) => {
        const s = session({ startsAt: new Date(start).toISOString() });
        const result = computeBoarding(s, testContext({ eventTimezone: zone }));
        expect(result.status).toBe('closes');
        if (result.status === 'closes') {
          expect(parseInstant(result.at)).toBe(start - 10 * 60_000);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: itinerary-rules, Property 2: Reservability comes from the flag, not the type name
  test('Property 2: reservability comes from the flag, never from the type name', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.boolean(), startMs, (typeA, typeB, flag, start) => {
        const base = { isReservable: flag, startsAt: new Date(start).toISOString() };
        const a = computeBoarding(session({ ...base, type: typeA }), testContext());
        const b = computeBoarding(session({ ...base, type: typeB }), testContext());
        expect(a.status).toBe(flag ? 'closes' : 'notApplicable');
        expect(b.status).toBe(a.status);
        if (!flag) {
          expect(a).not.toHaveProperty('at');
          expect(a.reason).toContain('needs no reservation');
        }
      }),
      { numRuns: 200 },
    );
  });

  test('Property 2: a keynote type that is flagged reservable still has boarding', () => {
    const result = computeBoarding(session({ type: 'Keynote', isReservable: true }), testContext());
    expect(result.status).toBe('closes');
  });
});
