import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NormalisedSessionSchema,
  SessionWireSchema,
  type NormalisedSession,
} from '@compass/contracts';
import { describe, expect, test } from 'vitest';
import {
  DEMO_EVENT,
  DEMO_SESSIONS,
  DEMO_SOURCE_IDS,
  GUIDED_CLASH,
  STARTER_WEEK,
} from '../../src/lib/demo/demo-catalog';
import { DEMO_VENUE_DATA } from '../../src/lib/demo/venue-data';
import { normaliseWire } from '../support/normalise-wire';
import { SITE_ROOT } from '../support/source-files';

const REPO_ROOT = join(SITE_ROOT, '..');
const catalog = (
  JSON.parse(
    readFileSync(join(REPO_ROOT, 'fixtures', 'synthetic', 'catalog.json'), 'utf8'),
  ) as unknown[]
).map((record) => SessionWireSchema.parse(record));

/** The six official 2026 venues, as named in data/venues.json (S2). */
const OFFICIAL_VENUES = [
  'Caesars Forum',
  'Caesars Palace',
  'Encore',
  'MGM Grand',
  'The Venetian',
  'Wynn',
];

const byId = new Map(DEMO_SESSIONS.map((s) => [s.sessionId, s]));
const get = (id: string): NormalisedSession => {
  const session = byId.get(id);
  if (session === undefined) {
    throw new Error(`Missing demo session ${id}`);
  }
  return session;
};
const start = (s: NormalisedSession): number => Date.parse(s.startsAt ?? '');
const end = (s: NormalisedSession): number => Date.parse(s.endsAt ?? '');
const overlap = (a: NormalisedSession, b: NormalisedSession): boolean =>
  start(a) < end(b) && start(b) < end(a);
const day = (s: NormalisedSession): string => (s.startsAt ?? '').slice(0, 10);

describe('demo catalog provenance (Requirement 7.1)', () => {
  test('has 12 to 24 sessions across at least two event days, in the order of the source ids', () => {
    expect(DEMO_SESSIONS.length).toBeGreaterThanOrEqual(12);
    expect(DEMO_SESSIONS.length).toBeLessThanOrEqual(24);
    expect(new Set(DEMO_SESSIONS.map(day)).size).toBeGreaterThanOrEqual(2);
    expect(DEMO_SESSIONS.map((s) => s.sessionId)).toEqual(DEMO_SOURCE_IDS);
    expect(new Set(DEMO_SOURCE_IDS).size).toBe(DEMO_SOURCE_IDS.length);
  });

  test('every entry equals the normalised form of the synthetic record with the same id', () => {
    for (const id of DEMO_SOURCE_IDS) {
      const wire = catalog.find((record) => record.sessionId === id);
      expect(wire, id).toBeDefined();
      expect(get(id), id).toEqual(normaliseWire(wire as NonNullable<typeof wire>));
    }
  });

  test('every entry is a valid NormalisedSession and every source record parses as a wire session', () => {
    for (const session of DEMO_SESSIONS) {
      expect(NormalisedSessionSchema.parse(session)).toEqual(session);
    }
    expect(catalog).toHaveLength(120);
  });

  test('the demo event takes its timezone from the copied records and has a fixed instant', () => {
    expect(DEMO_EVENT.timezone).toBe('America/Los_Angeles');
    for (const wire of catalog.filter((r) => DEMO_SOURCE_IDS.includes(r.sessionId))) {
      expect(wire.sessionTime?.timezone).toBe(DEMO_EVENT.timezone);
    }
    expect(DEMO_EVENT.now).toBe('2026-11-30T18:00:00-08:00');
    expect(Date.parse(DEMO_EVENT.now)).toBeLessThan(Date.parse(DEMO_SESSIONS[0]?.startsAt ?? ''));
    expect(DEMO_EVENT.windowStart).toBe('2026-12-01T00:00:00-08:00');
    expect(DEMO_EVENT.windowEnd).toBe('2026-12-04T23:59:00-08:00');
    for (const session of DEMO_SESSIONS) {
      expect(start(session)).toBeGreaterThanOrEqual(Date.parse(DEMO_EVENT.windowStart));
      expect(end(session)).toBeLessThanOrEqual(Date.parse(DEMO_EVENT.windowEnd));
    }
  });
});

