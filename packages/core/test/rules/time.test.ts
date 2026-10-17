import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import {
  checkZone,
  clockToMinutes,
  dayBounds,
  dayKey,
  formatLocal,
  formatOffset,
  instantAt,
  minutesBetween,
  nextDayKey,
  offsetMinutes,
  parseInstant,
  toZonedIso,
  wallClock,
} from '../../src/rules/time.js';

// Tests for the internal time toolkit (itinerary-rules, S2). All sample data is
// self-made. Property tests run at least 100 iterations.

const LA = 'America/Los_Angeles';
const LONDON = 'Europe/London';
const LORD_HOWE = 'Australia/Lord_Howe';
const ZONES = [LA, LONDON, LORD_HOWE, 'UTC', 'Asia/Kolkata'];

// Instants near a daylight saving change in Los Angeles (2026-03-08 and 2026-11-01).
const SPRING = Date.parse('2026-03-08T10:00:00Z');
const FALL = Date.parse('2026-11-01T09:00:00Z');

describe('parseInstant and minutesBetween', () => {
  test('parses ISO strings with Z or an offset, with or without seconds', () => {
    expect(parseInstant('2026-12-01T10:00:00Z')).toBe(Date.parse('2026-12-01T10:00:00Z'));
    expect(parseInstant('2026-12-01T10:00-08:00')).toBe(Date.parse('2026-12-01T18:00:00Z'));
    expect(parseInstant('2026-12-01T10:00:00.250+01:00')).toBe(
      Date.parse('2026-12-01T09:00:00.250Z'),
    );
  });

  test('rejects strings without an offset, impossible dates and other text', () => {
    expect(parseInstant('2026-12-01T10:00:00')).toBeUndefined();
    expect(parseInstant('2026-12-01')).toBeUndefined();
    expect(parseInstant('2026-13-01T10:00:00Z')).toBeUndefined();
    expect(parseInstant('tomorrow')).toBeUndefined();
    expect(parseInstant('')).toBeUndefined();
  });

  test('computes elapsed minutes on instants', () => {
    expect(minutesBetween(0, 90_000)).toBe(1.5);
    expect(minutesBetween(120_000, 0)).toBe(-2);
  });
});

describe('checkZone', () => {
  test('accepts recognised IANA names', () => {
    expect(checkZone(LA)).toEqual({ ok: true, zone: LA });
    expect(checkZone('UTC')).toEqual({ ok: true, zone: 'UTC' });
  });

  test('reports missing and empty as missing', () => {
    expect(checkZone(undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(checkZone('')).toEqual({ ok: false, reason: 'missing' });
  });

  test('rejects offsets even when Intl would accept them', () => {
    expect(checkZone('+01:00')).toEqual({ ok: false, reason: 'unrecognised' });
    expect(checkZone('-08:00')).toEqual({ ok: false, reason: 'unrecognised' });
  });

  test('rejects names Intl refuses', () => {
    expect(checkZone('Not/A_Zone')).toEqual({ ok: false, reason: 'unrecognised' });
  });

  // Feature: itinerary-rules, Property 4: Missing or unrecognised timezone yields unknown for every time-dependent result
  test('Property 4: a missing or unrecognised timezone is never replaced by a default', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(''),
          fc.stringMatching(/^[A-Za-z0-9]{1,10}$/).map((s) => `Not/A_Zone_${s}`),
          fc.stringMatching(/^[0-9:]{1,8}$/).map((s) => `+${s}`),
          fc.stringMatching(/^[0-9:]{1,8}$/).map((s) => `-${s}`),
        ),
        (zone) => {
          const result = checkZone(zone);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe(zone ? 'unrecognised' : 'missing');
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test('Property 4: every recognised name is accepted unchanged', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ZONES), (zone) => {
        expect(checkZone(zone)).toEqual({ ok: true, zone });
      }),
      { numRuns: 100 },
    );
  });
});

