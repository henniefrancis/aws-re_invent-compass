import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { VerdictSchema, type NormalisedSession } from '@compass/contracts';
import { checkReservation } from '../../src/rules/check-reservation.js';
import { findRebookingOptions, sameRepeatGroup } from '../../src/rules/rebooking.js';
import { isSeatUnknown } from '../../src/rules/resolve.js';
import { planSafeSwap } from '../../src/rules/safe-swap.js';
import { reserved, scheduleOf, session, testContext } from './helpers.js';

// Tests for repeat groups as the real catalog has them (itinerary-rules, S2), from the SP5 spike:
// a repeated session never has an unsuffixed code. The first offering is <code>-R and later ones are
// -R1 to -R4. A code ending in -S is a different session, not a repeat marker, and -S-R and -S-R1
// are repeats of the -S code. Some sessions that cannot be reserved have no seatAvailability.
// All sample data is self-made.

const NOW_MS = Date.parse('2026-12-01T14:00:00Z'); // the helper NOW, 06:00 Pacific
const DAY = 24 * 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

/** A session on a day after now, one hour long. Each index is a different day. */
function offering(
  code: string,
  id: string,
  dayIndex: number,
  overrides: Partial<NormalisedSession> = {},
) {
  const start = NOW_MS + (dayIndex + 1) * DAY;
  return session({
    sessionId: id,
    code,
    startsAt: iso(start),
    endsAt: iso(start + 3_600_000),
    ...overrides,
  });
}

const SUFFIXES = ['-R', '-R1', '-R2', '-R3', '-R4'] as const;

describe('sameRepeatGroup', () => {
  test('siblings with no unsuffixed original are in one group, in any case', () => {
    expect(sameRepeatGroup('ABC123-R1', 'ABC123-R3')).toBe(true);
    expect(sameRepeatGroup('ABC123-R', 'ABC123-R4')).toBe(true);
    expect(sameRepeatGroup('abc123-r2', 'ABC123-R')).toBe(true);
    expect(sameRepeatGroup('ABC123', 'ABC123-R2')).toBe(true);
    expect(sameRepeatGroup(' ABC123-R1 ', 'ABC123-R2')).toBe(true);
  });

  test('an -S code is a different session, and -S-R codes repeat the -S code', () => {
    expect(sameRepeatGroup('ABC123-S', 'ABC123')).toBe(false);
    expect(sameRepeatGroup('ABC123-S', 'ABC123-R1')).toBe(false);
    expect(sameRepeatGroup('ABC123-S-R', 'ABC123-R')).toBe(false);
    expect(sameRepeatGroup('ABC123-S-R', 'ABC123-S-R1')).toBe(true);
    expect(sameRepeatGroup('ABC123-S', 'ABC123-S-R1')).toBe(true);
  });

  test('different codes, empty codes and non-text are in no group', () => {
    expect(sameRepeatGroup('ABC123-R1', 'ABC124-R1')).toBe(false);
    expect(sameRepeatGroup('ABC123-R1', 'ABC1234-R1')).toBe(false);
    expect(sameRepeatGroup('', '')).toBe(false);
    expect(sameRepeatGroup('-R', '-R1')).toBe(false);
    expect(sameRepeatGroup(undefined, 'ABC123')).toBe(false);
    expect(sameRepeatGroup('ABC123', null)).toBe(false);
    expect(sameRepeatGroup(5, 5)).toBe(false);
  });
});

