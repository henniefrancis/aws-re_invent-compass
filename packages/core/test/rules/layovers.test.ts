import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { REST_BREAK_MINUTES, checkLayovers, type DayLayover } from '../../src/rules/layovers.js';
import { parseInstant } from '../../src/rules/time.js';
import { personal, scheduleOf, session, testContext } from './helpers.js';

// Tests for layovers and personal time (itinerary-rules, S2).
// Requirements: 4.1 to 4.8. All sample data is self-made.

const MIDNIGHT = Date.parse('2026-12-01T08:00:00Z'); // 00:00 Pacific on 1 December 2026
const iso = (ms: number): string => new Date(ms).toISOString();
/** An instant given as minutes after local midnight on 1 December 2026 (Pacific). */
const at = (minutes: number): string => iso(MIDNIGHT + minutes * 60_000);

/** A commitment from one local minute to another. */
function busy(title: string, startMin: number, endMin: number) {
  return personal(title, at(startMin), at(endMin));
}
const clock = (h: number, m = 0): number => h * 60 + m;

function check(commitments: ReturnType<typeof personal>[], context = testContext(), day?: string) {
  const report = checkLayovers({ commitments, sessions: {} }, context, day);
  if (report.status !== 'ok') throw new Error('expected an ok report');
  return report;
}

function onlyDay(commitments: ReturnType<typeof personal>[], context = testContext()): DayLayover {
  const report = check(commitments, context);
  expect(report.days).toHaveLength(1);
  return report.days[0];
}

