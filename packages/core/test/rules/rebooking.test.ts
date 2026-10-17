import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import type { NormalisedSession } from '@compass/contracts';
import { baseCodeOf, findRebookingOptions } from '../../src/rules/rebooking.js';
import { session, testContext } from './helpers.js';

// Tests for rebooking options (itinerary-rules, S2).
// Requirements: 6.1 to 6.7. All sample data is self-made.

const NOW_MS = Date.parse('2026-12-01T14:00:00Z'); // the helper NOW, 06:00 Pacific
const iso = (ms: number): string => new Date(ms).toISOString();
const later = (minutes: number): string => iso(NOW_MS + minutes * 60_000);

function run(
  base: string,
  candidates: NormalisedSession[],
  favorites: NormalisedSession[] = [],
  context = testContext(),
) {
  return findRebookingOptions(base, candidates, favorites, context);
}

describe('rebooking examples', () => {
  test('finds repeats by the -R suffix and by repeatOf, after now only', () => {
    const byCode = session({ sessionId: 'a', code: 'DAT302-R', startsAt: later(60) });
    const byPointer = session({
      sessionId: 'b',
      code: 'OTHER9',
      repeatOf: 'DAT302',
      startsAt: later(30),
    });
    const past = session({ sessionId: 'c', code: 'DAT302-R', startsAt: later(-5) });
    const atNow = session({ sessionId: 'd', code: 'DAT302-R', startsAt: later(0) });
    const wrong = session({ sessionId: 'e', code: 'DAT303-R', startsAt: later(60) });
    const result = run('DAT302', [byCode, byPointer, past, atNow, wrong]);
    expect(result.status).toBe('ok');
    expect(result.options.map((o) => [o.kind, o.sessionId])).toEqual([
      ['repeat', 'b'],
      ['repeat', 'a'],
    ]);
    expect(result.message).toBe('Found 2 ways to still attend.');
    expect(result.options[1].reason).toBe('Repeat "DAT302-R" starts 2026-12-01 07:00.');
  });

  test('a base code given with its -R suffix finds the same options', () => {
    const repeat = session({ sessionId: 'a', code: 'DAT302-R', startsAt: later(60) });
    expect(baseCodeOf(' DAT302-R ')).toBe('DAT302');
    expect(baseCodeOf('DAT302')).toBe('DAT302');
    expect(run('DAT302-R', [repeat]).options).toHaveLength(1);
  });

  test('lists favorites held as standby that share the base code', () => {
    const standby = session({ sessionId: 'f', code: 'DAT302', startsAt: later(120) });
    const standbyRepeat = session({ sessionId: 'g', code: 'DAT302-R', startsAt: later(240) });
    const other = session({ sessionId: 'h', code: 'ZZZ1', startsAt: later(120) });
    const old = session({ sessionId: 'i', code: 'DAT302', startsAt: later(-60) });
    const result = run('DAT302', [], [standby, standbyRepeat, other, old]);
    expect(result.options.map((o) => [o.kind, o.sessionId])).toEqual([
      ['standby', 'f'],
      ['standby', 'g'],
    ]);
    expect(result.message).toBe('Found 2 ways to still attend.');
    expect(result.options[0].reason).toBe(
      'You favorited "DAT302" as a backup. It starts 2026-12-01 08:00.',
    );
  });

  test('lists walk-up options for sessions that need no reservation or are full', () => {
    const open = session({
      sessionId: 'w1',
      code: 'DAT302',
      isReservable: false,
      startsAt: later(60),
    });
    const full = session({
      sessionId: 'w2',
      code: 'DAT302',
      seatAvailability: 'unavailable',
      startsAt: later(90),
    });
    const walkUpBand = session({
      sessionId: 'w3',
      code: 'DAT302',
      seatAvailability: 'walkUp',
      startsAt: later(100),
    });
    const seats = session({ sessionId: 'w4', code: 'DAT302', startsAt: later(110) });
    const unknownFlag = session({
      sessionId: 'w5',
      code: 'DAT302',
      isReservable: false,
      missingFields: ['isReservable'],
      startsAt: later(120),
    });
    const result = run('DAT302', [open, full, walkUpBand, seats, unknownFlag]);
    expect(result.options.map((o) => o.sessionId)).toEqual(['w1', 'w2', 'w3']);
    expect(result.options.every((o) => o.kind === 'walkUp')).toBe(true);
    expect(result.options[0].reason).toContain('needs no reservation');
    expect(result.options[1].reason).toContain('is full');
  });

  test('lists a session once, under the first kind that fits', () => {
    const both = session({
      sessionId: 'x',
      code: 'DAT302-R',
      seatAvailability: 'unavailable',
      startsAt: later(60),
    });
    const result = run('DAT302', [both], [both]);
    expect(result.options.map((o) => o.kind)).toEqual(['repeat']);
    const standbyFull = session({
      sessionId: 'y',
      code: 'DAT302',
      seatAvailability: 'unavailable',
      startsAt: later(60),
    });
    expect(run('DAT302', [standbyFull], [standbyFull]).options.map((o) => o.kind)).toEqual([
      'standby',
    ]);
  });

  test('skips sessions with no usable start time', () => {
    const noStart = session({ sessionId: 'n', code: 'DAT302-R', startsAt: undefined });
    const listed = session({
      sessionId: 'm',
      code: 'DAT302-R',
      missingFields: ['startsAt'],
      startsAt: later(60),
    });
    expect(run('DAT302', [noStart, listed]).options).toEqual([]);
  });

  test('returns zero options and a message when nothing is found', () => {
    expect(run('DAT302', [])).toEqual({
      status: 'ok',
      options: [],
      message: 'No alternative was found for this session.',
    });
  });

  test('a single option reads as one way', () => {
    const one = session({ sessionId: 'a', code: 'DAT302-R', startsAt: later(60) });
    expect(run('DAT302', [one]).message).toBe('Found 1 way to still attend.');
  });

  test('judges "after now" on instants, whatever offset the start is written in', () => {
    const sameInstant = session({
      sessionId: 'a',
      code: 'DAT302-R',
      startsAt: '2026-12-01T06:00:00-08:00',
    });
    const justAfter = session({
      sessionId: 'b',
      code: 'DAT302-R',
      startsAt: '2026-12-01T06:00:01-08:00',
    });
    expect(run('DAT302', [sameInstant, justAfter]).options.map((o) => o.sessionId)).toEqual(['b']);
  });
});