describe('rebooking with sibling-only repeat groups and -S codes', () => {
  test('a group with no unsuffixed original offers its siblings, and not the flagged one', () => {
    const group = [
      offering('ABC123-R1', 'a', 0),
      offering('ABC123-R2', 'b', 1),
      offering('ABC123-R3', 'c', 2),
    ];
    const result = findRebookingOptions('ABC123-R1', group, [], testContext(), 'a');
    expect(result.options.map((o) => [o.kind, o.sessionId])).toEqual([
      ['repeat', 'b'],
      ['repeat', 'c'],
    ]);
    // Asking by the base code gives the same group, including the flagged session if no id is given.
    expect(findRebookingOptions('ABC123', group, [], testContext()).options).toHaveLength(3);
  });

  test('an -S session is not offered for the base code, and its own repeats are offered for it', () => {
    const sessions = [
      offering('ABC123-S', 's', 0),
      offering('ABC123-S-R', 'sr', 1),
      offering('ABC123-S-R1', 'sr1', 2),
      offering('ABC123-R', 'r', 3),
      offering('ABC123-R1', 'r1', 4),
    ];
    const forBase = findRebookingOptions('ABC123', sessions, [], testContext());
    expect(forBase.options.map((o) => o.sessionId)).toEqual(['r', 'r1']);
    const forS = findRebookingOptions('ABC123-S', sessions, [], testContext(), 's');
    expect(forS.options.map((o) => o.sessionId)).toEqual(['sr', 'sr1']);
    const forSRepeat = findRebookingOptions('ABC123-S-R1', sessions, [], testContext(), 'sr1');
    // The plain -S session is the original, not a repeat, so only its sibling repeat is offered.
    expect(forSRepeat.options.map((o) => o.sessionId)).toEqual(['sr']);
  });

  // Feature: itinerary-rules, Property 12: Every rebooking option matches the base code and starts after now
  test('Property 12: every member of a sibling-only group is offered for any other member', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z]{3}[0-9]{3}$/),
        fc.subarray([...SUFFIXES], { minLength: 2 }),
        fc.boolean(),
        fc.nat(),
        (base, suffixes, lower, pick) => {
          const spell = (code: string) => (lower ? code.toLowerCase() : code);
          const members = suffixes.map((suffix, i) =>
            offering(spell(`${base}${suffix}`), `m${i}`, i),
          );
          const flagged = members[pick % members.length];
          // A distractor with a different base code, and an -S session of the same base.
          const distractors = [
            offering(`${base}9-R1`, 'x1', 6),
            offering(spell(`${base}-S`), 'x2', 7),
            offering(spell(`${base}-S-R1`), 'x3', 8),
          ];
          const result = findRebookingOptions(
            flagged.code,
            [...members, ...distractors],
            [],
            testContext(),
            flagged.sessionId,
          );
          const expected = members
            .filter((m) => m.sessionId !== flagged.sessionId)
            .map((m) => m.sessionId);
          expect(result.options.map((o) => o.sessionId).sort()).toEqual(expected.sort());
          expect(result.options.every((o) => o.kind === 'repeat')).toBe(true);
          expect(result.options.some((o) => o.sessionId.startsWith('x'))).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  test('Property 12: an -S code is never offered under its base code, only under its own', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z]{3}[0-9]{3}$/),
        fc.subarray(['', '-R', '-R1', '-R2'], { minLength: 1 }),
        fc.subarray(['', '-R', '-R1'], { minLength: 1 }),
        (base, plainSuffixes, sSuffixes) => {
          const plain = plainSuffixes.map((s, i) => offering(`${base}${s}`, `p${i}`, i));
          const dashS = sSuffixes.map((s, i) => offering(`${base}-S${s}`, `s${i}`, i + 5));
          const all = [...plain, ...dashS];
          const forBase = findRebookingOptions(base, all, all, testContext());
          expect(forBase.options.every((o) => o.sessionId.startsWith('p'))).toBe(true);
          const forS = findRebookingOptions(`${base}-S`, all, all, testContext());
          expect(forS.options.every((o) => o.sessionId.startsWith('s'))).toBe(true);
          expect(forS.options).toHaveLength(dashS.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('swap between sibling repeats and -S codes', () => {
  const swap = (originalSession: NormalisedSession, repeat: NormalisedSession) =>
    planSafeSwap(
      reserved(originalSession),
      repeat,
      scheduleOf([originalSession, repeat]),
      testContext(),
    );

  test('a held -R2 can swap to -R4 when there is no unsuffixed original', () => {
    const result = swap(offering('ABC123-R2', 'a', 0), offering('ABC123-R4', 'b', 3));
    expect(result.outcome).toBe('safe');
  });

  test('an -S session cannot swap to the base code, or the other way round', () => {
    const notRepeat =
      'The repeat is not another offering of the original session. The swap cannot be checked. The original stays unchanged.';
    const forward = swap(offering('ABC123-S', 'a', 0), offering('ABC123-R1', 'b', 3));
    expect(forward).toMatchObject({ outcome: 'unknown', reason: notRepeat });
    expect(forward.steps[2].blockedUntilConfirmed).toBe(true);
    expect(swap(offering('ABC123-R1', 'a', 0), offering('ABC123-S', 'b', 3)).outcome).toBe(
      'unknown',
    );
    expect(swap(offering('ABC123-S-R', 'a', 0), offering('ABC123-S-R1', 'b', 3)).outcome).toBe(
      'safe',
    );
  });

  test('a swap to the very same session, or between different base codes, is unknown', () => {
    const one = offering('ABC123-R', 'a', 0);
    expect(swap(one, one).outcome).toBe('unknown');
    expect(swap(offering('ABC123-R', 'a', 0), offering('XYZ999-R', 'b', 3)).outcome).toBe(
      'unknown',
    );
  });

  test('a known clash or a repeat that is not held is still reported first, even when unrelated', () => {
    const original = offering('ABC123-R', 'a', 0);
    const unrelated = offering('XYZ999-R', 'b', 3);
    const clasher = offering('OTH1-R', 'c', 3);
    const clash = planSafeSwap(
      reserved(original),
      unrelated,
      scheduleOf([original, unrelated, clasher]),
      testContext(),
    );
    expect(clash.outcome).toBe('unsafe');
    const notHeld = planSafeSwap(
      reserved(original),
      unrelated,
      scheduleOf([original]),
      testContext(),
    );
    expect(notHeld.outcome).toBe('failed');
  });

  test('nothing to compare is not a refusal: a personal time or an unknown session', () => {
    const repeat = offering('ABC123-R', 'b', 3);
    const original = offering('ABC123-R1', 'a', 0);
    const noLookup = planSafeSwap(
      reserved(original),
      repeat,
      { commitments: [reserved(original), reserved(repeat)], sessions: { b: repeat } },
      testContext(),
    );
    // The original's session is not in the lookup, so there is no code to compare: no refusal.
    // Its own times are used, so the swap is judged on those.
    expect(noLookup.outcome).toBe('safe');
    expect(noLookup.reason).not.toContain('not another offering');
    const noCode = offering('', 'c', 0);
    expect(swap(noCode, repeat).reason).not.toContain('not another offering');
  });

  // Feature: itinerary-rules, Property 13: Safe swap produces the three gated steps and an outcome that matches clash and confirmation state
  test('Property 13: any two different members of a sibling-only group can be swapped safely', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z]{3}[0-9]{3}$/),
        fc.subarray([...SUFFIXES], { minLength: 2, maxLength: 2 }),
        fc.boolean(),
        (base, [first, second], lower) => {
          const spell = (code: string) => (lower ? code.toLowerCase() : code);
          const a = offering(spell(`${base}${first}`), 'a', 0);
          const b = offering(spell(`${base}${second}`), 'b', 3);
          expect(swap(a, b).outcome).toBe('safe');
          // The same two with an -S marker on one side are different sessions.
          const s = offering(spell(`${base}-S${second}`), 'b', 3);
          expect(swap(a, s).outcome).toBe('unknown');
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('missing seat availability is unknown, never available', () => {
  const noSeat = (overrides: Partial<NormalisedSession> = {}) => {
    const s = offering('ABC123-R1', 'a', 0, overrides);
    delete (s as { seatAvailability?: string }).seatAvailability;
    return s;
  };

  test('isSeatUnknown: missing, unknown and unrecognised bands count; known bands and no-reservation do not', () => {
    expect(isSeatUnknown(noSeat())).toBe(true);
    expect(isSeatUnknown(offering('A-R', 'a', 0, { seatAvailability: 'unknown' }))).toBe(true);
    for (const band of ['available', 'limited', 'veryLimited', 'unavailable', 'walkUp'] as const) {
      expect(isSeatUnknown(offering('A-R', 'a', 0, { seatAvailability: band })), band).toBe(false);
    }
    expect(isSeatUnknown(noSeat({ isReservable: false }))).toBe(false);
    expect(isSeatUnknown(noSeat({ missingFields: ['isReservable'] }))).toBe(true);
    const odd = offering('A-R', 'a', 0);
    (odd as unknown as { seatAvailability: unknown }).seatAvailability = 42;
    expect(isSeatUnknown(odd)).toBe(true);
  });

  test('a reservable candidate with no seat availability gets a warn, not an allow, and no crash', () => {
    for (const candidate of [
      noSeat(),
      offering('ABC123-R1', 'a', 0, { seatAvailability: 'unknown' }),
    ]) {
      const verdict = checkReservation(candidate, scheduleOf([]), testContext());
      expect(VerdictSchema.safeParse(verdict).success).toBe(true);
      expect(verdict).toEqual({
        decision: 'warn',
        reasons: [
          'The seat check could not be judged because data was missing. The seat availability of "ABC123-R1" is unknown. Do not count on a seat.',
        ],
      });
    }
  });

  test('a session that needs no reservation has no seat availability, and that is fine', () => {
    const verdict = checkReservation(
      noSeat({ isReservable: false }),
      scheduleOf([]),
      testContext(),
    );
    expect(verdict).toEqual({ decision: 'allow', reasons: [] });
  });

  test('a known band raises no seat reason, and a full session still warns as full', () => {
    const ok = checkReservation(
      offering('ABC123-R1', 'a', 0, { seatAvailability: 'limited' }),
      scheduleOf([]),
      testContext(),
    );
    expect(ok).toEqual({ decision: 'allow', reasons: [] });
    const full = checkReservation(
      offering('ABC123-R1', 'a', 0, { seatAvailability: 'unavailable' }),
      scheduleOf([]),
      testContext(),
    );
    expect(full.reasons).toEqual([
      '"ABC123-R1" has no seats left. You would have to join the walk-up line.',
    ]);
  });

  test('rebooking never treats a missing seat availability as available or as full', () => {
    const repeat = noSeat({ sessionId: 'r', code: 'ABC123-R2' });
    const result = findRebookingOptions('ABC123', [repeat], [], testContext());
    expect(result.options.map((o) => o.kind)).toEqual(['repeat']);
    const plain = noSeat({ sessionId: 'p', code: 'ABC123' });
    // Not full and not known to need no reservation, so it is not a walk-up option either.
    expect(findRebookingOptions('ABC123', [plain], [], testContext()).options).toEqual([]);
    const nonReservable = noSeat({ sessionId: 'n', code: 'ABC123', isReservable: false });
    expect(
      findRebookingOptions('ABC123', [nonReservable], [], testContext()).options[0],
    ).toMatchObject({
      kind: 'walkUp',
    });
  });
});
