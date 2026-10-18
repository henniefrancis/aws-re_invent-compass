import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { boardingFor } from '../../src/rules/boarding.js';
import { classifyConnection } from '../../src/rules/connections.js';
import type { ResolvedCommitment } from '../../src/rules/resolve.js';
import { testContext, testVenueData } from './helpers.js';

// Tests for connection classification (itinerary-rules, S2).
// Requirements: 2.1 to 2.10, 9.8, 9.9. All sample data is self-made.

const FROM_END = Date.parse('2026-12-01T18:00:00Z'); // 10:00 Pacific
const iso = (ms: number): string => new Date(ms).toISOString();

function item(overrides: Partial<ResolvedCommitment> = {}): ResolvedCommitment {
  return {
    ref: 'ITEM',
    venue: 'Alpha Hall',
    startsAt: iso(FROM_END - 3_600_000),
    endsAt: iso(FROM_END),
    isAllDay: false,
    isReservable: true,
    missing: [],
    ...overrides,
  };
}

function classify(from: ResolvedCommitment, to: ResolvedCommitment, context = testContext()) {
  const toBoarding = boardingFor({ isReservable: to.isReservable, startsAt: to.startsAt }, context);
  return classifyConnection(from, to, toBoarding, context);
}

/** A next commitment that starts the given number of minutes after the previous one ends. */
function next(gapMinutes: number, overrides: Partial<ResolvedCommitment> = {}) {
  const start = FROM_END + gapMinutes * 60_000;
  return item({
    ref: 'NEXT',
    venue: 'Beta Tower',
    startsAt: iso(start),
    endsAt: iso(start + 3_600_000),
    ...overrides,
  });
}

describe('connection examples', () => {
  // Walk is 10 minutes plus a 10 minute buffer. Boarding closes 10 minutes before start.
  test('comfortable: plenty of time to spare', () => {
    const result = classify(item({ ref: 'FROM' }), next(60));
    expect(result).toEqual({
      classification: 'comfortable',
      walkingMinutes: 20,
      spareMinutes: 30,
      estimate: true,
      reason:
        'The walk from "Alpha Hall" to "Beta Tower" is 20 minutes, an estimate. It includes time to leave and enter buildings. No extra buffer is added, so you need 20 minutes. You arrive 30 minutes before it is due.',
    });
  });

  test('tight: less than the tight margin to spare', () => {
    const result = classify(item(), next(33));
    expect(result.classification).toBe('tight');
    expect(result.spareMinutes).toBe(3);
    expect(result.reason).toBe(
      'The walk from "Alpha Hall" to "Beta Tower" is 20 minutes, an estimate. It includes time to leave and enter buildings. No extra buffer is added, so you need 20 minutes. That leaves only 3 minutes to spare.',
    );
  });

  test('comfortable at exactly the tight margin, tight just under it', () => {
    expect(classify(item(), next(35)).classification).toBe('comfortable');
    expect(classify(item(), next(34)).classification).toBe('tight');
    expect(classify(item(), next(30)).classification).toBe('tight');
  });

  test('impossible: the attendee arrives after boarding closes', () => {
    const result = classify(item(), next(25));
    expect(result.classification).toBe('impossible');
    expect(result.spareMinutes).toBe(-5);
    expect(result.reason).toBe(
      'The walk from "Alpha Hall" to "Beta Tower" is 20 minutes, an estimate. It includes time to leave and enter buildings. No extra buffer is added, so you need 20 minutes. You would arrive 5 minutes late.',
    );
  });

  test('a non-reservable next item is judged against its start time', () => {
    const result = classify(item(), next(25, { isReservable: false }));
    expect(result).toMatchObject({ classification: 'comfortable', spareMinutes: 5 });
    expect(classify(item(), next(19, { isReservable: false })).classification).toBe('impossible');
    expect(classify(item(), next(20, { isReservable: false })).classification).toBe('tight');
    expect(classify(item(), next(25, { isReservable: false })).classification).toBe('comfortable');
  });

  test('the same venue is a 5 minute room-to-room estimate, never zero', () => {
    const result = classify(item(), next(60, { venue: 'alpha hall' }));
    expect(result).toMatchObject({
      classification: 'comfortable',
      walkingMinutes: 5,
      estimate: true,
    });
    expect(result.reason).toContain('an estimate');
  });

  test('an official walking time is not labelled an estimate', () => {
    const venueData = testVenueData();
    venueData.walkingTimes[0] = {
      from: 'Alpha Hall',
      to: 'Beta Tower',
      minutes: 10,
      source: { kind: 'official', url: 'https://aws.amazon.com/events/reinvent/' },
    };
    const result = classify(item(), next(60), testContext({ venueData }));
    expect(result.reason).not.toContain('estimate');
  });

  test('uses the buffer and tight margin from the context', () => {
    const context = testContext({ bufferMinutes: 0, tightMarginMinutes: 0 });
    // Walk 20, due at gap minus 10: a gap of 30 leaves exactly 0 spare, which is not tight.
    expect(classify(item(), next(30), context)).toMatchObject({
      classification: 'comfortable',
      spareMinutes: 0,
      walkingMinutes: 20,
    });
  });

  test('stays exact when the clocks change between the two commitments', () => {
    // The first ends 01:30 PST on 2026-03-08, the next starts 03:45 PDT, a real gap of 75 minutes.
    const from = item({ endsAt: '2026-03-08T01:30:00-08:00' });
    const to = next(0, { startsAt: '2026-03-08T03:45:00-07:00' });
    const result = classify(from, to);
    // Boarding closes 03:35 PDT (10:35Z). Arrival is 20 real minutes after 09:30Z. So 45 spare.
    expect(result).toMatchObject({ classification: 'comfortable', spareMinutes: 45 });
  });
});