describe('wall-clock reading', () => {
  test('reads local fields, offsets and day keys', () => {
    const ms = Date.parse('2026-12-02T03:30:45Z');
    expect(wallClock(ms, LA)).toEqual({
      year: 2026,
      month: 12,
      day: 1,
      hour: 19,
      minute: 30,
      second: 45,
    });
    expect(dayKey(ms, LA)).toBe('2026-12-01');
    expect(dayKey(ms, 'UTC')).toBe('2026-12-02');
    expect(offsetMinutes(ms, LA)).toBe(-480);
    expect(offsetMinutes(ms, 'Asia/Kolkata')).toBe(330);
    expect(offsetMinutes(ms, 'UTC')).toBe(0);
  });

  test('reads midnight as hour 0, not 24', () => {
    expect(wallClock(Date.parse('2026-12-01T08:00:00Z'), LA).hour).toBe(0);
  });

  test('formats offsets', () => {
    expect(formatOffset(-480)).toBe('-08:00');
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(0)).toBe('+00:00');
  });

  test('formats zoned ISO strings and short labels', () => {
    const ms = Date.parse('2026-12-02T03:30:45Z');
    expect(toZonedIso(ms, LA)).toBe('2026-12-01T19:30:45-08:00');
    expect(formatLocal(ms, LA)).toBe('2026-12-01 19:30:45');
    expect(formatLocal(Date.parse('2026-12-02T03:30:00Z'), LA)).toBe('2026-12-01 19:30');
  });

  test('parses clock strings', () => {
    expect(clockToMinutes('11:30')).toBe(690);
    expect(clockToMinutes('00:00')).toBe(0);
  });
});

describe('instantAt and day arithmetic', () => {
  test('converts a plain local time to an instant', () => {
    expect(toZonedIso(instantAt('2026-12-01', 690, 0, LA), LA)).toBe('2026-12-01T11:30:00-08:00');
    expect(toZonedIso(instantAt('2026-12-01', 23 * 60 + 59, 59, LA), LA)).toBe(
      '2026-12-01T23:59:59-08:00',
    );
  });

  test('a fall-back overlap takes the earlier offset', () => {
    expect(toZonedIso(instantAt('2026-11-01', 90, 0, LA), LA)).toBe('2026-11-01T01:30:00-07:00');
    expect(toZonedIso(instantAt('2026-10-25', 90, 0, LONDON), LONDON)).toBe(
      '2026-10-25T01:30:00+01:00',
    );
  });

  test('a spring-forward gap moves the time forward', () => {
    expect(toZonedIso(instantAt('2026-03-08', 150, 0, LA), LA)).toBe('2026-03-08T03:30:00-07:00');
  });

  test('knows the next day, including month and year ends', () => {
    expect(nextDayKey('2026-12-01')).toBe('2026-12-02');
    expect(nextDayKey('2026-12-31')).toBe('2027-01-01');
    expect(nextDayKey('2028-02-28')).toBe('2028-02-29');
  });

  test('day length follows daylight saving', () => {
    const hours = (day: string): number => {
      const { start, end } = dayBounds(day, LA);
      return minutesBetween(start, end) / 60;
    };
    expect(hours('2026-03-08')).toBe(23);
    expect(hours('2026-11-01')).toBe(25);
    expect(hours('2026-12-01')).toBe(24);
  });
});

describe('offset change stability', () => {
  // Feature: itinerary-rules, Property 17: The same instants give identical results across an offset change
  test('Property 17: elapsed minutes do not change when the local offset changes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(SPRING, FALL),
        fc.integer({ min: -720, max: 720 }),
        fc.integer({ min: 0, max: 1440 }),
        fc.constantFrom(...ZONES),
        (anchor, startOffsetMinutes, lengthMinutes, zone) => {
          const start = anchor + startOffsetMinutes * 60_000;
          const end = start + lengthMinutes * 60_000;
          const startIso = toZonedIso(start, zone);
          const endIso = toZonedIso(end, zone);
          // The strings round-trip to the very same absolute instants.
          expect(parseInstant(startIso)).toBe(start);
          expect(parseInstant(endIso)).toBe(end);
          // So elapsed time is exactly the real elapsed time, whatever the wall clock did.
          const elapsed = minutesBetween(
            parseInstant(startIso) as number,
            parseInstant(endIso) as number,
          );
          expect(elapsed).toBe(lengthMinutes);
        },
      ),
      { numRuns: 200 },
    );
  });

  test('Property 17: the wall clock jumps across a change but instants do not', () => {
    const before = Date.parse('2026-03-08T09:59:00Z');
    const after = before + 2 * 60_000;
    expect(minutesBetween(before, after)).toBe(2);
    expect(wallClock(before, LA).hour).toBe(1);
    expect(wallClock(after, LA).hour).toBe(3);
    expect(offsetMinutes(before, LA)).toBe(-480);
    expect(offsetMinutes(after, LA)).toBe(-420);
  });

  test('Property 17: day bucketing follows the event timezone, not the instant text', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 86_400 }),
        fc.constantFrom(...ZONES),
        (second, zone) => {
          const ms = Date.parse('2026-12-01T00:00:00Z') + second * 1000;
          const { start, end } = dayBounds(dayKey(ms, zone), zone);
          expect(ms >= start && ms < end).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