describe('demo catalog venues', () => {
  test('every venue is one of the six official 2026 venues, or absent', () => {
    for (const session of DEMO_SESSIONS) {
      if (session.venue !== undefined) {
        expect(OFFICIAL_VENUES, `${session.sessionId}: ${session.venue}`).toContain(session.venue);
      }
    }
  });

  test('every venue is also in data/venues.json when that file is present', () => {
    const file = join(REPO_ROOT, 'data', 'venues.json');
    if (!existsSync(file)) {
      return;
    }
    const data = JSON.parse(readFileSync(file, 'utf8')) as {
      venues: { venue: { name: string } }[];
    };
    const names = data.venues.map((v) => v.venue.name);
    expect(names.sort()).toEqual([...OFFICIAL_VENUES].sort());
    for (const session of DEMO_SESSIONS) {
      if (session.venue !== undefined) {
        expect(names).toContain(session.venue);
      }
    }
  });

  test('one session has no venue and says so in its missing fields', () => {
    const noVenue = DEMO_SESSIONS.filter((s) => s.venue === undefined);
    expect(noVenue.map((s) => s.sessionId)).toEqual(['syn-008']);
    expect(noVenue[0]?.missingFields).toContain('venue');
  });

  test('the venue data seam holds null until the S2 file is wired in', () => {
    expect(DEMO_VENUE_DATA === null || typeof DEMO_VENUE_DATA === 'object').toBe(true);
  });
});

describe('demo catalog scenarios (Requirement 7.3)', () => {
  test('two sessions on one day overlap in time', () => {
    const pairs = DEMO_SESSIONS.flatMap((a) =>
      DEMO_SESSIONS.filter((b) => a.sessionId < b.sessionId && day(a) === day(b) && overlap(a, b)),
    );
    expect(pairs.length).toBeGreaterThan(0);
  });

  test('a held Starter_Week session has a -R repeat that overlaps no other Starter_Week session', () => {
    const starter = STARTER_WEEK.map(get);
    const found = starter.filter((held) => {
      const repeats = DEMO_SESSIONS.filter((s) => s.repeatOf === held.code);
      return repeats.some((repeat) =>
        starter.every((other) => other === held || !overlap(repeat, other)),
      );
    });
    expect(found.map((s) => s.sessionId)).toContain(GUIDED_CLASH.clashesWith);
  });

  test('two consecutive sessions at different venues exist', () => {
    const pairs = DEMO_SESSIONS.flatMap((a) =>
      DEMO_SESSIONS.filter(
        (b) =>
          day(a) === day(b) &&
          a.venue !== undefined &&
          b.venue !== undefined &&
          a.venue !== b.venue &&
          start(b) >= end(a) &&
          start(b) - end(a) <= 60 * 60_000,
      ),
    );
    expect(pairs.length).toBeGreaterThan(0);
  });

  test('at least one session cannot be reserved', () => {
    expect(DEMO_SESSIONS.some((s) => !s.isReservable)).toBe(true);
  });

  test('the Starter_Week fills one meal window so a missing meal layover is reachable', () => {
    const mealStart = 11 * 60 + 30;
    const mealEnd = 14 * 60;
    const starter = STARTER_WEEK.map(get);
    const freeOn = (d: string): number => {
      let free = 0;
      for (let minute = mealStart; minute < mealEnd; minute += 1) {
        const busy = starter.some((s) => {
          const from =
            Number((s.startsAt ?? '').slice(11, 13)) * 60 +
            Number((s.startsAt ?? '').slice(14, 16));
          return day(s) === d && from <= minute && minute < from + (end(s) - start(s)) / 60_000;
        });
        free += busy ? 0 : 1;
      }
      return free;
    };
    expect([...new Set(starter.map(day))].some((d) => freeOn(d) < 30)).toBe(true);
  });

  test('the guided clash names real, reservable, overlapping sessions', () => {
    const tryAdd = get(GUIDED_CLASH.tryAdd);
    const held = get(GUIDED_CLASH.clashesWith);
    const repeat = get(GUIDED_CLASH.heldRepeat);
    expect(STARTER_WEEK).toContain(held.sessionId);
    expect(STARTER_WEEK).not.toContain(tryAdd.sessionId);
    expect(STARTER_WEEK).not.toContain(repeat.sessionId);
    expect(tryAdd.isReservable).toBe(true);
    expect(overlap(tryAdd, held)).toBe(true);
    expect(repeat.repeatOf).toBe(held.code);
    for (const other of STARTER_WEEK.map(get)) {
      if (other !== held) {
        expect(overlap(repeat, other), other.sessionId).toBe(false);
        expect(overlap(tryAdd, other), other.sessionId).toBe(false);
      }
    }
  });

  test('every Starter_Week session exists, is reservable and no two of them overlap', () => {
    const starter = STARTER_WEEK.map(get);
    for (const session of starter) {
      expect(session.isReservable).toBe(true);
    }
    for (const a of starter) {
      for (const b of starter) {
        if (a !== b) {
          expect(overlap(a, b)).toBe(false);
        }
      }
    }
  });
});
