import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { VerdictSchema, type NormalisedSession } from '@compass/contracts';
import { checkReservation } from '../../src/rules/check-reservation.js';
import { personal, scheduleOf, session, testContext } from './helpers.js';

// Tests for the checkReservation guardrail (itinerary-rules, S2).
// Requirements: 8.1 to 8.10. All sample data is self-made.

const MIDNIGHT = Date.parse('2026-12-01T08:00:00Z'); // 00:00 Pacific on 1 December 2026
const iso = (ms: number): string => new Date(ms).toISOString();
const clock = (h: number, m = 0): number => h * 60 + m;

/** A session from one local minute of 1 December 2026 to another. */
function slot(
  code: string,
  startMin: number,
  endMin: number,
  overrides: Partial<NormalisedSession> = {},
): NormalisedSession {
  return session({
    sessionId: code.toLowerCase(),
    code,
    startsAt: iso(MIDNIGHT + startMin * 60_000),
    endsAt: iso(MIDNIGHT + endMin * 60_000),
    venue: 'Alpha Hall',
    ...overrides,
  });
}

function check(
  candidate: NormalisedSession,
  others: NormalisedSession[] = [],
  context = testContext(),
  extra: ReturnType<typeof personal>[] = [],
) {
  const verdict = checkReservation(candidate, scheduleOf(others, extra), context);
  expect(VerdictSchema.safeParse(verdict).success).toBe(true);
  return verdict;
}

// With the defaults a walk between different venues is 10 minutes plus a 10 minute buffer,
// boarding closes 10 minutes before the start, and a connection is tight under 5 spare minutes.

describe('allow', () => {
  test('an empty schedule allows the candidate with no reasons', () => {
    expect(check(slot('NEW1', clock(10), clock(11)))).toEqual({ decision: 'allow', reasons: [] });
  });

  test('a comfortable connection and a free day allow it', () => {
    const before = slot('OLD1', clock(8), clock(9), { venue: 'Beta Tower' });
    const after = slot('OLD2', clock(13), clock(14), { venue: 'Gamma Plaza' });
    expect(check(slot('NEW1', clock(10), clock(11)), [before, after]).decision).toBe('allow');
  });

  test('a candidate already in the schedule is ignored and never clashes with itself', () => {
    const candidate = slot('NEW1', clock(10), clock(11));
    expect(check(candidate, [candidate]).decision).toBe('allow');
  });

  test('an other-day commitment is not a neighbour', () => {
    const otherDay = slot('OLD1', clock(24 + 10), clock(24 + 11), { venue: 'Beta Tower' });
    expect(check(slot('NEW1', clock(10), clock(11)), [otherDay]).decision).toBe('allow');
  });
});

describe('block rules', () => {
  test('a clash between two other commitments is not a problem for the candidate', () => {
    const first = slot('OLD1', clock(9), clock(10));
    const second = slot('OLD2', clock(9, 30), clock(10, 30));
    expect(check(slot('NEW1', clock(15), clock(16)), [first, second]).decision).toBe('allow');
  });

  test('a clash blocks and names the clashing commitment', () => {
    const verdict = check(slot('NEW1', clock(10), clock(11)), [
      slot('OLD1', clock(10, 30), clock(11, 30)),
    ]);
    expect(verdict.decision).toBe('block');
    expect(verdict.reasons).toEqual([
      'NEW1 and OLD1 overlap from 2026-12-01 10:30 to 2026-12-01 11:00.',
    ]);
  });

  test('an impossible connection from an earlier commitment blocks and names it', () => {
    const earlier = slot('OLD1', clock(9), clock(10), { venue: 'Beta Tower' });
    const verdict = check(slot('NEW1', clock(10, 25), clock(11, 25)), [earlier]);
    expect(verdict.decision).toBe('block');
    expect(verdict.reasons).toEqual([
      'Impossible connection. The walk from Beta Tower to Alpha Hall is 20 minutes, an estimate. You would arrive 5 minutes late.',
    ]);
  });

  test('an impossible connection to a later commitment blocks', () => {
    const later = slot('OLD1', clock(11, 25), clock(12, 25), { venue: 'Beta Tower' });
    const verdict = check(slot('NEW1', clock(10), clock(11)), [later]);
    expect(verdict.decision).toBe('block');
    expect(verdict.reasons[0]).toContain('Impossible connection');
  });

  test('a clashing neighbour is reported once, as a clash, not again as a connection', () => {
    const verdict = check(slot('NEW1', clock(10), clock(11)), [
      slot('OLD1', clock(9, 30), clock(10, 30), { venue: 'Beta Tower' }),
    ]);
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]).toContain('overlap');
  });
});