describe('layover defaults and examples', () => {
  test('the default meal window is 11:30 to 14:00 and needs 30 free minutes', () => {
    // Busy until 13:45 leaves 15 free minutes: missing.
    const short = onlyDay([busy('A', clock(11, 30), clock(13, 45))]);
    expect(short.mealLayoverMissing).toBe(true);
    expect(short.freeMealMinutes).toBe(15);
    expect(short.reasons[0]).toBe(
      'On 2026-12-01 you have 15 minutes free in the meal window. You need 30 minutes.',
    );
    // Busy until 13:30 leaves exactly 30: fine.
    const enough = onlyDay([busy('A', clock(11, 30), clock(13, 30))]);
    expect(enough.mealLayoverMissing).toBe(false);
    expect(enough.freeMealMinutes).toBe(30);
    // Free all day inside the window.
    expect(onlyDay([busy('A', clock(9), clock(10))]).freeMealMinutes).toBe(150);
  });

  test('the default maximum unbroken stretch is 180 minutes', () => {
    expect(onlyDay([busy('A', clock(8), clock(11))]).longStretchMinutes).toBeUndefined();
    const long = onlyDay([busy('A', clock(8), clock(11, 1))]);
    expect(long.longStretchMinutes).toBe(181);
    expect(long.reasons.at(-1)).toBe(
      'On 2026-12-01 you have 181 minutes without a break. The limit is 180 minutes.',
    );
  });

  test('touching commitments make one stretch, a gap breaks it', () => {
    const touching = onlyDay([busy('A', clock(8), clock(10)), busy('B', clock(10), clock(11, 30))]);
    expect(touching.longStretchMinutes).toBe(210);
    const gap = onlyDay([busy('A', clock(8), clock(10)), busy('B', clock(10, 1), clock(11, 30))]);
    expect(gap.longStretchMinutes).toBeUndefined();
  });

  test('picks the longest stretch when there are several', () => {
    const day = onlyDay([
      busy('Long', clock(8), clock(12)),
      busy('Short', clock(14), clock(15)),
      busy('Longer', clock(16), clock(21)),
    ]);
    expect(day.longStretchMinutes).toBe(300);
    const reordered = onlyDay([
      busy('Short', clock(14), clock(15)),
      busy('Longer', clock(16), clock(21)),
      busy('Long', clock(8), clock(12)),
    ]);
    expect(reordered.longStretchMinutes).toBe(300);
  });

  test('settings from the context override the defaults', () => {
    const context = testContext({
      mealWindow: { start: '12:00', end: '13:00', requiredFreeMinutes: 45 },
      maxStretchMinutes: 60,
    });
    const day = onlyDay(
      [busy('A', clock(12), clock(12, 30)), busy('B', clock(9), clock(10, 30))],
      context,
    );
    expect(day.freeMealMinutes).toBe(30);
    expect(day.mealLayoverMissing).toBe(true);
    expect(day.longStretchMinutes).toBe(90);
  });

  test('a meal block goes in the clash-free gap nearest the window', () => {
    const enough = onlyDay([
      busy('A', clock(11, 30), clock(12, 30)),
      busy('B', clock(13, 15), clock(14, 15)),
    ]);
    expect(enough.mealLayoverMissing).toBe(false);
    expect(enough.suggestions).toEqual([]);
    const open = onlyDay([
      busy('A', clock(11, 30), clock(12, 10)),
      busy('B', clock(12, 20), clock(13, 45)),
    ]);
    expect(open.freeMealMinutes).toBe(25);
    // The gaps are 00:00 to 11:30 and 13:45 to 24:00. The first is nearer to the window start.
    expect(open.suggestions).toEqual([
      {
        start: '2026-12-01T11:00:00-08:00',
        end: '2026-12-01T11:30:00-08:00',
        reason: 'Take a meal break in this gap.',
      },
    ]);
    expect(open.noPlacementReason).toBeUndefined();
    // When the window is nearest the later gap, the block is placed at the start of that gap.
    const later = onlyDay([busy('A', clock(0), clock(11, 40)), busy('B', clock(12, 5), clock(14))]);
    expect(later.suggestions[0]).toMatchObject({ start: '2026-12-01T14:00:00-08:00' });
  });

  test('a day with no gap long enough anywhere reports no placement', () => {
    const day = onlyDay([
      busy('A', clock(0), clock(24) - 20),
      busy('B', clock(24) - 10, clock(24)),
    ]);
    expect(day.suggestions).toEqual([]);
    expect(day.noPlacementReason).toContain('meal');
  });

  test('a day that is busy all through the window gets a block just outside it', () => {
    const day = onlyDay([busy('A', clock(11), clock(15))]);
    expect(day.freeMealMinutes).toBe(0);
    expect(day.suggestions[0]).toMatchObject({
      start: '2026-12-01T10:30:00-08:00',
      end: '2026-12-01T11:00:00-08:00',
    });
  });

  test('an upside-down meal window leaves no free minutes', () => {
    const context = testContext({
      mealWindow: { start: '14:00', end: '11:30', requiredFreeMinutes: 30 },
    });
    const day = onlyDay([busy('A', clock(9), clock(10))], context);
    expect(day.freeMealMinutes).toBe(0);
    expect(day.mealLayoverMissing).toBe(true);
  });

  test('commitments before the window or crossing past its end are clipped', () => {
    const day = onlyDay([
      busy('Early', clock(9), clock(11, 45)),
      busy('Late', clock(13, 45), clock(16)),
    ]);
    expect(day.freeMealMinutes).toBe(120);
    // A cross-midnight commitment from the day before still blocks this day's window.
    const report = check([
      personal('Overnight', at(-60), at(clock(12))),
      busy('Today', clock(15), clock(16)),
    ]);
    const today = report.days.find((d) => d.day === '2026-12-01')!;
    expect(today.freeMealMinutes).toBe(120);
  });

  describe('rest block placement', () => {
    const fifteen = REST_BREAK_MINUTES;

    test('goes after the long stretch when that gap is clear', () => {
      const day = onlyDay([busy('A', clock(8), clock(12, 30))]);
      expect(day.suggestions).toEqual([
        {
          start: '2026-12-01T12:30:00-08:00',
          end: '2026-12-01T12:45:00-08:00',
          reason: 'Take a short rest after the long stretch.',
        },
      ]);
      expect(fifteen).toBe(15);
    });

    test('goes before the stretch when the day ends too soon after it', () => {
      const day = onlyDay([busy('A', clock(20, 30), clock(23, 55))]);
      expect(day.suggestions).toEqual([
        {
          start: '2026-12-01T20:15:00-08:00',
          end: '2026-12-01T20:30:00-08:00',
          reason: 'Take a short rest before the long stretch.',
        },
      ]);
    });

    test('goes before the stretch when something blocks the gap after it', () => {
      const day = onlyDay([
        busy('A', clock(9), clock(12, 15)),
        busy('B', clock(12, 20), clock(12, 25)),
      ]);
      expect(day.suggestions).toEqual([
        {
          start: '2026-12-01T08:45:00-08:00',
          end: '2026-12-01T09:00:00-08:00',
          reason: 'Take a short rest before the long stretch.',
        },
      ]);
    });

    test('reports no placement when no clash-free gap exists after or before', () => {
      const atStart = onlyDay([
        busy('A', clock(0), clock(3, 30)),
        busy('B', clock(3, 35), clock(3, 40)),
      ]);
      expect(atStart.suggestions).toEqual([]);
      expect(atStart.noPlacementReason).toBe('No clash-free gap was found for a rest block.');
      const boxed = onlyDay([
        busy('A', clock(0, 20), clock(3, 50)),
        busy('B', clock(3, 55), clock(4)),
        busy('C', clock(0), clock(0, 10)),
      ]);
      expect(boxed.suggestions).toEqual([]);
      expect(boxed.noPlacementReason).toContain('rest');
    });

    test('a meal block and a rest block never overlap each other', () => {
      const context = testContext({ maxStretchMinutes: 60 });
      const day = onlyDay(
        [busy('A', clock(10), clock(11, 40)), busy('B', clock(12, 5), clock(14))],
        context,
      );
      expect(day.suggestions).toHaveLength(2);
      const [first, second] = day.suggestions.map((s) => [
        parseInstant(s.start)!,
        parseInstant(s.end)!,
      ]);
      expect(first[1] <= second[0] || second[1] <= first[0]).toBe(true);
    });

    test('reports both failures together when neither block can be placed', () => {
      const day = onlyDay([busy('A', clock(0), clock(24) - 1)]);
      expect(day.noPlacementReason).toBe(
        'No clash-free gap was found for a meal block. No clash-free gap was found for a rest block.',
      );
    });
  });
});