describe('connection unknowns', () => {
  test('a missing venue names the commitment whose venue is missing', () => {
    const noFrom = classify(item({ ref: 'FROMREF', venue: undefined }), next(60));
    expect(noFrom.classification).toBe('unknown');
    expect(noFrom.reason).toContain('FROMREF');
    const noTo = classify(item(), next(60, { ref: 'TOREF', venue: undefined }));
    expect(noTo.classification).toBe('unknown');
    expect(noTo.reason).toContain('TOREF');
  });

  test('a venue absent from the list is named', () => {
    const from = classify(item({ venue: 'Ghost Hall' }), next(60));
    expect(from.reason).toContain('Ghost Hall');
    const to = classify(item(), next(60, { venue: 'Phantom Tower' }));
    expect(to.reason).toContain('Phantom Tower');
  });

  test('an ordered pair with no matrix value is unknown', () => {
    const venueData = testVenueData();
    venueData.walkingTimes = venueData.walkingTimes.slice(1);
    const result = classify(item(), next(60), testContext({ venueData }));
    expect(result.classification).toBe('unknown');
    expect(result.reason).toContain('No walking time is listed from "Alpha Hall" to "Beta Tower"');
  });

  test('a missing end time on the first item is unknown and names it', () => {
    const result = classify(item({ ref: 'FROMREF', endsAt: undefined }), next(60));
    expect(result.classification).toBe('unknown');
    expect(result.reason).toContain('end time of "FROMREF" is missing');
  });

  test('a reservable next item with no boarding is unknown and names it', () => {
    const noStart = classify(item(), next(60, { ref: 'TOREF', startsAt: undefined }));
    expect(noStart.classification).toBe('unknown');
    expect(noStart.reason).toContain('boarding time for "TOREF" is missing');
    const noFlag = classify(item(), next(60, { isReservable: undefined }));
    expect(noFlag.reason).toContain('boarding time');
  });

  test('a non-reservable next item with no start is unknown and names it', () => {
    const result = classify(
      item(),
      next(60, { ref: 'TOREF', isReservable: false, startsAt: undefined }),
    );
    expect(result.classification).toBe('unknown');
    expect(result.reason).toContain('start time of "TOREF" is missing');
  });

  test('a missing or unrecognised timezone is unknown', () => {
    const missing = classify(item(), next(60), testContext({ eventTimezone: undefined }));
    expect(missing.classification).toBe('unknown');
    expect(missing.reason).toContain('timezone is missing');
    const bad = classify(item(), next(60), testContext({ eventTimezone: 'Nope/Nowhere' }));
    expect(bad.reason).toContain('not recognised');
  });
});

