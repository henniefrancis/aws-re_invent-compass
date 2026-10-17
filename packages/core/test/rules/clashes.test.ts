import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { findClashes, intervalOf, intervalsClash } from '../../src/rules/clashes.js';
import { formatLocal } from '../../src/rules/time.js';
import { personal, scheduleOf, session, testContext, ZONE } from './helpers.js';

// Tests for clash detection (itinerary-rules, S2).
// Requirements: 3.1 to 3.9. All sample data is self-made.

const BASE = Date.parse('2026-12-01T18:00:00Z'); // 10:00 Pacific on 1 December 2026
const iso = (ms: number): string => new Date(ms).toISOString();

function timed(title: string, startSec: number, lengthSec: number) {
  return personal(title, iso(BASE + startSec * 1000), iso(BASE + (startSec + lengthSec) * 1000));
}

function clashes(commitments: ReturnType<typeof personal>[], context = testContext()) {
  return findClashes({ commitments, sessions: {} }, context);
}

describe('clash examples', () => {
  test('a clash across midnight is found, with the range in the event timezone', () => {
    const late = personal('Late party', '2026-12-02T07:00:00Z', '2026-12-02T09:00:00Z'); // 23:00 to 01:00
    const night = personal('Night owl', '2026-12-02T08:00:00Z', '2026-12-02T10:00:00Z'); // 00:00 to 02:00
    const report = clashes([late, night]);
    expect(report).toMatchObject({ status: 'ok', unknown: [] });
    if (report.status === 'ok') {
      expect(report.clashes).toHaveLength(1);
      expect(report.clashes[0]).toMatchObject({
        a: 'Late party',
        b: 'Night owl',
        overlap: '2026-12-02 00:00 to 2026-12-02 01:00',
        reason: '"Late party" and "Night owl" overlap from 2026-12-02 00:00 to 2026-12-02 01:00.',
      });
    }
  });

  test('a commitment that itself crosses midnight clashes with one on the next day', () => {
    const crossing = personal('Crossing', '2026-12-02T06:00:00Z', '2026-12-02T09:00:00Z'); // 22:00 to 01:00
    const early = personal('Early', '2026-12-02T08:30:00Z', '2026-12-02T09:30:00Z'); // 00:30 to 01:30
    const report = clashes([crossing, early]);
    expect(report.status === 'ok' && report.clashes).toHaveLength(1);
  });

  test('touching at a single instant is not a clash', () => {
    const report = clashes([timed('First', 0, 3600), timed('Second', 3600, 3600)]);
    expect(report).toEqual({ status: 'ok', clashes: [], unknown: [] });
  });

  test('identical start and end instants clash', () => {
    expect(clashes([timed('A', 0, 3600), timed('B', 0, 3600)])).toMatchObject({
      clashes: [{ a: 'A', b: 'B' }],
    });
  });

  test('a commitment whose end is not after its start is bad data: unknown, never a clash', () => {
    for (const length of [0, -600]) {
      const report = clashes([timed('BAD', 0, length), timed('OK', -3600, 7200)]);
      expect(report).toMatchObject({ status: 'ok', clashes: [] });
      expect(report.status === 'ok' && report.unknown).toEqual([
        {
          ref: 'BAD',
          index: 0,
          reason:
            'The end time of "BAD" is not after its start time. It cannot be checked for clashes.',
        },
      ]);
    }
    // Two identical zero-length items are bad data too, so they are not reported as a clash.
    const twins = clashes([timed('A', 0, 0), timed('B', 0, 0)]);
    expect(twins.status === 'ok' && [twins.clashes.length, twins.unknown.length]).toEqual([0, 2]);
  });

  test('a zero-length point strictly inside another interval is a clash (raw intervals)', () => {
    const outer = { start: 0, end: 3_600_000 };
    expect(intervalsClash(outer, { start: 1_800_000, end: 1_800_000 })).toBe(true);
    expect(intervalsClash({ start: 1_800_000, end: 1_800_000 }, outer)).toBe(true);
    // On the edge, or outside, is not inside.
    expect(intervalsClash(outer, { start: 0, end: 0 })).toBe(false);
    expect(intervalsClash(outer, { start: 3_600_000, end: 3_600_000 })).toBe(false);
    expect(intervalsClash(outer, { start: 7_200_000, end: 7_200_000 })).toBe(false);
    // Two different points never clash; the same point twice is identical.
    expect(intervalsClash({ start: 5, end: 5 }, { start: 6, end: 6 })).toBe(false);
    expect(intervalsClash({ start: 5, end: 5 }, { start: 5, end: 5 })).toBe(true);
  });

  test('an overlap of one second clashes, and less than a second does not', () => {
    expect(clashes([timed('A', 0, 3600), timed('B', 3599, 3600)])).toMatchObject({
      clashes: [{ overlap: '2026-12-01 10:59:59 to 2026-12-01 11:00' }],
    });
    const half = personal('A', '2026-12-01T10:00:00.000-08:00', '2026-12-01T11:00:00.500-08:00');
    const next = personal('B', '2026-12-01T11:00:00.000-08:00', '2026-12-01T12:00:00.000-08:00');
    expect(clashes([half, next])).toMatchObject({ status: 'ok', clashes: [] });
  });

  test('an all-day item occupies 00:00:00 to 23:59:59 of its event day', () => {
    const expo = session({
      sessionId: 'expo',
      code: 'EXPO',
      isAllDay: true,
      startsAt: '2026-12-01T09:00:00-08:00',
      endsAt: undefined,
    });
    const morning = session({
      sessionId: 'm',
      code: 'MORN',
      startsAt: '2026-12-01T00:00:00-08:00',
      endsAt: '2026-12-01T00:30:00-08:00',
    });
    const midnightBefore = session({
      sessionId: 'p',
      code: 'PREV',
      startsAt: '2026-11-30T23:00:00-08:00',
      endsAt: '2026-12-01T00:00:00-08:00',
    });
    const lastSecond = session({
      sessionId: 'l',
      code: 'LAST',
      startsAt: '2026-12-01T23:59:59-08:00',
      endsAt: '2026-12-02T01:00:00-08:00',
    });
    const lastTwoSeconds = session({
      sessionId: 'k',
      code: 'KEEN',
      startsAt: '2026-12-01T23:59:58-08:00',
      endsAt: '2026-12-02T01:00:00-08:00',
    });
    const report = findClashes(
      scheduleOf([expo, morning, midnightBefore, lastSecond, lastTwoSeconds]),
      testContext(),
    );
    expect(report.status).toBe('ok');
    if (report.status === 'ok') {
      const pairs = report.clashes.map((c) => `${c.a}+${c.b}`);
      expect(pairs).toContain('EXPO+MORN');
      expect(pairs).toContain('EXPO+KEEN');
      expect(pairs).not.toContain('EXPO+PREV');
      expect(pairs).not.toContain('EXPO+LAST');
      expect(report.clashes.find((c) => c.b === 'KEEN')?.overlap).toBe(
        '2026-12-01 23:59:58 to 2026-12-01 23:59:59',
      );
    }
  });

  test('a clash stays right across a daylight saving change', () => {
    // 01:30 PST to 03:30 PDT is two real hours minus the gap, a real 60 minutes.
    const a = personal('Across', '2026-03-08T01:30:00-08:00', '2026-03-08T03:30:00-07:00');
    const b = personal('Inside', '2026-03-08T01:45:00-08:00', '2026-03-08T01:50:00-08:00');
    const c = personal('After', '2026-03-08T03:30:00-07:00', '2026-03-08T04:00:00-07:00');
    const report = clashes([a, b, c]);
    expect(report.status === 'ok' && report.clashes.map((x) => `${x.a}+${x.b}`)).toEqual([
      'Across+Inside',
    ]);
  });

  test('a missing end time is unknown, names the commitment, and joins no pair', () => {
    const noEnd = session({ sessionId: 'n', code: 'NOEND', endsAt: undefined });
    const other = session({ sessionId: 'o', code: 'OTHER' });
    const report = findClashes(scheduleOf([noEnd, other]), testContext());
    expect(report).toEqual({
      status: 'ok',
      clashes: [],
      unknown: [
        {
          ref: 'NOEND',
          index: 0,
          reason: 'The end time of "NOEND" is missing. It cannot be checked for clashes.',
        },
      ],
    });
    const listed = session({ sessionId: 'n', code: 'NOEND', missingFields: ['endsAt'] });
    expect(findClashes(scheduleOf([listed, other]), testContext())).toMatchObject({
      unknown: [{ ref: 'NOEND' }],
    });
  });

  test('a missing start time is unknown too', () => {
    const noStart = session({ sessionId: 'n', code: 'NOSTART', startsAt: undefined });
    const report = findClashes(scheduleOf([noStart]), testContext());
    expect(report).toMatchObject({ unknown: [{ ref: 'NOSTART' }] });
    expect(report.status === 'ok' && report.unknown[0]?.reason).toContain('start time');
  });

  test('a second commitment with a missing end is also left out of every pair', () => {
    const noEnd = session({ sessionId: 'n', code: 'NOEND', endsAt: undefined });
    const a = session({ sessionId: 'a', code: 'AAA' });
    const b = session({ sessionId: 'b', code: 'BBB' });
    const report = findClashes(scheduleOf([a, noEnd, b]), testContext());
    expect(report.status === 'ok' && report.clashes).toHaveLength(1);
    expect(report.status === 'ok' && report.unknown).toHaveLength(1);
  });

  test('a missing or unrecognised timezone makes the check unknown', () => {
    const items = [timed('A', 0, 3600), timed('B', 0, 3600)];
    const missing = clashes(items, testContext({ eventTimezone: undefined }));
    expect(missing).toMatchObject({ status: 'unknown' });
    expect(missing.status === 'unknown' && missing.reason).toContain('timezone is missing');
    const bad = clashes(items, testContext({ eventTimezone: 'Nope/Nowhere' }));
    expect(bad.status === 'unknown' && bad.reason).toContain('not recognised');
  });

  test('intervalOf reports the missing time and intervalsClash is symmetric', () => {
    const resolved = {
      ref: 'X',
      isAllDay: false,
      missing: [],
      startsAt: '2026-12-01T10:00:00-08:00',
    };
    expect(intervalOf(resolved, ZONE)).toEqual({ missing: 'end' });
    expect(intervalOf({ ...resolved, endsAt: '2026-12-01T10:00:00-08:00' }, ZONE)).toEqual({
      missing: 'order',
    });
    expect(intervalOf({ ...resolved, startsAt: undefined }, ZONE)).toEqual({ missing: 'start' });
    const x = { start: 0, end: 5000 };
    const y = { start: 4000, end: 9000 };
    expect(intervalsClash(x, y)).toBe(intervalsClash(y, x));
  });
});

