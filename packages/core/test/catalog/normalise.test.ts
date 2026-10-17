import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { NormalisedSessionSchema, type SessionWire, type Venue } from '@compass/contracts';
import { normaliseSession } from '../../src/catalog/normalise.js';
import { parseVenues, recoverVenue } from '../../src/catalog/venue-recovery.js';
import {
  MAX_CACHED_ZONES,
  computeSessionInterval,
  isValidTimeZone,
} from '../../src/catalog/session-time.js';
import { ZONES, wireArb, zoneArb } from './arbitraries.js';

// Tests for normalisation, session times and venue recovery (events-client, S1, tasks
// 13.6 to 13.12). The venue list is the tests' own fixture, never data/venues.json.

const VENUES: Venue[] = [
  { name: 'Venetian' },
  { name: 'Venetian Expo', coordinates: { lat: 36.12, lon: -115.17 } },
  { name: 'Wynn' },
  { name: '  ' },
];
const EVENT_ZONE = 'America/Los_Angeles';

/** Independent offset lookup: the zone's GMT offset at an instant, as +HH:MM. */
function referenceOffset(zone: string, instantMs: number): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instantMs))
    .find((p) => p.type === 'timeZoneName')?.value;
  return part === 'GMT' ? '+00:00' : (part ?? '').replace('GMT', '');
}

/** Independent test of whether a wire time is usable. */
function isUsable(wire: SessionWire, zone: string): boolean {
  const t = wire.sessionTime;
  if (t === undefined) return false;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.date ?? '');
  const c = /^(\d{1,2}):(\d{2})$/.exec(t.time ?? '');
  if (d === null || c === null || !/^\d{1,5}$/.test(t.length ?? '')) return false;
  const real = new Date(Date.UTC(+(d[1] ?? 0), +(d[2] ?? 0) - 1, +(d[3] ?? 0)));
  if (real.getUTCMonth() !== +(d[2] ?? 0) - 1 || real.getUTCDate() !== +(d[3] ?? 0)) return false;
  if (+(c[1] ?? 0) > 23 || +(c[2] ?? 0) > 59) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: t.timezone ?? zone });
    return (t.timezone ?? zone) !== '';
  } catch {
    return false;
  }
}