describe('warn rules', () => {
  test('a tight connection from an earlier commitment warns and names it', () => {
    const earlier = slot('OLD1', clock(9), clock(10), { venue: 'Beta Tower' });
    const verdict = check(slot('NEW1', clock(10, 33), clock(11, 33)), [earlier]);
    expect(verdict).toEqual({
      decision: 'warn',
      reasons: [
        'Tight connection. The walk from Beta Tower to Alpha Hall is 20 minutes, an estimate. That leaves only 3 minutes to spare.',
      ],
    });
  });

  test('a tight connection to a later commitment warns', () => {
    const later = slot('OLD1', clock(11, 33), clock(12, 33), { venue: 'Beta Tower' });
    const verdict = check(slot('NEW1', clock(10), clock(11)), [later]);
    expect(verdict.decision).toBe('warn');
    expect(verdict.reasons[0]).toContain('Tight connection');
  });

  test('removing the only meal break warns and names the lost meal break', () => {
    const work = personal(
      'Work',
      iso(MIDNIGHT + clock(11, 30) * 60_000),
      iso(MIDNIGHT + clock(12) * 60_000),
      'Alpha Hall',
    );
    const candidate = slot('NEW1', clock(12, 25), clock(13, 56));
    const verdict = check(candidate, [], testContext(), [work]);
    expect(verdict).toEqual({
      decision: 'warn',
      reasons: ['This removes your only meal break on 2026-12-01.'],
    });
  });

  test('no warning when the meal break was already missing', () => {
    const verdict = check(slot('NEW1', clock(14, 10), clock(15)), [
      slot('OLD1', clock(11, 30), clock(13, 45)),
    ]);
    expect(verdict.decision).toBe('allow');
  });

  test('raising the day over the overload line warns and names the overload', () => {
    const context = testContext({ overloadCountThreshold: 2 });
    const others = [slot('OLD1', clock(8), clock(8, 30)), slot('OLD2', clock(9, 30), clock(10))];
    const verdict = check(slot('NEW1', clock(16), clock(17)), others, context);
    expect(verdict).toEqual({
      decision: 'warn',
      reasons: ['This makes 2026-12-01 too busy. 3 commitments is more than the limit of 2.'],
    });
  });

  test('no warning when the day was already overloaded', () => {
    const context = testContext({ overloadCountThreshold: 1 });
    const others = [slot('OLD1', clock(8), clock(8, 30)), slot('OLD2', clock(9, 30), clock(10))];
    expect(check(slot('NEW1', clock(16), clock(17)), others, context).decision).toBe('allow');
  });
});