describe('repeat suffixes and the original session', () => {
  test('matches -R, -R1, -R2 and so on, in any case, for the base code in any case', () => {
    const codes = ['DAT302-R', 'DAT302-R1', 'DAT302-R2', 'dat302-r', 'Dat302-R12'];
    const repeats = codes.map((code, i) =>
      session({ sessionId: `r${i}`, code, startsAt: later(60 + i) }),
    );
    const result = run('DAT302', repeats);
    expect(result.options.map((o) => o.kind)).toEqual(Array(5).fill('repeat'));
    expect(result.options).toHaveLength(5);
    expect(run('dat302-r2', repeats).options).toHaveLength(5);
  });

  test('a code that only looks similar, or has no suffix, is not a repeat', () => {
    const near = [
      session({ sessionId: 'a', code: 'DAT302-RX', startsAt: later(60) }),
      session({ sessionId: 'b', code: 'DAT302R', startsAt: later(60) }),
      session({ sessionId: 'c', code: 'DAT3020-R', startsAt: later(60) }),
      session({ sessionId: 'd', code: 'DAT302', startsAt: later(60) }),
    ];
    expect(run('DAT302', near).options).toEqual([]);
  });

  test('baseCodeOf strips any -R number suffix, trims, and treats non-text as empty', () => {
    expect(baseCodeOf(' DAT302-R2 ')).toBe('DAT302');
    expect(baseCodeOf('dat302-r')).toBe('dat302');
    expect(baseCodeOf('DAT302-R2-R')).toBe('DAT302-R2');
    for (const value of [undefined, null, 5, {}]) {
      expect(baseCodeOf(value)).toBe('');
    }
  });

  test('repeatOf matches the base code in any case', () => {
    const pointer = session({
      sessionId: 'p',
      code: 'OTHER9',
      repeatOf: 'dat302',
      startsAt: later(60),
    });
    expect(run('DAT302', [pointer]).options.map((o) => o.sessionId)).toEqual(['p']);
  });

  test('an empty or blank base code matches nothing, even sessions with an empty code', () => {
    const blank = session({ sessionId: 'x', code: '', startsAt: later(60), isReservable: false });
    const dash = session({ sessionId: 'y', code: '-R', startsAt: later(60) });
    for (const base of ['', '   ', '-R']) {
      expect(run(base, [blank, dash], [blank, dash])).toEqual({
        status: 'ok',
        options: [],
        message: 'No alternative was found for this session.',
      });
    }
  });

  test('the original session is never offered as its own alternative, when its id is known', () => {
    const original = session({
      sessionId: 'orig',
      code: 'DAT302',
      startsAt: later(30),
      isReservable: false,
    });
    const standby = session({ sessionId: 'orig', code: 'DAT302', startsAt: later(30) });
    const repeat = session({ sessionId: 'rep', code: 'DAT302-R', startsAt: later(60) });
    const without = run('DAT302', [original, repeat], [standby]);
    expect(without.options.map((o) => o.sessionId)).toEqual(['orig', 'rep']);
    const withId = findRebookingOptions(
      'DAT302',
      [original, repeat],
      [standby],
      testContext(),
      'orig',
    );
    expect(withId.options.map((o) => o.sessionId)).toEqual(['rep']);
  });

  test('sessions with a code that is not text are ignored, not a crash', () => {
    const odd = session({ sessionId: 'odd', startsAt: later(60) });
    (odd as unknown as { code: unknown }).code = 7;
    expect(run('DAT302', [odd], [odd]).options).toEqual([]);
  });
});