describe('layover scope and unknowns', () => {
  test('reports each day that has a commitment, in order, or only the day asked for', () => {
    const nextDay = (m: number) => at(24 * 60 + m);
    const items = [
      personal('Tue', nextDay(clock(9)), nextDay(clock(10))),
      busy('Mon', clock(9), clock(10)),
    ];
    const all = check(items);
    expect(all.days.map((d) => d.day)).toEqual(['2026-12-01', '2026-12-02']);
    expect(check(items, testContext(), '2026-12-02').days.map((d) => d.day)).toEqual([
      '2026-12-02',
    ]);
    expect(check(items, testContext(), '2026-12-09').days).toEqual([]);
  });

  test('leaves out all-day items and lists commitments with no usable times as skipped', () => {
    const expo = session({
      sessionId: 'expo',
      code: 'EXPO',
      isAllDay: true,
      startsAt: '2026-12-01T09:00:00-08:00',
      endsAt: undefined,
    });
    const noEnd = session({ sessionId: 'x', code: 'NOEND', endsAt: undefined });
    const noStart = session({ sessionId: 'y', code: 'NOSTART', startsAt: undefined });
    const fine = session({ sessionId: 'z', code: 'FINE' });
    const report = checkLayovers(scheduleOf([expo, noEnd, noStart, fine]), testContext());
    expect(report).toMatchObject({ status: 'ok' });
    if (report.status === 'ok') {
      expect(report.days).toHaveLength(1);
      expect(report.skipped.map((s) => s.ref)).toEqual(['NOEND', 'NOSTART']);
      expect(report.skipped[0].reason).toBe(
        'The end time of "NOEND" is missing. It is left out of the break checks.',
      );
      expect(report.skipped[1].reason).toContain('start time of "NOSTART"');
    }
  });

  test('a commitment whose end is not after its start is skipped, not counted as free time', () => {
    const bad = session({ sessionId: 'b', code: 'BAD', endsAt: session().startsAt });
    const report = checkLayovers(
      scheduleOf([bad, session({ sessionId: 'z', code: 'FINE' })]),
      testContext(),
    );
    expect(report).toMatchObject({ status: 'ok' });
    if (report.status === 'ok') {
      expect(report.skipped).toEqual([
        {
          ref: 'BAD',
          reason:
            'The end time of "BAD" is not after its start time. It is left out of the break checks.',
        },
      ]);
    }
  });

  test('a day with only skipped commitments is not reported', () => {
    const noEnd = session({ endsAt: undefined });
    const report = checkLayovers(scheduleOf([noEnd]), testContext());
    expect(report).toMatchObject({ status: 'ok', days: [] });
  });

  test('a missing or unrecognised timezone is unknown', () => {
    const items = { commitments: [busy('A', 0, 60)], sessions: {} };
    const missing = checkLayovers(items, testContext({ eventTimezone: undefined }));
    expect(missing).toMatchObject({ status: 'unknown' });
    expect(missing.status === 'unknown' && missing.reason).toContain('timezone is missing');
    expect(checkLayovers(items, testContext({ eventTimezone: 'Nope/Nowhere' })).status).toBe(
      'unknown',
    );
  });

  test('uses local time across a daylight saving change', () => {
    // On 2026-03-08 the clocks jump at 02:00. The meal window is still 11:30 to 14:00 local.
    const day = '2026-03-08';
    const item = personal('A', `${day}T11:30:00-07:00`, `${day}T13:00:00-07:00`);
    const report = check([item]);
    expect(report.days[0]).toMatchObject({ day, freeMealMinutes: 60, mealLayoverMissing: false });
  });
});