describe('missing data', () => {
  test('a candidate with no end time skips every rule and names each one', () => {
    const verdict = check(slot('NEW1', clock(10), clock(11), { endsAt: undefined }), [
      slot('OLD1', clock(10), clock(11)),
    ]);
    expect(verdict.decision).toBe('warn');
    expect(verdict.reasons).toHaveLength(4);
    for (const rule of ['clash check', 'connection check', 'meal break check', 'energy check']) {
      expect(
        verdict.reasons.some((r) =>
          r.includes(`The ${rule} could not be judged because data was missing.`),
        ),
      ).toBe(true);
    }
    expect(verdict.reasons[0]).toContain('The end time of NEW1 is missing.');
  });

  test('a missing or unrecognised timezone skips every rule', () => {
    const missing = check(
      slot('NEW1', clock(10), clock(11)),
      [],
      testContext({ eventTimezone: undefined }),
    );
    expect(missing.decision).toBe('warn');
    expect(missing.reasons).toHaveLength(4);
    expect(missing.reasons[0]).toContain('timezone is missing');
    const bad = check(
      slot('NEW1', clock(10), clock(11)),
      [],
      testContext({ eventTimezone: 'Nope/Nowhere' }),
    );
    expect(bad.reasons[0]).toContain('not recognised');
  });

  test('a missing venue skips the connection rule without blocking', () => {
    const earlier = slot('OLD1', clock(9), clock(10), { venue: 'Beta Tower' });
    const verdict = check(slot('NEW1', clock(10, 5), clock(11), { venue: undefined }), [earlier]);
    expect(verdict.decision).toBe('warn');
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]).toContain('The connection check could not be judged');
    expect(verdict.reasons[0]).toContain('The venue for NEW1 is missing.');
  });

  test('a commitment with a missing end time skips the clash and meal checks, not the rest', () => {
    const noEnd = slot('OLD1', clock(15), clock(16), { endsAt: undefined });
    const verdict = check(slot('NEW1', clock(10), clock(11)), [noEnd]);
    expect(verdict.decision).toBe('warn');
    expect(verdict.reasons).toHaveLength(2);
    expect(verdict.reasons[0]).toContain('The clash check could not be judged');
    expect(verdict.reasons[0]).toContain('end time of OLD1');
    expect(verdict.reasons[1]).toContain('The meal break check could not be judged');
  });

  test('a commitment with a missing start time skips the energy check', () => {
    const noStart = slot('OLD1', clock(15), clock(16), { startsAt: undefined });
    const verdict = check(slot('NEW1', clock(10), clock(11)), [noStart]);
    expect(verdict.decision).toBe('warn');
    expect(verdict.reasons.some((r) => r.includes('The energy check could not be judged'))).toBe(
      true,
    );
  });

  test('an all-day commitment is not judged for connections or meal breaks', () => {
    const expo = slot('EXPO', clock(9), clock(10), { isAllDay: true, endsAt: undefined });
    const verdict = check(slot('NEW1', clock(10), clock(11)), [expo]);
    expect(verdict.reasons.some((r) => r.includes('connection check'))).toBe(false);
  });
});

describe('all-day candidate', () => {
  test('is checked for clashes but not for connections or meal breaks', () => {
    const expo = slot('EXPO', clock(9), clock(10), { isAllDay: true, endsAt: undefined });
    const timed = slot('OLD1', clock(11, 30), clock(13, 50), { venue: 'Beta Tower' });
    const verdict = check(expo, [timed]);
    expect(verdict.decision).toBe('block');
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]).toContain('EXPO and OLD1 overlap');
  });
});

describe('severity precedence', () => {
  test('block wins over warn and missing data, and every applied rule has one reason', () => {
    const context = testContext({ overloadCountThreshold: 3 });
    const clashing = slot('OLD1', clock(10, 30), clock(11, 30));
    const tightNeighbour = slot('OLD2', clock(11, 33), clock(12, 33), { venue: 'Beta Tower' });
    const noEnd = slot('OLD3', clock(18), clock(19), { endsAt: undefined });
    const verdict = check(
      slot('NEW1', clock(10), clock(11)),
      [clashing, tightNeighbour, noEnd],
      context,
    );
    expect(verdict.decision).toBe('block');
    expect(verdict.reasons[0]).toContain('overlap');
    expect(verdict.reasons.some((r) => r.startsWith('Tight connection'))).toBe(true);
    expect(verdict.reasons.some((r) => r.includes('The clash check could not be judged'))).toBe(
      true,
    );
    expect(verdict.reasons.some((r) => r.includes('too busy'))).toBe(true);
  });

  test('warn wins over allow', () => {
    const earlier = slot('OLD1', clock(9), clock(10), { venue: 'Beta Tower' });
    expect(check(slot('NEW1', clock(10, 33), clock(11, 33)), [earlier]).decision).toBe('warn');
  });

  test('every reason is free of em dashes and en dashes', () => {
    const em = String.fromCharCode(0x2014);
    const en = String.fromCharCode(0x2013);
    const verdict = check(slot('NEW1', clock(10), clock(11), { code: `A${em}B C${en}D` }), [
      slot('OLD1', clock(10, 30), clock(11, 30), { code: `X${em}Y` }),
    ]);
    for (const text of verdict.reasons) {
      expect(text).not.toContain(em);
      expect(text).not.toContain(en);
    }
  });
});