describe('Feature: events-client, Property 29: Normalisation always produces a valid normalised session', () => {
  // Validates: Requirements 15.1
  test('for any wire session and event zone the result validates against NormalisedSessionSchema', () => {
    fc.assert(
      fc.property(
        wireArb,
        zoneArb,
        fc.option(fc.constant(VENUES), { nil: undefined }),
        (wire, zone, venues) => {
          const result = normaliseSession(wire, venues, zone);
          expect(NormalisedSessionSchema.safeParse(result).success).toBe(true);
          expect(result.sessionId).toBe(wire.sessionId);
          expect(result.title).toBe(wire.title);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Feature: events-client, Property 30: Session times are offset-aware when usable, absent and recorded otherwise', () => {
  // Validates: Requirements 15.2, 15.3
  test('usable times get offset-aware starts and ends, unusable ones are absent and recorded', () => {
    fc.assert(
      fc.property(wireArb, fc.constantFrom(...ZONES), (wire, zone) => {
        const result = normaliseSession(wire, undefined, zone);
        if (!isUsable(wire, zone)) {
          expect(result.startsAt).toBeUndefined();
          expect(result.endsAt).toBeUndefined();
          expect(result.missingFields).toEqual(expect.arrayContaining(['startsAt', 'endsAt']));
          return;
        }
        const t = wire.sessionTime;
        const sessionZone = t?.timezone ?? zone;
        expect(result.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
        const start = Date.parse(result.startsAt ?? '');
        const end = Date.parse(result.endsAt ?? '');
        expect(end - start).toBe(Number(t?.length) * 60_000);
        expect(result.startsAt?.slice(-6)).toBe(referenceOffset(sessionZone, start));
        expect(result.endsAt?.slice(-6)).toBe(referenceOffset(sessionZone, end));
        expect(result.missingFields).not.toContain('startsAt');
        const hour = Number((t?.time ?? '').split(':')[0]);
        if (hour >= 8 && hour <= 20) {
          expect(result.startsAt?.slice(0, 16)).toBe(
            `${t?.date ?? ''}T${(t?.time ?? '').padStart(5, '0')}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  test('the session zone wins over the event zone, and the offset follows daylight saving', () => {
    const summer = computeSessionInterval(
      { date: '2026-07-01', time: '09:00', length: '60', timezone: 'Europe/London' },
      EVENT_ZONE,
    );
    expect(summer?.startsAt).toBe('2026-07-01T09:00:00+01:00');
    const winter = computeSessionInterval(
      { date: '2026-12-01', time: '09:00', length: '90' },
      EVENT_ZONE,
    );
    expect(winter?.startsAt).toBe('2026-12-01T09:00:00-08:00');
    expect(winter?.endsAt).toBe('2026-12-01T10:30:00-08:00');
  });

  test('an end that crosses a daylight saving change takes the new offset', () => {
    const crossing = computeSessionInterval(
      { date: '2026-03-08', time: '01:00', length: '120', timezone: EVENT_ZONE },
      EVENT_ZONE,
    );
    expect(crossing?.startsAt).toBe('2026-03-08T01:00:00-08:00');
    expect(crossing?.endsAt).toBe('2026-03-08T04:00:00-07:00');
  });

  test('a half-hour offset zone renders its offset', () => {
    expect(
      computeSessionInterval(
        { date: '2026-12-01', time: '10:00', length: '30', timezone: 'Asia/Kolkata' },
        'UTC',
      )?.startsAt,
    ).toBe('2026-12-01T10:00:00+05:30');
  });

  test('UTC renders +00:00 and invalid zones are not valid', () => {
    expect(
      computeSessionInterval({ date: '2026-12-01', time: '10:00', length: '0' }, 'UTC')?.endsAt,
    ).toBe('2026-12-01T10:00:00+00:00');
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(computeSessionInterval(undefined, 'UTC')).toBeUndefined();
  });
});

describe('Feature: events-client, Property 31: repeatOf is derived from the -R suffix', () => {
  // Validates: Requirements 15.4
  test('for any code the suffix -R or -R<digit> yields the base code, else repeatOf is absent', () => {
    fc.assert(
      fc.property(wireArb, (wire) => {
        const result = normaliseSession(wire, undefined, EVENT_ZONE);
        const code = wire.abbreviation ?? '';
        const match = /^(.*)-R[0-9]?$/.exec(code);
        if (match !== null && (match[1] ?? '').length > 0) {
          expect(result.repeatOf).toBe(match[1]);
        } else {
          expect(result.repeatOf).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  test('named cases', () => {
    const base = { sessionId: 's', title: 't' };
    const r = (abbreviation: string) =>
      normaliseSession({ ...base, abbreviation }, undefined, EVENT_ZONE).repeatOf;
    expect(r('DAT302-R')).toBe('DAT302');
    expect(r('DAT302-R2')).toBe('DAT302');
    expect(r('DAT302-R22')).toBeUndefined();
    expect(r('DAT302')).toBeUndefined();
    expect(r('-R')).toBeUndefined();
  });
});

describe('Feature: events-client, Property 32: Venue is taken from the wire, else recovered, else absent and recorded', () => {
  // Validates: Requirements 15.5, 15.6, 15.7
  test('for any session and list the venue is the wire venue, else the recovered one, else absent and recorded', () => {
    fc.assert(
      fc.property(wireArb, fc.option(fc.constant(VENUES), { nil: undefined }), (wire, venues) => {
        const result = normaliseSession(wire, venues, EVENT_ZONE);
        const recovered = venues === undefined ? undefined : recoverVenue(wire.room, venues);
        const expected = wire.venue ?? recovered;
        expect(result.venue).toBe(expected);
        expect(result.missingFields.includes('venue')).toBe(expected === undefined);
      }),
      { numRuns: 100 },
    );
  });

  test('recovery prefers the longest matching name and respects word boundaries', () => {
    expect(recoverVenue('Venetian Expo | Hall B', VENUES)).toBe('Venetian Expo');
    expect(recoverVenue('venetian | Level 2', VENUES)).toBe('Venetian');
    expect(recoverVenue('Wynnewood Hall', VENUES)).toBeUndefined();
    expect(recoverVenue('Room 115', VENUES)).toBeUndefined();
    expect(recoverVenue('', VENUES)).toBeUndefined();
    expect(recoverVenue(undefined, VENUES)).toBeUndefined();
    expect(recoverVenue('Wynn (A+B)', [{ name: 'Wynn (A+B)' }])).toBe('Wynn (A+B)');
  });

  test('the injected list is parsed through VenueSchema; a bad or missing list is no list', () => {
    expect(
      parseVenues([{ name: 'A' }, { name: 'B', coordinates: { lat: 1, lon: 2 }, extra: 1 }]),
    ).toEqual([{ name: 'A' }, { name: 'B', coordinates: { lat: 1, lon: 2 } }]);
    expect(parseVenues(undefined)).toBeUndefined();
    expect(parseVenues([{ nome: 'A' }])).toBeUndefined();
    expect(parseVenues('x')).toBeUndefined();
  });
});

describe('Feature: events-client, Property 33: missingFields records exactly the absent tracked fields with documented defaults applied', () => {
  // Validates: Requirements 15.8, 15.10
  test('for any wire session the missing list and the defaults are exactly as documented', () => {
    fc.assert(
      fc.property(wireArb, fc.constantFrom(...ZONES), (wire, zone) => {
        const result = normaliseSession(wire, VENUES, zone);
        const usable = isUsable(wire, zone);
        const venue = wire.venue ?? recoverVenue(wire.room, VENUES);
        const expected = [
          wire.abbreviation === undefined ? 'code' : undefined,
          usable ? undefined : 'startsAt',
          usable ? undefined : 'endsAt',
          venue === undefined ? 'venue' : undefined,
          wire.type === undefined ? 'type' : undefined,
          wire.level === undefined ? 'level' : undefined,
          wire.room === undefined ? 'room' : undefined,
          wire.isAllDaySession === undefined ? 'isAllDay' : undefined,
          wire.isReservable === undefined ? 'isReservable' : undefined,
          wire.seatAvailability === undefined ? 'seatAvailability' : undefined,
        ].filter((v): v is string => v !== undefined);
        expect(result.missingFields).toEqual(expected);
        expect(result.code).toBe(wire.abbreviation ?? '');
        expect(result.isAllDay).toBe(wire.isAllDaySession ?? false);
        expect(result.isReservable).toBe(wire.isReservable ?? false);
        expect(result.seatAvailability).toBe(wire.seatAvailability ?? 'unknown');
        expect(result.type).toBe(wire.type);
        expect(result.level).toBe(wire.level);
        expect(result.room).toBe(wire.room);
      }),
      { numRuns: 100 },
    );
  });

  test('a bare session gets only the documented defaults, recorded, and nothing invented', () => {
    const result = normaliseSession({ sessionId: 's', title: 't' }, undefined, EVENT_ZONE);
    expect(result).toEqual({
      sessionId: 's',
      code: '',
      title: 't',
      isAllDay: false,
      isReservable: false,
      seatAvailability: 'unknown',
      missingFields: [
        'code',
        'startsAt',
        'endsAt',
        'venue',
        'type',
        'level',
        'room',
        'isAllDay',
        'isReservable',
        'seatAvailability',
      ],
    });
  });
});

describe('events-client, task 13.12: the normaliser never writes data/venues.json', () => {
  test('the normalising sources import no file system API (the cache write path is checked in the cache test)', () => {
    const read = (name: string): string =>
      readFileSync(fileURLToPath(new URL(`../../src/catalog/${name}`, import.meta.url)), 'utf8');
    for (const name of [
      'normalise.ts',
      'venue-recovery.ts',
      'session-time.ts',
      'filter.ts',
      'event-window.ts',
    ]) {
      expect(read(name)).not.toMatch(/node:fs|writeFile|appendFile|rename|mkdir/);
    }
  });
});

describe('events-client, N6: the zone formatter cache is bounded', () => {
  test('more than 64 distinct zones still compute correctly, including after eviction', () => {
    const zones = Intl.supportedValuesOf('timeZone').slice(0, 90);
    const first = zones[0] ?? 'UTC';
    const at = (timezone: string) =>
      computeSessionInterval({ date: '2026-12-01', time: '10:00', length: '30', timezone }, 'UTC');
    const before = at(first);
    for (const timezone of zones) {
      expect(at(timezone)).toBeDefined();
    }
    expect(MAX_CACHED_ZONES).toBe(64);
    expect(at(first)).toEqual(before);
  });

  test('wrong-case and alias spellings are judged strictly', () => {
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('america/los_angeles')).toBe(false);
    expect(isValidTimeZone('AMERICA/LOS_ANGELES')).toBe(false);
    expect(isValidTimeZone('Europe/PARIS')).toBe(false);
  });
});