describe('connection wording', () => {
  test('spare time is rounded down and lateness rounded up, so the words match the class', () => {
    // A gap of 33.7 minutes leaves 3.7 spare minutes: tight, shown as 3.
    const tight = classify(item(), next(33.7));
    expect(tight.classification).toBe('tight');
    expect(tight.reason).toContain('That leaves only 3 minutes to spare.');
    // 0.9 spare minutes is shown as 0, not rounded up to 1, and is still tight.
    const nearly = classify(item(), next(30.9));
    expect(nearly.classification).toBe('tight');
    expect(nearly.reason).toContain('only 0 minutes to spare');
    // 4.2 minutes late is shown as 5, never as 4.
    const late = classify(item(), next(25.8));
    expect(late.classification).toBe('impossible');
    expect(late.reason).toContain('You would arrive 5 minutes late.');
    // 5.7 spare minutes is comfortable, shown as 5.
    const comfy = classify(item(), next(35.7));
    expect(comfy.classification).toBe('comfortable');
    expect(comfy.reason).toContain('You arrive 5 minutes before it is due.');
  });

  test('the walk and the buffer are stated separately, and the estimate flag is carried', () => {
    // An estimate already includes the building allowance, so only the buffer above 15 counts.
    const result = classify(item(), next(60), testContext({ bufferMinutes: 25 }));
    expect(result.estimate).toBe(true);
    expect(result.walkingMinutes).toBe(30);
    expect(result.reason).toContain(
      'is 20 minutes, an estimate. It includes time to leave and enter buildings. With a 10 minute buffer, you need 30 minutes.',
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
    const official = classify(item(), next(60), testContext({ venueData, bufferMinutes: 7 }));
    expect(official.estimate).toBe(false);
    expect(official.walkingMinutes).toBe(27);
    expect(official.reason).toContain(
      'is 20 minutes. With a 7 minute buffer, you need 27 minutes.',
    );
    expect(official.reason).not.toContain('estimate');
  });
});

describe('certainly impossible connections', () => {
  const venetianToWynn = testContext({ venueData: testVenueData(40) });

  test('late even at half the estimated walk is certain', () => {
    // A 2 minute gap: boarding closes 10 minutes before start, and half the walk is 20 minutes.
    const result = classify(item(), next(2), venetianToWynn);
    expect(result).toMatchObject({ classification: 'impossible', estimate: true, certain: true });
  });

  test('late at the full estimated walk but not at half of it is not certain', () => {
    const result = classify(item(), next(35), venetianToWynn);
    expect(result).toMatchObject({ classification: 'impossible', estimate: true, certain: false });
    // The edge: half the walk (20) plus the 10 minute boarding rule is a gap of exactly 30.
    expect(classify(item(), next(30), venetianToWynn).certain).toBe(false);
    expect(classify(item(), next(29.9), venetianToWynn).certain).toBe(true);
  });

  test('an impossible connection on an official walking time is always certain', () => {
    const venueData = testVenueData(40);
    venueData.walkingTimes = venueData.walkingTimes.map((edge) => ({
      ...edge,
      source: {
        kind: 'official' as const,
        url: 'https://aws.amazon.com/events/reinvent/',
        retrievedOn: '2026-10-17',
      },
    }));
    const context = testContext({ venueData });
    expect(classify(item(), next(35), context)).toMatchObject({ estimate: false, certain: true });
  });

  test('tight, comfortable and unknown results carry no certain flag', () => {
    expect(classify(item(), next(60)).certain).toBeUndefined();
    expect(classify(item(), next(31)).certain).toBeUndefined();
    expect(classify(item({ venue: undefined }), next(60)).certain).toBeUndefined();
  });

  test('a bigger buffer on an estimate only counts above the 15 minute allowance', () => {
    const base = classify(item(), next(60), testContext({ bufferMinutes: 15 }));
    const bigger = classify(item(), next(60), testContext({ bufferMinutes: 30 }));
    expect(base.walkingMinutes).toBe(20);
    expect(bigger.walkingMinutes).toBe(35);
    expect(classify(item(), next(60), testContext({ bufferMinutes: 0 })).walkingMinutes).toBe(20);
  });

  // Feature: itinerary-rules, Property 5: Connection classification follows spare time against the due time, with walking minutes and a naming reason
  test('Property 5: an impossible connection is certain exactly when late at half the walk too', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 120 }),
        fc.integer({ min: 1, max: 90 }),
        fc.boolean(),
        fc.boolean(),
        (gap, rawWalk, official, reservable) => {
          const venueData = testVenueData(rawWalk);
          if (official) {
            venueData.walkingTimes = venueData.walkingTimes.map((edge) => ({
              ...edge,
              source: {
                kind: 'official' as const,
                url: 'https://aws.amazon.com/events/reinvent/',
                retrievedOn: '2026-10-17',
              },
            }));
          }
          const context = testContext({ venueData });
          const result = classify(item(), next(gap, { isReservable: reservable }), context);
          const total = rawWalk + (official ? 10 : 0);
          const spare = gap - (reservable ? 10 : 0) - total;
          if (spare < 0) {
            const halfSpare = gap - (reservable ? 10 : 0) - total / 2;
            expect(result.classification).toBe('impossible');
            expect(result.certain).toBe(official || halfSpare < 0);
          } else {
            expect(result.certain).toBeUndefined();
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('connection hardening', () => {
  test('a tuning value that makes the spare time infinite or NaN is unknown, never a verdict', () => {
    for (const bufferMinutes of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      const result = classify(item(), next(60), testContext({ bufferMinutes }));
      expect(result.classification).toBe('unknown');
      expect(result.reason).toBe(
        'The spare time could not be worked out. The connection is unknown.',
      );
    }
  });

  test('a first commitment whose end is not after its start is unknown and names it', () => {
    const from = item({ ref: 'BADFROM', missing: ['order'] });
    const result = classify(from, next(60));
    expect(result.classification).toBe('unknown');
    expect(result.reason).toContain('end time of "BADFROM" is not after its start time');
  });
});

describe('connection properties', () => {
  // Feature: itinerary-rules, Property 5: Connection classification follows spare time against the due time, with walking minutes and a naming reason
  test('Property 5: the class follows spare time and the reason names venues and minutes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -30, max: 150 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 20 }),
        fc.boolean(),
        fc.boolean(),
        (gap, rawWalk, buffer, margin, reservable, sameVenue) => {
          const context = testContext({
            venueData: testVenueData(rawWalk),
            bufferMinutes: buffer,
            tightMarginMinutes: margin,
          });
          const to = next(gap, {
            isReservable: reservable,
            venue: sameVenue ? 'Alpha Hall' : 'Beta Tower',
          });
          const result = classify(item(), to, context);

          // An estimate already includes the building allowance, so the buffer adds only above 15.
          const walking = (sameVenue ? 5 : rawWalk) + Math.max(0, buffer - 15);
          const due = gap - (reservable ? 10 : 0);
          const spare = due - walking;
          const expected = spare < 0 ? 'impossible' : spare < margin ? 'tight' : 'comfortable';
          expect(result.classification).toBe(expected);
          expect(result.walkingMinutes).toBe(walking);
          expect(result.spareMinutes).toBe(spare);
          expect(result.reason).toContain('Alpha Hall');
          expect(result.reason).toContain(
            sameVenue ? '"Alpha Hall" to "Alpha Hall"' : 'Beta Tower',
          );
          expect(result.reason).toContain(`${walking === 1 ? '1 minute' : `${walking} minutes`}`);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Feature: itinerary-rules, Property 6: Missing venue, matrix value, or missing boarding yields an unknown connection
  test('Property 6: missing venue, matrix value or boarding is unknown and named', () => {
    const cases: Array<[string, () => { result: ReturnType<typeof classify>; named: string }]> = [
      [
        'missing from venue',
        () => ({ result: classify(item({ ref: 'F1', venue: undefined }), next(60)), named: 'F1' }),
      ],
      [
        'missing to venue',
        () => ({
          result: classify(item(), next(60, { ref: 'T1', venue: undefined })),
          named: 'T1',
        }),
      ],
      [
        'unlisted from venue',
        () => ({ result: classify(item({ venue: 'Ghost' }), next(60)), named: 'Ghost' }),
      ],
      [
        'unlisted to venue',
        () => ({ result: classify(item(), next(60, { venue: 'Phantom' })), named: 'Phantom' }),
      ],
      [
        'no matrix value',
        () => {
          const venueData = testVenueData();
          venueData.walkingTimes = venueData.walkingTimes.filter((e) => e.from !== 'Alpha Hall');
          return {
            result: classify(item(), next(60), testContext({ venueData })),
            named: 'Beta Tower',
          };
        },
      ],
      [
        'no boarding',
        () => ({
          result: classify(item(), next(60, { ref: 'T2', startsAt: undefined })),
          named: 'T2',
        }),
      ],
    ];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: cases.length - 1 }), (which) => {
        const { result, named } = cases[which][1]();
        expect(result.classification).toBe('unknown');
        expect(result.walkingMinutes).toBeUndefined();
        expect(result.spareMinutes).toBeUndefined();
        expect(result.reason).toContain(named);
      }),
      { numRuns: 100 },
    );
  });
});