describe('guardrail properties', () => {
  // Feature: itinerary-rules, Property 14: checkReservation returns one valid Verdict by severity precedence and never blocks on missing data
  test('Property 14: one valid verdict, by precedence, never blocked on missing data', () => {
    const venueArb = fc.constantFrom<string | undefined>(
      'Alpha Hall',
      'Beta Tower',
      'Gamma Plaza',
      undefined,
    );
    const sessionArb = fc.record({
      start: fc.integer({ min: 0, max: 1300 }),
      length: fc.integer({ min: 1, max: 150 }),
      venue: venueArb,
      noEnd: fc.boolean(),
      noStart: fc.boolean(),
    });
    fc.assert(
      fc.property(
        sessionArb,
        fc.array(sessionArb, { maxLength: 4 }),
        fc.boolean(),
        (rawCandidate, rawOthers, zoneMissing) => {
          const build = (r: typeof rawCandidate, code: string) =>
            slot(code, r.start, r.start + r.length, {
              venue: r.venue,
              endsAt: r.noEnd ? undefined : iso(MIDNIGHT + (r.start + r.length) * 60_000),
              startsAt: r.noStart ? undefined : iso(MIDNIGHT + r.start * 60_000),
            });
          const candidate = build(rawCandidate, 'CAND');
          const others = rawOthers.map((r, i) => build(r, `OTH${i}`));
          const context = testContext({
            eventTimezone: zoneMissing ? undefined : 'America/Los_Angeles',
          });
          const verdict = checkReservation(candidate, scheduleOf(others), context);

          // Exactly one valid verdict.
          expect(VerdictSchema.safeParse(verdict).success).toBe(true);
          if (verdict.decision === 'allow') {
            expect(verdict.reasons).toEqual([]);
          } else {
            expect(verdict.reasons.length).toBeGreaterThan(0);
          }

          const candidateUsable = !zoneMissing && !rawCandidate.noEnd && !rawCandidate.noStart;
          if (!candidateUsable) {
            // Missing data: never blocked, at least warn, every rule named.
            expect(verdict.decision).toBe('warn');
            expect(verdict.reasons).toHaveLength(4);
            return;
          }

          // Independent clash oracle over commitments that have usable times.
          const span = (r: typeof rawCandidate) =>
            [r.start * 60, (r.start + r.length) * 60] as const;
          const [cs, ce] = span(rawCandidate);
          const clashing = rawOthers
            .map((r, i) => ({ r, code: `OTH${i}` }))
            .filter(({ r }) => !r.noEnd && !r.noStart)
            .filter(({ r }) => {
              const [os, oe] = span(r);
              return Math.min(ce, oe) - Math.max(cs, os) >= 1;
            });
          if (clashing.length > 0) {
            expect(verdict.decision).toBe('block');
            for (const { code } of clashing) {
              expect(
                verdict.reasons.some((text) => text.includes(code) && text.includes('overlap')),
              ).toBe(true);
            }
          }
          // A block always has a block-type reason.
          if (verdict.decision === 'block') {
            expect(
              verdict.reasons.some(
                (t) => t.includes('overlap from') || t.startsWith('Impossible connection'),
              ),
            ).toBe(true);
          }
          // With no clash, a missing candidate venue can never cause a block.
          if (clashing.length === 0 && rawCandidate.venue === undefined) {
            expect(verdict.decision).not.toBe('block');
          }
          // A commitment with missing end or start is named by the clash or energy check.
          if (rawOthers.some((r) => r.noEnd || r.noStart)) {
            expect(verdict.decision).not.toBe('allow');
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
