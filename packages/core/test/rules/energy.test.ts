import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { isOverloaded, isOverloadedByCount, scoreEnergy } from '../../src/rules/energy.js';
import type { ResolvedCommitment } from '../../src/rules/resolve.js';
import { testContext, testVenueData } from './helpers.js';

// Tests for the energy budget (itinerary-rules, S2).
// Requirements: 5.1 to 5.9. All sample data is self-made.

const MIDNIGHT = Date.parse('2026-12-01T08:00:00Z'); // 00:00 Pacific
const iso = (minutes: number): string => new Date(MIDNIGHT + minutes * 60_000).toISOString();

function item(
  ref: string,
  venue: string | undefined,
  startMin: number,
  endMin: number | undefined,
  overrides: Partial<ResolvedCommitment> = {},
): ResolvedCommitment {
  return {
    ref,
    venue,
    startsAt: iso(startMin),
    endsAt: endMin === undefined ? undefined : iso(endMin),
    isAllDay: false,
    isReservable: true,
    missing: [],
    ...overrides,
  };
}

const sameVenue = (count: number): ResolvedCommitment[] =>
  Array.from({ length: count }, (_, i) => item(`ITEM${i}`, 'Alpha Hall', i * 120, i * 120 + 60));

describe('scoreEnergy examples', () => {
  test('applies the named formula and explains it', () => {
    // Alpha to Beta is 10 + 10 buffer, Beta to Beta is 0 + 10, one venue change.
    const day = [
      item('A1', 'Alpha Hall', 9 * 60, 10 * 60),
      item('B1', 'Beta Tower', 11 * 60, 12 * 60),
      item('B2', 'Beta Tower', 13 * 60, 14 * 60),
    ];
    const result = scoreEnergy(day, testContext());
    expect(result).toMatchObject({
      score: 70,
      commitmentCount: 3,
      totalWalkingMinutes: 25,
      venueChangeCount: 1,
      overloaded: false,
      missingDataNotes: [],
    });
    expect(result.explanation).toBe(
      'Energy score is 70: 3 commitments times 10, 25 walking minutes, 1 venue changes times 15. ' +
        'Formula: commitments times 10 plus walking minutes plus venue changes times 15. ' +
        'That is within the limit of 100. The walking minutes are estimates.',
    );
  });

  test('sorts the day by time before pairing commitments', () => {
    const day = [
      item('B1', 'Beta Tower', 11 * 60, 12 * 60),
      item('A1', 'Alpha Hall', 9 * 60, 10 * 60),
    ];
    expect(scoreEnergy(day, testContext())).toMatchObject({
      totalWalkingMinutes: 20,
      venueChangeCount: 1,
    });
  });

  test('a day of fewer than two commitments has no walking and no venue changes', () => {
    expect(scoreEnergy([], testContext())).toMatchObject({
      score: 0,
      commitmentCount: 0,
      totalWalkingMinutes: 0,
      venueChangeCount: 0,
    });
    expect(scoreEnergy(sameVenue(1), testContext())).toMatchObject({
      score: 10,
      totalWalkingMinutes: 0,
      venueChangeCount: 0,
    });
  });

  test('strictly greater than the threshold is overloaded, equal is not', () => {
    // Three commitments in one venue: 30 + 2 * 5 room to room (the buffer adds nothing) = 40.
    const day = sameVenue(3);
    expect(scoreEnergy(day, testContext({ overloadThreshold: 40 })).overloaded).toBe(false);
    const over = scoreEnergy(day, testContext({ overloadThreshold: 39 }));
    expect(over.overloaded).toBe(true);
    expect(over.explanation).toContain('That is above the limit of 39, so the day is overloaded.');
  });

  test('a commitment with missing data is counted, left out of the totals, and named', () => {
    const day = [
      item('A1', 'Alpha Hall', 9 * 60, 10 * 60),
      item('NOVENUE', undefined, 10 * 60 + 30, 11 * 60, { missing: ['venue'] }),
      item('NOEND', 'Beta Tower', 12 * 60, undefined, { missing: ['endsAt'] }),
      item('NOSTART', 'Beta Tower', 0, 60, { startsAt: undefined, missing: ['startsAt'] }),
      item('G1', 'Gamma Plaza', 14 * 60, 15 * 60),
    ];
    const result = scoreEnergy(day, testContext());
    expect(result).toMatchObject({
      commitmentCount: 5,
      totalWalkingMinutes: 20,
      venueChangeCount: 1,
      score: 5 * 10 + 20 + 15,
    });
    expect(result.missingDataNotes).toEqual([
      'Data was missing for "NOVENUE". It is left out of walking and venue totals.',
      'Data was missing for "NOEND". It is left out of walking and venue totals.',
      'Data was missing for "NOSTART". It is left out of walking and venue totals.',
    ]);
    for (const note of result.missingDataNotes) {
      expect(result.explanation).toContain(note);
    }
  });

  test('all-day items are counted but not sequenced, and only noted when incomplete', () => {
    const expo = item('EXPO', 'Alpha Hall', 9 * 60, undefined, { isAllDay: true });
    const day = [expo, item('B1', 'Beta Tower', 11 * 60, 12 * 60)];
    const result = scoreEnergy(day, testContext());
    expect(result).toMatchObject({
      commitmentCount: 2,
      totalWalkingMinutes: 0,
      venueChangeCount: 0,
    });
    expect(result.missingDataNotes).toEqual([]);
    const noVenue = item('EXPO', undefined, 9 * 60, undefined, {
      isAllDay: true,
      missing: ['venue'],
    });
    expect(scoreEnergy([noVenue], testContext()).missingDataNotes).toHaveLength(1);
  });

  test('a commitment whose end is not after its start is counted but left out, and named', () => {
    const day = [
      item('A1', 'Alpha Hall', 9 * 60, 10 * 60),
      item('BAD', 'Beta Tower', 11 * 60, 11 * 60, { missing: ['order'] }),
    ];
    const result = scoreEnergy(day, testContext());
    expect(result).toMatchObject({
      commitmentCount: 2,
      totalWalkingMinutes: 0,
      venueChangeCount: 0,
    });
    expect(result.missingDataNotes).toEqual([
      'Data was missing for "BAD". It is left out of walking and venue totals.',
    ]);
  });

  test('stay-put personal time is counted but neither sequenced nor noted as missing data', () => {
    const day = [
      item('A1', 'Alpha Hall', 9 * 60, 10 * 60),
      item('REST', undefined, 10 * 60, 11 * 60, { stayPut: true }),
      item('B1', 'Beta Tower', 12 * 60, 13 * 60),
    ];
    const result = scoreEnergy(day, testContext());
    expect(result).toMatchObject({
      commitmentCount: 3,
      totalWalkingMinutes: 20,
      venueChangeCount: 1,
      missingDataNotes: [],
    });
  });

  test('a walk with no known time adds no minutes and is named', () => {
    const day = [
      item('A1', 'Alpha Hall', 9 * 60, 10 * 60),
      item('X1', 'Ghost Hall', 11 * 60, 12 * 60),
    ];
    const result = scoreEnergy(day, testContext());
    expect(result).toMatchObject({ totalWalkingMinutes: 0, venueChangeCount: 1 });
    expect(result.missingDataNotes).toEqual([
      'The walk from "Alpha Hall" to "Ghost Hall" is unknown and is left out.',
    ]);
  });

  test('says the walking minutes are estimates only when an estimated walk was used', () => {
    const day = [
      item('A1', 'Alpha Hall', 9 * 60, 10 * 60),
      item('B1', 'Beta Tower', 11 * 60, 12 * 60),
    ];
    expect(scoreEnergy(day, testContext()).explanation).toContain(
      'The walking minutes are estimates.',
    );
    const venueData = testVenueData();
    venueData.walkingTimes = venueData.walkingTimes.map((edge) => ({
      ...edge,
      source: {
        kind: 'official' as const,
        url: 'https://aws.amazon.com/events/reinvent/',
        retrievedOn: '2026-10-17',
      },
    }));
    expect(scoreEnergy(day, testContext({ venueData })).explanation).not.toContain('estimates');
    // Within one venue the walk is a room-to-room estimate, even when the matrix is official.
    const same = [
      item('A1', 'Alpha Hall', 9 * 60, 10 * 60),
      item('A2', 'Alpha Hall', 11 * 60, 12 * 60),
    ];
    expect(scoreEnergy(same, testContext({ venueData })).explanation).toContain('estimates');
    expect(scoreEnergy(same, testContext({ venueData })).totalWalkingMinutes).toBe(5);
  });

  test('uses the buffer and threshold from the context', () => {
    const day = [
      item('A1', 'Alpha Hall', 9 * 60, 10 * 60),
      item('B1', 'Beta Tower', 11 * 60, 12 * 60),
    ];
    const context = testContext({ venueData: testVenueData(30), bufferMinutes: 5 });
    expect(scoreEnergy(day, context)).toMatchObject({
      totalWalkingMinutes: 30,
      score: 20 + 30 + 15,
    });
  });

  test('stays right across a daylight saving change', () => {
    // Two commitments either side of the 2026-03-08 clock change keep the same walking time.
    const day = [
      {
        ...item('A1', 'Alpha Hall', 0, 0),
        startsAt: '2026-03-08T01:00:00-08:00',
        endsAt: '2026-03-08T01:30:00-08:00',
      },
      {
        ...item('B1', 'Beta Tower', 0, 0),
        startsAt: '2026-03-08T03:30:00-07:00',
        endsAt: '2026-03-08T04:00:00-07:00',
      },
    ];
    expect(scoreEnergy(day, testContext())).toMatchObject({
      totalWalkingMinutes: 20,
      venueChangeCount: 1,
    });
  });
});

