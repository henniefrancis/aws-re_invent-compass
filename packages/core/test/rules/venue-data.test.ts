import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import type { VenueData } from '../../src/rules/context.js';
import {
  OFFICIAL_HOSTS,
  SAME_VENUE_WALK_MINUTES,
  VenueDataSchema,
  lookupWalk,
  normaliseName,
  validateVenueData,
} from '../../src/rules/venue-data.js';

// Tests for venue data validation and lookup (itinerary-rules, S2).
// Requirements: 9.1 to 9.9. All sample data is self-made, except the smoke test that
// reads the owned data/venues.json file itself.

const OFFICIAL = {
  kind: 'official',
  url: 'https://aws.amazon.com/events/reinvent/faqs/',
  retrievedOn: '2026-10-17',
} as const;
const ESTIMATE = { kind: 'estimate' } as const;

/** A small, valid, complete venue data object with three venues. */
function sampleData(): VenueData {
  const names = ['Alpha Hall', 'Beta Tower', 'Gamma Plaza'];
  return {
    venues: names.map((name) => ({ venue: { name }, nameSource: OFFICIAL })),
    walkingTimes: names.flatMap((from) =>
      names.filter((to) => to !== from).map((to) => ({ from, to, minutes: 10, source: ESTIMATE })),
    ),
  };
}

