import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import type { Commitment, NormalisedSession } from '@compass/contracts';
import { planSafeSwap } from '../../src/rules/safe-swap.js';
import { personal, reserved, scheduleOf, session, testContext } from './helpers.js';

// Tests for safe swap planning (itinerary-rules, S2).
// Requirements: 7.1 to 7.7. All sample data is self-made.

const BASE = Date.parse('2026-12-02T17:00:00Z'); // 09:00 Pacific on 2 December 2026
const iso = (ms: number): string => new Date(ms).toISOString();
const slot = (code: string, id: string, startMin: number, endMin: number) =>
  session({
    sessionId: id,
    code,
    startsAt: iso(BASE + startMin * 60_000),
    endsAt: iso(BASE + endMin * 60_000),
  });

// The original is the 10:00 to 11:00 session on 1 December. The repeat runs on 2 December.
const original = session({ sessionId: 'orig', code: 'DAT302' });
const repeat = session({
  sessionId: 'rep',
  code: 'DAT302-R',
  startsAt: iso(BASE),
  endsAt: iso(BASE + 3_600_000),
});

describe('safe swap examples', () => {
  test('safe: held and clash free gives three steps and unblocks the cancel step', () => {
    const confirmation = scheduleOf([original, repeat]);
    const result = planSafeSwap(reserved(original), repeat, confirmation, testContext());
    expect(result.outcome).toBe('safe');
    expect(result.clashesWith).toEqual([]);
    expect(result.steps.map((s) => [s.order, s.action, s.blockedUntilConfirmed])).toEqual([
      [1, 'reserveRepeat', false],
      [2, 'confirmHeld', false],
      [3, 'cancelOriginal', false],
    ]);
    expect(result.steps[0].reason).toBe('Reserve the repeat DAT302-R first.');
    expect(result.steps[2].reason).toContain('You can cancel the original now');
    expect(result.reason).toBe('The repeat is held and clashes with nothing. The swap is safe.');
  });

  test('failed: the confirmation schedule does not show the repeat held', () => {
    const confirmation = scheduleOf([original]);
    const result = planSafeSwap(reserved(original), repeat, confirmation, testContext());
    expect(result.outcome).toBe('failed');
    expect(result.steps[2].blockedUntilConfirmed).toBe(true);
    expect(result.steps[2].reason).toContain('Do not cancel the original');
    expect(result.reason).toContain('does not show the repeat as held');
    expect(result.reason).toContain('original stays unchanged');
  });

  test('unsafe: names every commitment the repeat clashes with', () => {
    const other = slot('OTHER1', 'o1', 30, 90);
    const lunch = personal('Lunch', iso(BASE + 3_000_000), iso(BASE + 4_000_000), 'Alpha Hall');
    const fine = slot('FINE1', 'f1', 600, 660);
    const confirmation = scheduleOf([original, repeat, other, fine], [lunch]);
    const result = planSafeSwap(reserved(original), repeat, confirmation, testContext());
    expect(result.outcome).toBe('unsafe');
    expect(result.clashesWith).toEqual(['OTHER1', 'Lunch']);
    expect(result.steps[2].blockedUntilConfirmed).toBe(true);
    expect(result.reason).toBe(
      'The repeat clashes with OTHER1. The repeat clashes with Lunch. The swap cannot be made safely. The original stays unchanged.',
    );
  });

  test('unsafe even when the repeat is not held yet, and when it clashes with the original', () => {
    const overlappingOriginal = slot('DAT302', 'orig2', 15, 75);
    const result = planSafeSwap(
      reserved(overlappingOriginal),
      repeat,
      { commitments: [reserved(overlappingOriginal)], sessions: { orig2: overlappingOriginal } },
      testContext(),
    );
    expect(result.outcome).toBe('unsafe');
    expect(result.clashesWith).toEqual(['DAT302']);
  });

  test('the original is checked even when the confirmation schedule leaves it out', () => {
    const overlappingOriginal = slot('DAT302', 'orig2', 15, 75);
    const confirmation = {
      commitments: [reserved(repeat)],
      sessions: { rep: repeat, orig2: overlappingOriginal },
    };
    const result = planSafeSwap(reserved(overlappingOriginal), repeat, confirmation, testContext());
    expect(result.clashesWith).toEqual(['DAT302']);
  });

  test('the repeat never clashes with itself, and a personal-time original works', () => {
    const resting = personal('Rest', '2026-12-01T12:00:00-08:00', '2026-12-01T12:30:00-08:00');
    const confirmation = { commitments: [reserved(repeat), resting], sessions: { rep: repeat } };
    const result = planSafeSwap(resting, repeat, confirmation, testContext());
    expect(result.outcome).toBe('safe');
  });

  test('unknown: a repeat with no usable times cannot be checked', () => {
    const noEnd = session({ sessionId: 'rep', code: 'DAT302-R', endsAt: undefined });
    const result = planSafeSwap(reserved(original), noEnd, scheduleOf([original]), testContext());
    expect(result.outcome).toBe('unknown');
    expect(result.reason).toBe(
      'The repeat has no usable start or end time. The swap cannot be checked. The original stays unchanged.',
    );
    expect(result.steps).toHaveLength(3);
    expect(result.steps[2].blockedUntilConfirmed).toBe(true);
  });

  test('unknown: a missing or unrecognised timezone cannot be checked', () => {
    const confirmation = scheduleOf([original, repeat]);
    const missing = planSafeSwap(
      reserved(original),
      repeat,
      confirmation,
      testContext({ eventTimezone: undefined }),
    );
    expect(missing.outcome).toBe('unknown');
    expect(missing.reason).toContain('timezone is missing');
    const bad = planSafeSwap(
      reserved(original),
      repeat,
      confirmation,
      testContext({ eventTimezone: 'Nope/Nowhere' }),
    );
    expect(bad.reason).toContain('not recognised');
  });

  test('judges clashes on instants across a daylight saving change', () => {
    const early = session({
      sessionId: 'a',
      code: 'EARLY',
      startsAt: '2026-03-08T01:30:00-08:00',
      endsAt: '2026-03-08T03:30:00-07:00',
    });
    const touching = session({
      sessionId: 'rep',
      code: 'DAT302-R',
      startsAt: '2026-03-08T03:30:00-07:00',
      endsAt: '2026-03-08T04:30:00-07:00',
    });
    const result = planSafeSwap(
      reserved(early),
      touching,
      scheduleOf([early, touching]),
      testContext(),
    );
    expect(result.outcome).toBe('safe');
  });
});