describe('isOverloaded and the count-only fallback', () => {
  test('isOverloaded follows the full formula and its threshold', () => {
    const day = sameVenue(3);
    expect(isOverloaded(day, testContext({ overloadThreshold: 40 })).overloaded).toBe(false);
    const over = isOverloaded(day, testContext({ overloadThreshold: 39 }));
    expect(over.overloaded).toBe(true);
    expect(over.explanation).toContain('Energy score is 40');
  });

  test('the default count threshold is 6: seven commitments are overloaded, six are not', () => {
    expect(isOverloadedByCount(sameVenue(7), testContext())).toEqual({
      overloaded: true,
      explanation: '7 commitments is more than the limit of 6.',
    });
    expect(isOverloadedByCount(sameVenue(6), testContext())).toEqual({
      overloaded: false,
      explanation: '6 commitments is within the limit of 6.',
    });
    expect(isOverloadedByCount([], testContext()).overloaded).toBe(false);
  });
});

describe('energy properties', () => {
  const venueArb = fc.constantFrom<string | undefined>(
    'Alpha Hall',
    'Beta Tower',
    'Gamma Plaza',
    'Ghost Hall',
    undefined,
  );
  const itemArb = fc.record({
    venue: venueArb,
    start: fc.integer({ min: 0, max: 1300 }),
    length: fc.integer({ min: 1, max: 100 }),
    noEnd: fc.boolean(),
    allDay: fc.boolean(),
  });

  // Feature: itinerary-rules, Property 11: Energy budget formula, overload threshold and count-only fallback, and explanation
  test('Property 11: the score follows the formula, with thresholds and explanation', () => {
    fc.assert(
      fc.property(
        fc.array(itemArb, { maxLength: 8 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 10 }),
        (raw, threshold, buffer, countThreshold) => {
          const day = raw.map((r, i) =>
            item(`ITEM${i}`, r.venue, r.start, r.noEnd ? undefined : r.start + r.length, {
              isAllDay: r.allDay,
            }),
          );
          const context = testContext({
            overloadThreshold: threshold,
            bufferMinutes: buffer,
            overloadCountThreshold: countThreshold,
          });
          const result = scoreEnergy(day, context);

          // An independent calculation of the same formula.
          const placeable = (r: (typeof raw)[number]) =>
            r.venue !== undefined && (r.allDay || !r.noEnd);
          const sequence = raw
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => placeable(r) && !r.allDay)
            .sort((a, b) => a.r.start - b.r.start);
          const listed = new Set(['Alpha Hall', 'Beta Tower', 'Gamma Plaza']);
          let walking = 0;
          let changes = 0;
          for (let k = 1; k < sequence.length; k += 1) {
            const a = sequence[k - 1].r.venue!;
            const b = sequence[k].r.venue!;
            if (a !== b) changes += 1;
            if (listed.has(a) && listed.has(b))
              walking += (a === b ? 5 : 20) + Math.max(0, buffer - 15);
          }
          const expected = raw.length * 10 + walking + changes * 15;
          expect(result.commitmentCount).toBe(raw.length);
          expect(result.totalWalkingMinutes).toBe(walking);
          expect(result.venueChangeCount).toBe(changes);
          expect(result.score).toBe(expected);
          // Strictly greater than the threshold is overloaded.
          expect(result.overloaded).toBe(expected > threshold);
          expect(isOverloaded(day, context).overloaded).toBe(expected > threshold);
          // The explanation names the inputs, the formula and every commitment with missing data.
          expect(result.explanation).toContain(`Energy score is ${expected}`);
          expect(result.explanation).toContain(`${raw.length} commitments times 10`);
          expect(result.explanation).toContain(`${walking} walking minutes`);
          expect(result.explanation).toContain(`${changes} venue changes times 15`);
          expect(result.explanation).toContain(
            'Formula: commitments times 10 plus walking minutes',
          );
          raw.forEach((r, i) => {
            if (!placeable(r)) {
              expect(result.explanation).toContain(`Data was missing for "ITEM${i}".`);
            }
          });
          // The count-only fallback flags exactly when the count is strictly over its threshold.
          expect(isOverloadedByCount(day, context).overloaded).toBe(raw.length > countThreshold);
        },
      ),
      { numRuns: 300 },
    );
  });
});