describe('clash sweep', () => {
  // Feature: itinerary-rules, Property 7: Clash overlap semantics with all-day expansion and a naming reason
  test('Property 7: the sweep finds exactly the pairs a full pair scan would, in input order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 7200 }), fc.integer({ min: 1, max: 3600 })), {
          maxLength: 12,
        }),
        (spans) => {
          const items = spans.map(([s, l], i) => timed(`I${i}`, s, l));
          const report = clashes(items);
          const expected: string[] = [];
          for (let i = 0; i < spans.length; i += 1) {
            for (let j = i + 1; j < spans.length; j += 1) {
              const [sa, la] = spans[i];
              const [sb, lb] = spans[j];
              const overlap = Math.min(sa + la, sb + lb) - Math.max(sa, sb);
              if ((sa === sb && la === lb) || overlap >= 1) expected.push(`I${i}+I${j}`);
            }
          }
          expect(report.status === 'ok' && report.clashes.map((c) => `${c.a}+${c.b}`)).toEqual(
            expected,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('clash properties', () => {
  // Feature: itinerary-rules, Property 7: Clash overlap semantics with all-day expansion and a naming reason
  test('Property 7: a clash is reported exactly when the intervals overlap by a second or more', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3600 }),
        fc.integer({ min: 0, max: 3600 }),
        fc.integer({ min: 0, max: 3600 }),
        fc.integer({ min: 0, max: 3600 }),
        (sa, la, sb, lb) => {
          const report = clashes([timed('Alpha item', sa, la), timed('Beta item', sb, lb)]);
          const overlap = Math.min(sa + la, sb + lb) - Math.max(sa, sb);
          const expected = (sa === sb && la === lb) || overlap >= 1;
          expect(report.status).toBe('ok');
          if (report.status !== 'ok') return;
          expect(report.clashes).toHaveLength(expected ? 1 : 0);
          if (expected) {
            const from = formatLocal(BASE + Math.max(sa, sb) * 1000, ZONE);
            const to = formatLocal(BASE + Math.min(sa + la, sb + lb) * 1000, ZONE);
            const pair = report.clashes[0];
            expect(pair.reason).toContain('Alpha item');
            expect(pair.reason).toContain('Beta item');
            expect(pair.reason).toContain(from);
            expect(pair.reason).toContain(to);
            expect(pair.overlap).toBe(`${from} to ${to}`);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test('Property 7: an all-day item clashes with exactly the timed items that touch its day by a second', () => {
    const dayStart = Date.parse('2026-12-01T08:00:00Z'); // 00:00 Pacific
    const dayEnd = dayStart + (24 * 3600 - 1) * 1000; // 23:59:59 Pacific
    fc.assert(
      fc.property(
        fc.integer({ min: -7200, max: 24 * 3600 + 7200 }),
        fc.integer({ min: 1, max: 7200 }),
        (startSec, lengthSec) => {
          const start = dayStart + startSec * 1000;
          const end = start + lengthSec * 1000;
          const expo = session({
            sessionId: 'expo',
            code: 'EXPO',
            isAllDay: true,
            startsAt: '2026-12-01T12:00:00-08:00',
            endsAt: undefined,
          });
          const timedSession = session({
            sessionId: 't',
            code: 'TIMED',
            startsAt: iso(start),
            endsAt: iso(end),
          });
          const report = findClashes(scheduleOf([expo, timedSession]), testContext());
          const overlap = Math.min(dayEnd, end) - Math.max(dayStart, start);
          expect(report.status === 'ok' && report.clashes.length).toBe(overlap >= 1000 ? 1 : 0);
        },
      ),
      { numRuns: 300 },
    );
  });
});