describe('layover properties', () => {
  /** A minute bitmap of a local day (Pacific, no daylight saving change on 1 December). */
  function bitmap(items: Array<[number, number]>): boolean[] {
    const covered = new Array<boolean>(24 * 60).fill(false);
    for (const [start, end] of items) {
      for (let m = start; m < end && m < covered.length; m += 1) covered[m] = true;
    }
    return covered;
  }

  const itemsArb = (maxStart: number, maxLength: number) =>
    fc.array(
      fc.tuple(fc.integer({ min: 0, max: maxStart }), fc.integer({ min: 1, max: maxLength })),
      { minLength: 1, maxLength: 8 },
    );

  // Feature: itinerary-rules, Property 8: Meal layover reported exactly when free minutes fall short
  test('Property 8: the meal layover is missing exactly when free minutes are below the need', () => {
    fc.assert(
      fc.property(
        itemsArb(600, 180),
        fc.integer({ min: 9 * 60, max: 12 * 60 }),
        fc.integer({ min: 30, max: 300 }),
        fc.integer({ min: 0, max: 200 }),
        (raw, windowStart, windowLength, required) => {
          const items = raw.map(([s, l]): [number, number] => [s, s + l]);
          const context = testContext({
            mealWindow: {
              start: `${String(Math.floor(windowStart / 60)).padStart(2, '0')}:${String(windowStart % 60).padStart(2, '0')}`,
              end: `${String(Math.floor((windowStart + windowLength) / 60)).padStart(2, '0')}:${String((windowStart + windowLength) % 60).padStart(2, '0')}`,
              requiredFreeMinutes: required,
            },
          });
          const report = check(
            items.map(([s, e], i) => busy(`Item ${i}`, s, e)),
            context,
          );
          const covered = bitmap(items);
          let free = 0;
          for (let m = windowStart; m < windowStart + windowLength; m += 1) {
            if (!covered[m]) free += 1;
          }
          const day = report.days[0];
          expect(day.freeMealMinutes).toBe(free);
          expect(day.mealLayoverMissing).toBe(free < required);
          expect(day.reasons.some((r) => r.includes('meal window'))).toBe(free < required);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Feature: itinerary-rules, Property 9: Long stretch reported exactly when an unbroken run exceeds the max
  test('Property 9: a long stretch is reported exactly when a run exceeds the maximum', () => {
    fc.assert(
      fc.property(itemsArb(1200, 200), fc.integer({ min: 30, max: 400 }), (raw, maxStretch) => {
        const items = raw.map(([s, l]): [number, number] => [s, s + l]);
        const report = check(
          items.map(([s, e], i) => busy(`Item ${i}`, s, e)),
          testContext({ maxStretchMinutes: maxStretch }),
        );
        const covered = bitmap(items);
        let longest = 0;
        let run = 0;
        for (const isCovered of covered) {
          run = isCovered ? run + 1 : 0;
          longest = Math.max(longest, run);
        }
        const day = report.days[0];
        if (longest > maxStretch) {
          expect(day.longStretchMinutes).toBe(longest);
          expect(day.reasons.some((r) => r.includes('without a break'))).toBe(true);
        } else {
          expect(day.longStretchMinutes).toBeUndefined();
        }
      }),
      { numRuns: 300 },
    );
  });

  // Feature: itinerary-rules, Property 10: Suggested blocks are complete and clash-free, or none is reported
  test('Property 10: suggestions are complete and clash-free, or the report says none fit', () => {
    fc.assert(
      fc.property(itemsArb(1300, 400), fc.integer({ min: 30, max: 240 }), (raw, maxStretch) => {
        const items = raw.map(([s, l]): [number, number] => [s, s + l]);
        const report = check(
          items.map(([s, e], i) => busy(`Item ${i}`, s, e)),
          testContext({ maxStretchMinutes: maxStretch }),
        );
        for (const day of report.days) {
          const triggers =
            (day.mealLayoverMissing ? 1 : 0) + (day.longStretchMinutes === undefined ? 0 : 1);
          expect(day.suggestions.length <= triggers).toBe(true);
          for (const s of day.suggestions) {
            expect(s.reason.length).toBeGreaterThan(0);
            const start = parseInstant(s.start)!;
            const end = parseInstant(s.end)!;
            expect(end).toBeGreaterThan(start);
            for (const [is, ie] of items) {
              const itemStart = MIDNIGHT + is * 60_000;
              const itemEnd = MIDNIGHT + ie * 60_000;
              expect(start < itemEnd && end > itemStart).toBe(false);
            }
          }
          expect(day.noPlacementReason !== undefined).toBe(day.suggestions.length < triggers);
        }
      }),
      { numRuns: 300 },
    );
  });
});