describe('rebooking unknowns', () => {
  const repeat = session({ sessionId: 'a', code: 'DAT302-R', startsAt: later(60) });

  test('a missing or unrecognised timezone gives zero options and a message', () => {
    const missing = run('DAT302', [repeat], [], testContext({ eventTimezone: undefined }));
    expect(missing).toEqual({
      status: 'unknown',
      options: [],
      message: 'The event timezone is missing. Times cannot be judged. No options can be listed.',
    });
    const bad = run('DAT302', [repeat], [], testContext({ eventTimezone: 'Nope/Nowhere' }));
    expect(bad.status).toBe('unknown');
    expect(bad.message).toContain('not recognised');
  });

  test('an unusable current time gives zero options and a message', () => {
    const result = run('DAT302', [repeat], [], testContext({ now: 'yesterday' }));
    expect(result).toEqual({
      status: 'unknown',
      options: [],
      message: 'The current time is not usable. No options can be listed.',
    });
  });
});

describe('rebooking properties', () => {
  const codes = ['AAA101', 'AAA101-R', 'BBB202', 'BBB202-R'];
  const sessionArb = fc.record({
    code: fc.constantFrom(...codes),
    repeatOf: fc.option(fc.constantFrom('AAA101', 'BBB202'), { nil: undefined }),
    offset: fc.integer({ min: -180, max: 600 }),
    seat: fc.constantFrom(
      'available',
      'limited',
      'veryLimited',
      'unavailable',
      'walkUp',
      'unknown',
    ),
    reservable: fc.boolean(),
  });

  // Feature: itinerary-rules, Property 12: Every rebooking option matches the base code and starts after now
  test('Property 12: every option matches its kind, starts after now, and none is missed', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArb, { maxLength: 8 }),
        fc.array(fc.tuple(sessionArb, fc.boolean()), { maxLength: 4 }),
        fc.constantFrom('AAA101', 'BBB202', 'CCC303'),
        (rawCandidates, rawFavorites, base) => {
          const build = (r: (typeof rawCandidates)[number], id: string): NormalisedSession =>
            session({
              sessionId: id,
              code: r.code,
              repeatOf: r.repeatOf,
              startsAt: later(r.offset),
              seatAvailability: r.seat,
              isReservable: r.reservable,
            });
          const candidates = rawCandidates.map((r, i) => build(r, `c${i}`));
          const favorites = rawFavorites.map(([r], i) => build(r, `f${i}`));
          const result = run(base, candidates, favorites);
          expect(result.status).toBe('ok');

          const baseOf = (code: string): string => code.replace(/-R$/, '');
          const isAfter = (s: NormalisedSession): boolean => Date.parse(s.startsAt!) > NOW_MS;
          const expected = new Map<string, string>();
          for (const s of candidates) {
            if (
              isAfter(s) &&
              (s.code === `${base}-R` || s.repeatOf === base) &&
              !expected.has(s.sessionId)
            ) {
              expected.set(s.sessionId, 'repeat');
            }
          }
          for (const s of favorites) {
            if (isAfter(s) && baseOf(s.code) === base && !expected.has(s.sessionId)) {
              expected.set(s.sessionId, 'standby');
            }
          }
          for (const s of candidates) {
            const walkUp =
              !s.isReservable ||
              s.seatAvailability === 'unavailable' ||
              s.seatAvailability === 'walkUp';
            if (isAfter(s) && baseOf(s.code) === base && walkUp && !expected.has(s.sessionId)) {
              expected.set(s.sessionId, 'walkUp');
            }
          }

          expect(new Map(result.options.map((o) => [o.sessionId, o.kind]))).toEqual(expected);
          for (const option of result.options) {
            expect(Date.parse(option.startsAt)).toBeGreaterThan(NOW_MS);
            expect(option.reason.length).toBeGreaterThanOrEqual(1);
            expect(option.reason.length).toBeLessThanOrEqual(200);
          }
          if (expected.size === 0) {
            expect(result.message).toBe('No alternative was found for this session.');
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test('Property 12: odd codes and titles still give reasons of 1 to 200 characters', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 300 }), (code) => {
        const s = session({
          sessionId: 'x',
          code: `${code.replace(/-R$/, '')}-R`,
          startsAt: later(60),
        });
        const result = run(code.replace(/-R$/, '').trim(), [s]);
        for (const option of result.options) {
          expect(option.reason.length).toBeGreaterThanOrEqual(1);
          expect(option.reason.length).toBeLessThanOrEqual(200);
        }
      }),
      { numRuns: 100 },
    );
  });
});