describe('safe swap properties', () => {
  // Feature: itinerary-rules, Property 13: Safe swap produces the three gated steps and an outcome that matches clash and confirmation state
  test('Property 13: three gated steps, and an outcome that matches clash and held state', () => {
    const spanArb = fc.tuple(fc.integer({ min: -30, max: 120 }), fc.integer({ min: 1, max: 90 }));
    fc.assert(
      fc.property(
        spanArb,
        fc.array(spanArb, { maxLength: 4 }),
        fc.boolean(),
        fc.boolean(),
        (originalSpan, otherSpans, held, originalListed) => {
          const orig = slot('ORIG', 'orig', originalSpan[0], originalSpan[0] + originalSpan[1]);
          const others = otherSpans.map(([s, l], i) => slot(`OTH${i}`, `o${i}`, s, s + l));
          const sessions: NormalisedSession[] = [...others, orig];
          const commitments: Commitment[] = others.map((o) => reserved(o));
          if (originalListed) commitments.push(reserved(orig));
          if (held) commitments.push(reserved(repeat));
          const confirmation = {
            commitments,
            sessions: Object.fromEntries([...sessions, repeat].map((s) => [s.sessionId, s])),
          };
          const snapshot = structuredClone({ orig, repeat, confirmation });

          const result = planSafeSwap(reserved(orig), repeat, confirmation, testContext());

          const clashing = [orig, ...others].filter((s) => {
            const a = [Date.parse(repeat.startsAt!), Date.parse(repeat.endsAt!)] as const;
            const b = [Date.parse(s.startsAt!), Date.parse(s.endsAt!)] as const;
            return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) >= 1000;
          });
          const expected = clashing.length > 0 ? 'unsafe' : held ? 'safe' : 'failed';
          expect(result.outcome).toBe(expected);
          expect(result.clashesWith.sort()).toEqual(clashing.map((s) => s.code).sort());
          expect(result.steps.map((s) => s.action)).toEqual([
            'reserveRepeat',
            'confirmHeld',
            'cancelOriginal',
          ]);
          expect(result.steps.map((s) => s.order)).toEqual([1, 2, 3]);
          expect(result.steps.map((s) => s.blockedUntilConfirmed)).toEqual([
            false,
            false,
            expected !== 'safe',
          ]);
          expect(result.steps.every((s) => s.reason.length > 0)).toBe(true);
          expect(result.reason.length).toBeGreaterThan(0);
          expect({ orig, repeat, confirmation }).toEqual(snapshot);
        },
      ),
      { numRuns: 300 },
    );
  });
});