function errorsOf(input: unknown): string[] {
  const result = validateVenueData(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe('data/venues.json', () => {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../../../../data/venues.json', import.meta.url), 'utf8'),
  );

  test('is a wrapper object, not a bare Venue array, and validates against the schema', () => {
    expect(Array.isArray(raw)).toBe(false);
    const result = validateVenueData(raw);
    expect(result).toMatchObject({ ok: true });
  });

  test('holds only the six venues named on the official re:Invent pages', () => {
    const data = VenueDataSchema.parse(raw);
    expect(data.venues.map((entry) => entry.venue.name)).toEqual([
      'Caesars Forum',
      'Caesars Palace',
      'Encore',
      'MGM Grand',
      'The Venetian',
      'Wynn',
    ]);
    for (const entry of data.venues) {
      expect(entry.venue.name.trim()).not.toBe('');
      expect(entry.nameSource?.kind).toBe('official');
    }
  });

  test('covers every ordered pair with whole minutes from 1 to 240 and a source note', () => {
    const data = VenueDataSchema.parse(raw);
    expect(data.walkingTimes).toHaveLength(data.venues.length * (data.venues.length - 1));
    for (const edge of data.walkingTimes) {
      expect(Number.isInteger(edge.minutes)).toBe(true);
      expect(edge.minutes).toBeGreaterThanOrEqual(1);
      expect(edge.minutes).toBeLessThanOrEqual(240);
      expect(['official', 'estimate']).toContain(edge.source.kind);
      if (edge.source.kind === 'official') {
        expect(OFFICIAL_HOSTS).toContain(new URL(edge.source.url).hostname);
      }
    }
  });

  test('keeps coordinates in range and sourced, and marks unsourced values as estimates', () => {
    const data = VenueDataSchema.parse(raw);
    for (const entry of data.venues) {
      if (entry.venue.coordinates) {
        expect(Math.abs(entry.venue.coordinates.lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(entry.venue.coordinates.lon)).toBeLessThanOrEqual(180);
        expect(entry.coordinatesSource).toBeDefined();
      }
    }
    // No per-pair walking time is published officially, so each one is an estimate.
    expect(data.walkingTimes.every((edge) => edge.source.kind === 'estimate')).toBe(true);
  });
});

describe('VenueDataSchema rules', () => {
  test('accepts valid data, including an official note and sourced coordinates', () => {
    const data = sampleData();
    data.venues[0] = {
      venue: { name: 'Alpha Hall', coordinates: { lat: 36.1, lon: -115.1 } },
      coordinatesSource: { kind: 'estimate', basis: 'Made up for a test.' },
    };
    data.walkingTimes[0] = {
      from: 'Alpha Hall',
      to: 'Beta Tower',
      minutes: 1,
      source: {
        kind: 'official',
        url: 'https://reinvent.awsevents.com/venues',
        retrievedOn: '2026-10-17',
      },
    };
    expect(validateVenueData(data)).toEqual({ ok: true, data });
  });

  test('rejects a bare array and other non-wrappers', () => {
    expect(errorsOf([]).length).toBeGreaterThan(0);
    expect(errorsOf({ venues: [] }).length).toBeGreaterThan(0);
  });

  test('rejects official notes with a missing URL or a URL on another host or scheme', () => {
    for (const url of [
      'not a url',
      'https://example.com/page',
      'http://aws.amazon.com/page',
      'https://evil.aws.amazon.com.example.com/',
      // Right host, but not an allowlisted path, or a port or user info trick.
      'https://aws.amazon.com/some/other/page',
      'https://aws.amazon.com/events/reinventor',
      'https://aws.amazon.com:8443/events/reinvent/faqs/',
      'https://reinvent.awsevents.com:8080/venues',
      'https://reinvent.awsevents.com@evil.example.com/venues',
    ]) {
      const data = sampleData();
      data.walkingTimes[0] = {
        ...data.walkingTimes[0],
        source: { kind: 'official', url, retrievedOn: '2026-10-17' },
      };
      expect(errorsOf(data).join(' ')).toContain('walkingTimes[0].source');
    }
    const data = sampleData() as unknown as { walkingTimes: Array<{ source: unknown }> };
    data.walkingTimes[0].source = { kind: 'official' };
    expect(errorsOf(data).join(' ')).toContain('walkingTimes[0].source');
  });

  test('accepts official URLs on allowlisted paths, with or without a path, query or fragment', () => {
    for (const url of [
      'https://aws.amazon.com/events/reinvent',
      'https://aws.amazon.com/events/reinvent/faqs/?a=1#top',
      'https://AWS.amazon.com/resources/analyst-summit/',
      'https://reinvent.awsevents.com',
      'https://reinvent.awsevents.com/anything/at/all',
    ]) {
      const data = sampleData();
      data.walkingTimes[0] = {
        ...data.walkingTimes[0],
        source: { kind: 'official', url, retrievedOn: '2026-10-17' },
      };
      expect(validateVenueData(data).ok, url).toBe(true);
    }
  });

  test('an official note needs a real retrieval date between 2000 and 2100', () => {
    for (const retrievedOn of [
      '',
      'yesterday',
      '2026-02-31',
      '2026-13-01',
      '1999-12-31',
      '2101-01-01',
    ]) {
      const data = sampleData();
      data.walkingTimes[0] = {
        ...data.walkingTimes[0],
        source: { kind: 'official', url: 'https://aws.amazon.com/events/reinvent/', retrievedOn },
      };
      expect(errorsOf(data).join(' '), retrievedOn).toContain('walkingTimes[0].source.retrievedOn');
    }
    const missing = sampleData() as unknown as { walkingTimes: Array<{ source: unknown }> };
    missing.walkingTimes[0].source = {
      kind: 'official',
      url: 'https://aws.amazon.com/events/reinvent/',
    };
    expect(errorsOf(missing).join(' ')).toContain('retrievedOn');
  });

  test('rejects walking times that are fractional, below 1 minute or above 240', () => {
    for (const minutes of [1.5, -1, 0, 241]) {
      const data = sampleData();
      data.walkingTimes[2] = { ...data.walkingTimes[2], minutes };
      expect(errorsOf(data).join(' ')).toContain('walkingTimes[2].minutes');
    }
  });

  test('rejects a walking time between a venue and itself', () => {
    const data = sampleData();
    data.walkingTimes.push({
      from: 'Alpha Hall',
      to: ' alpha hall ',
      minutes: 1,
      source: ESTIMATE,
    });
    expect(errorsOf(data).join(' ')).toContain('distinct venues');
  });

  test('rejects unlisted venues, duplicate venues and duplicate or missing pairs', () => {
    const unlisted = sampleData();
    unlisted.walkingTimes[0] = { ...unlisted.walkingTimes[0], from: 'Nowhere', to: 'Elsewhere' };
    const unlistedErrors = errorsOf(unlisted).join(' ');
    expect(unlistedErrors).toContain('walkingTimes[0].from');
    expect(unlistedErrors).toContain('walkingTimes[0].to');

    const duplicateVenue = sampleData();
    duplicateVenue.venues.push({ venue: { name: ' ALPHA HALL' } });
    expect(errorsOf(duplicateVenue).join(' ')).toContain(
      'venues[3].venue.name: the venue is listed twice',
    );

    const duplicatePair = sampleData();
    duplicatePair.walkingTimes.push({ ...duplicatePair.walkingTimes[0] });
    expect(errorsOf(duplicatePair).join(' ')).toContain('the ordered pair is listed twice');

    const missingPair = sampleData();
    missingPair.walkingTimes.pop();
    expect(errorsOf(missingPair).join(' ')).toContain('there is no walking time from');
  });

  // Feature: itinerary-rules, Property 15: Invalid venue entries are rejected with a naming reason
  test('Property 15: an invalid venue entry is rejected and the error names the entry and why', () => {
    const corruptions: Array<[string, (entry: Record<string, unknown>) => void, string]> = [
      ['empty name', (e) => (e.venue = { name: '' }), 'the name is empty'],
      ['blank name', (e) => (e.venue = { name: '   ' }), 'the name is empty'],
      ['missing name', (e) => (e.venue = {}), 'venue.name'],
      ['non-text name', (e) => (e.venue = { name: 42 }), 'venue.name'],
      [
        'latitude too high',
        (e) => {
          e.venue = { name: 'X', coordinates: { lat: 91, lon: 0 } };
          e.coordinatesSource = ESTIMATE;
        },
        'the latitude must be from -90 to 90',
      ],
      [
        'latitude too low',
        (e) => {
          e.venue = { name: 'X', coordinates: { lat: -91, lon: 0 } };
          e.coordinatesSource = ESTIMATE;
        },
        'the latitude must be from -90 to 90',
      ],
      [
        'longitude too high',
        (e) => {
          e.venue = { name: 'X', coordinates: { lat: 0, lon: 181 } };
          e.coordinatesSource = ESTIMATE;
        },
        'the longitude must be from -180 to 180',
      ],
      [
        'longitude too low',
        (e) => {
          e.venue = { name: 'X', coordinates: { lat: 0, lon: -181 } };
          e.coordinatesSource = ESTIMATE;
        },
        'the longitude must be from -180 to 180',
      ],
      [
        'coordinates without a source',
        (e) => {
          e.venue = { name: 'X', coordinates: { lat: 1, lon: 1 } };
          delete e.coordinatesSource;
        },
        'coordinates need a source note',
      ],
    ];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: corruptions.length - 1 }),
        (index, which) => {
          const data = structuredClone(sampleData()) as unknown as {
            venues: Array<Record<string, unknown>>;
          };
          const [, corrupt, expected] = corruptions[which];
          corrupt(data.venues[index]);
          const errors = errorsOf(data);
          expect(errors.some((e) => e.startsWith(`venues[${index}]`) && e.includes(expected))).toBe(
            true,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('lookupWalk', () => {
  const data = sampleData();

  test('matches names after trimming and lowercasing, by exact name only', () => {
    expect(normaliseName('  Alpha HALL ')).toBe('alpha hall');
    expect(lookupWalk(data, ' alpha hall', 'BETA TOWER ')).toEqual({
      found: true,
      minutes: 10,
      source: ESTIMATE,
    });
    expect(lookupWalk(data, 'Alpha', 'Beta Tower')).toEqual({
      found: false,
      reason: 'venueNotListed',
      venue: 'Alpha',
    });
  });

  test('reports which venue is absent from the list', () => {
    expect(lookupWalk(data, 'Ghost', 'Beta Tower')).toMatchObject({ venue: 'Ghost' });
    expect(lookupWalk(data, 'Alpha Hall', 'Ghost')).toMatchObject({ venue: 'Ghost' });
  });

  test('gives 5 raw minutes, labelled an estimate, within one venue, never zero', () => {
    const result = lookupWalk(data, 'Alpha Hall', 'alpha hall');
    expect(result).toEqual({
      found: true,
      minutes: SAME_VENUE_WALK_MINUTES,
      source: { kind: 'estimate', basis: 'room to room inside one venue, estimate' },
    });
    expect(SAME_VENUE_WALK_MINUTES).toBe(5);
  });

  test('reports a pair with no matrix value', () => {
    const gap = sampleData();
    gap.walkingTimes = gap.walkingTimes.slice(1);
    expect(lookupWalk(gap, 'Alpha Hall', 'Beta Tower')).toEqual({
      found: false,
      reason: 'pairMissing',
    });
  });
});
