import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import type { VenueData } from '../../src/rules/context.js';
import {
  OFFICIAL_HOSTS,
  SAME_VENUE_WALK_MINUTES,
  VENUE_LIMITS,
  VenueDataSchema,
  lookupWalk,
  normaliseName,
  sameVenue,
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

  test('has the researched per-pair estimates, each with a 30 minute floor, both ways', () => {
    const data = VenueDataSchema.parse(raw);
    // The researched minutes for each unordered pair, after the 30 minute floor.
    const expected: Array<[string, string, number]> = [
      ['Caesars Forum', 'Caesars Palace', 40],
      ['Caesars Forum', 'Encore', 45],
      ['Caesars Forum', 'MGM Grand', 55],
      ['Caesars Forum', 'The Venetian', 30],
      ['Caesars Forum', 'Wynn', 45],
      ['Caesars Palace', 'Encore', 55],
      ['Caesars Palace', 'MGM Grand', 60],
      ['Caesars Palace', 'The Venetian', 55],
      ['Caesars Palace', 'Wynn', 55],
      ['Encore', 'MGM Grand', 75],
      ['Encore', 'The Venetian', 45],
      ['Encore', 'Wynn', 30],
      ['MGM Grand', 'The Venetian', 60],
      ['MGM Grand', 'Wynn', 75],
      ['The Venetian', 'Wynn', 40],
    ];
    const minutesOf = (from: string, to: string): number | undefined =>
      data.walkingTimes.find((edge) => edge.from === from && edge.to === to)?.minutes;
    for (const [a, b, minutes] of expected) {
      expect(minutesOf(a, b), `${a} to ${b}`).toBe(minutes);
      expect(minutesOf(b, a), `${b} to ${a}`).toBe(minutes);
    }
    // Encore and Wynn were 25 before the floor.
    expect(minutesOf('Encore', 'Wynn')).toBe(30);
    expect(data.walkingTimes.every((edge) => edge.minutes >= 30)).toBe(true);
  });

  test('every estimate states its basis: the OSRM distance, the formula, the floor and the sources', () => {
    const data = VenueDataSchema.parse(raw);
    for (const edge of data.walkingTimes) {
      expect(edge.source.kind).toBe('estimate');
      const basis = edge.source.kind === 'estimate' ? (edge.source.basis ?? '') : '';
      expect(basis, `${edge.from} to ${edge.to}`).toContain(
        'https://routing.openstreetmap.de/routed-foot/',
      );
      expect(basis).toMatch(/OSRM foot distance between .+ is \d+ m/);
      expect(basis).toContain('Formula: minutes = round up to 5');
      expect(basis).toContain('66.7 metres per minute');
      expect(basis).toContain('30 minute floor');
      expect(basis).toContain('https://aws.amazon.com/resources/analyst-summit');
      expect(basis).not.toContain(String.fromCharCode(0x2013));
      expect(basis).not.toContain(String.fromCharCode(0x2014));
    }
    const routes = data.walkingTimes.filter(
      (edge) =>
        edge.source.kind === 'estimate' && edge.source.basis?.includes('AWS source for the routes'),
    );
    // Only the pairs AWS names as direct routes cite that page again: Forum and Venetian,
    // Encore and Venetian, Encore and Wynn, Venetian and Wynn, in both directions.
    expect(routes).toHaveLength(8);
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

  test('accepts official URLs on allowlisted paths, with or without a path, and a host in any case', () => {
    for (const url of [
      'https://aws.amazon.com/events/reinvent',
      'https://aws.amazon.com/events/reinvent/faqs/',
      'https://Reinvent.AwsEvents.com/Venues',
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

  test('refuses official URLs with a query, a fragment, percent encoding or . and .. segments', () => {
    for (const url of [
      'https://aws.amazon.com/events/reinvent/faqs/?a=1',
      'https://aws.amazon.com/events/reinvent/faqs/#top',
      'https://aws.amazon.com/events/reinvent/faqs/%2e%2e/secret',
      'https://aws.amazon.com/events/reinvent/%2Ffaqs',
      'https://aws.amazon.com/events/reinvent/../../secret',
      'https://aws.amazon.com/events/reinvent/./faqs',
      'https://aws.amazon.com/events/reinvent/faqs/..',
      'https://reinvent.awsevents.com/a/../b',
      'https://reinvent.awsevents.com/%41',
      'https://reinvent.awsevents.com?x=1',
    ]) {
      const data = sampleData();
      data.walkingTimes[0] = {
        ...data.walkingTimes[0],
        source: { kind: 'official', url, retrievedOn: '2026-10-17' },
      };
      expect(validateVenueData(data).ok, url).toBe(false);
    }
  });

  test('caps the length of names, URLs, notes and lists', () => {
    const long = (n: number): string => 'x'.repeat(n);
    const cases: Array<[string, (data: VenueData) => void]> = [
      ['venue name', (d) => (d.venues[0].venue.name = long(VENUE_LIMITS.name + 1))],
      ['edge from', (d) => (d.walkingTimes[0].from = long(VENUE_LIMITS.name + 1))],
      ['edge to', (d) => (d.walkingTimes[0].to = long(VENUE_LIMITS.name + 1))],
      [
        'basis',
        (d) =>
          (d.walkingTimes[0].source = { kind: 'estimate', basis: long(VENUE_LIMITS.basis + 1) }),
      ],
      [
        'url',
        (d) =>
          (d.walkingTimes[0].source = {
            kind: 'official',
            url: `https://aws.amazon.com/events/reinvent/${long(VENUE_LIMITS.url)}`,
            retrievedOn: '2026-10-17',
          }),
      ],
      [
        'alias name',
        (d) =>
          (d.venues[0].aliases = [
            { name: long(VENUE_LIMITS.name + 1), source: { kind: 'estimate' } },
          ]),
      ],
      [
        'alias count',
        (d) =>
          (d.venues[0].aliases = Array.from({ length: VENUE_LIMITS.aliases + 1 }, (_, i) => ({
            name: `Alias ${i}`,
            source: { kind: 'estimate' as const },
          }))),
      ],
      [
        'venue count',
        (d) =>
          (d.venues = Array.from({ length: VENUE_LIMITS.venues + 1 }, (_, i) => ({
            venue: { name: `Venue ${i}` },
          }))),
      ],
      [
        'walking time count',
        (d) =>
          (d.walkingTimes = Array.from({ length: VENUE_LIMITS.walkingTimes + 1 }, () => ({
            from: 'Alpha Hall',
            to: 'Beta Tower',
            minutes: 5,
            source: { kind: 'estimate' as const },
          }))),
      ],
    ];
    for (const [name, mutate] of cases) {
      const data = sampleData();
      mutate(data);
      expect(validateVenueData(data).ok, name).toBe(false);
    }
    // The limits themselves are accepted.
    const edge = sampleData();
    edge.walkingTimes[0] = {
      ...edge.walkingTimes[0],
      source: { kind: 'estimate', basis: long(VENUE_LIMITS.basis) },
    };
    expect(validateVenueData(edge).ok).toBe(true);
  });

  test('accepts aliases with their own source notes, and edges that use an alias', () => {
    const data = sampleData();
    data.venues[0].aliases = [
      { name: 'Alpha', source: { kind: 'estimate', basis: 'A spelling variant.' } },
      {
        name: 'The Alpha Hall',
        source: {
          kind: 'official',
          url: 'https://aws.amazon.com/events/reinvent/faqs/',
          retrievedOn: '2026-10-17',
        },
      },
    ];
    data.walkingTimes[0] = { ...data.walkingTimes[0], from: ' alpha ' };
    expect(validateVenueData(data)).toMatchObject({ ok: true });
  });

  test('rejects an alias that is empty, repeated, or already a venue name or alias', () => {
    const cases: Array<[string, (data: VenueData) => void, string]> = [
      [
        'empty',
        (d) => (d.venues[0].aliases = [{ name: '  ', source: { kind: 'estimate' } }]),
        'venues[0].aliases[0].name',
      ],
      [
        'a venue name',
        (d) => (d.venues[0].aliases = [{ name: 'BETA tower', source: { kind: 'estimate' } }]),
        'venues[0].aliases[0].name: the alias is already used',
      ],
      [
        'repeated',
        (d) =>
          (d.venues[1].aliases = [
            { name: 'Beta', source: { kind: 'estimate' } },
            { name: ' beta ', source: { kind: 'estimate' } },
          ]),
        'venues[1].aliases[1].name: the alias is already used',
      ],
      [
        'another venue alias',
        (d) => {
          d.venues[0].aliases = [{ name: 'Shared', source: { kind: 'estimate' } }];
          d.venues[2].aliases = [{ name: 'shared', source: { kind: 'estimate' } }];
        },
        'venues[2].aliases[0].name: the alias is already used',
      ],
      [
        'with a bad source',
        (d) =>
          (d.venues[0].aliases = [
            {
              name: 'Alpha',
              source: { kind: 'official', url: 'https://example.com/', retrievedOn: '2026-10-17' },
            },
          ]),
        'venues[0].aliases[0].source',
      ],
    ];
    for (const [name, mutate, expected] of cases) {
      const data = sampleData();
      mutate(data);
      expect(errorsOf(data).join(' '), name).toContain(expected);
    }
  });

  test('a matrix is still complete when it uses aliases, and an alias edge counts once', () => {
    const data = sampleData();
    data.venues[0].aliases = [{ name: 'Alpha', source: { kind: 'estimate' } }];
    data.walkingTimes.push({
      from: 'Alpha',
      to: 'Beta Tower',
      minutes: 5,
      source: { kind: 'estimate' },
    });
    expect(errorsOf(data).join(' ')).toContain('the ordered pair is listed twice');
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

describe('lookupWalk with aliases', () => {
  function withAliases(): VenueData {
    const data = sampleData();
    data.venues[1].aliases = [
      { name: 'Beta', source: { kind: 'estimate' } },
      { name: 'The Beta Expo', source: { kind: 'estimate' } },
    ];
    return data;
  }

  test('matches an alias in any case after trimming, in either place', () => {
    const data = withAliases();
    const direct = lookupWalk(data, 'Alpha Hall', 'Beta Tower');
    expect(direct).toMatchObject({ found: true, minutes: 10 });
    expect(lookupWalk(data, 'alpha hall', '  BETA ')).toEqual(direct);
    expect(lookupWalk(data, ' the beta EXPO', 'Alpha Hall')).toMatchObject({
      found: true,
      minutes: 10,
    });
  });

  test('two spellings of one venue are the same venue: the room-to-room estimate', () => {
    const data = withAliases();
    expect(lookupWalk(data, 'Beta', 'The Beta Expo')).toMatchObject({
      found: true,
      minutes: SAME_VENUE_WALK_MINUTES,
    });
    expect(lookupWalk(data, 'beta tower', 'BETA')).toMatchObject({
      minutes: SAME_VENUE_WALK_MINUTES,
    });
    expect(sameVenue(data, 'Beta', 'Beta Tower')).toBe(true);
    expect(sameVenue(data, 'Beta', 'Alpha Hall')).toBe(false);
  });

  test('a name that is only similar, or not a 2026 venue, stays unknown', () => {
    const data = withAliases();
    expect(lookupWalk(data, 'Betas', 'Alpha Hall')).toEqual({
      found: false,
      reason: 'venueNotListed',
      venue: 'Betas',
    });
    expect(lookupWalk(data, 'Alpha Hall', 'Mandalay Bay')).toEqual({
      found: false,
      reason: 'venueNotListed',
      venue: 'Mandalay Bay',
    });
    // Outside the list, two names are the same only when they match exactly after trimming.
    expect(sameVenue(data, ' Mandalay Bay', 'mandalay bay ')).toBe(true);
    expect(sameVenue(data, 'Mandalay Bay', 'Alpha Hall')).toBe(false);
  });

  test('the first venue to claim a spelling keeps it, even in unvalidated data', () => {
    const data = withAliases();
    data.venues[2].aliases = [{ name: 'beta', source: { kind: 'estimate' } }];
    expect(sameVenue(data, 'Beta', 'Beta Tower')).toBe(true);
    expect(sameVenue(data, 'Beta', 'Gamma Plaza')).toBe(false);
    // A venue listed twice (invalid data) keeps one meaning too.
    data.venues.push({
      venue: { name: ' BETA TOWER ' },
      aliases: [{ name: 'Beta', source: { kind: 'estimate' } }],
    });
    expect(sameVenue(data, 'Beta', 'Beta Tower')).toBe(true);
  });
});

describe('data/venues.json aliases and integrity', () => {
  const file = readFileSync(new URL('../../../../data/venues.json', import.meta.url), 'utf8');
  const data = VenueDataSchema.parse(JSON.parse(file));

  test('has only spelling variants, each with a source note', () => {
    const aliases = Object.fromEntries(
      data.venues
        .filter((entry) => entry.aliases !== undefined)
        .map((entry) => [entry.venue.name, entry.aliases!.map((alias) => alias.name)]),
    );
    expect(aliases).toEqual({
      'The Venetian': ['Venetian', 'The Venetian Expo', 'Venetian Expo'],
      Wynn: ['Wynn Las Vegas'],
    });
    for (const entry of data.venues) {
      for (const alias of entry.aliases ?? []) {
        expect(['official', 'estimate']).toContain(alias.source.kind);
      }
    }
    // Mandalay Bay is not a 2026 venue, so it stays unknown.
    expect(lookupWalk(data, 'Mandalay Bay', 'Wynn')).toMatchObject({ found: false });
    expect(lookupWalk(data, 'Venetian Expo', 'Wynn Las Vegas')).toMatchObject({
      found: true,
      minutes: 40,
    });
    expect(lookupWalk(data, 'venetian', 'The Venetian Expo')).toMatchObject({
      minutes: SAME_VENUE_WALK_MINUTES,
    });
  });

  // INTEGRITY PIN. This is the SHA-256 of data/venues.json (line endings normalised to LF). If you
  // change the venue data on purpose, update this value in the SAME commit, so a change to the
  // walking times can never slip in without a reviewer seeing it here.
  const PINNED_SHA256 = '1d5f6e45656506ec3c78fc89ae2ee6538d3b503f733b09f3c4b57abb64d94253';

  test('data/venues.json matches its pinned SHA-256', () => {
    const digest = createHash('sha256').update(file.replaceAll('\r\n', '\n')).digest('hex');
    expect(digest).toBe(PINNED_SHA256);
  });
});
