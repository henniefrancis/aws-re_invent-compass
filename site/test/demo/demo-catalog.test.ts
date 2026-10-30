import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NormalisedSessionSchema, type NormalisedSession } from '@compass/contracts';
import { describe, expect, test } from 'vitest';
import snapshot from '../../src/lib/demo/demo-sessions.json';
import {
  DEMO_EVENT,
  DEMO_SESSIONS,
  DEMO_SOURCE,
  DEMO_SOURCE_IDS,
  GUIDED_CLASH,
  STARTER_WEEK,
  toSession,
} from '../../src/lib/demo/demo-catalog';
import { DEMO_VENUE_DATA } from '../../src/lib/demo/venue-data';
import { SITE_ROOT } from '../support/source-files';

const REPO_ROOT = join(SITE_ROOT, '..');
/** The only fields the snapshot may hold for a session (owner rule, hackathon rules row 11). */
const ALLOWED_FIELDS = ['code', 'endsAt', 'room', 'startsAt', 'title', 'venue'];

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

  test('the snapshot holds the code, title, start, end, venue and room only, with a source credit', () => {
    expect(snapshot.source.name).toBe('AWS Events API');
    expect(DEMO_SOURCE.name).toBe('AWS Events API');
    expect(Date.parse(snapshot.fetchedAt)).not.toBeNaN();
    expect(DEMO_SOURCE.asOf).toBe('29 October 2026');
    for (const record of snapshot.sessions) {
      expect(Object.keys(record).filter((k) => !ALLOWED_FIELDS.includes(k))).toEqual([]);
      for (const field of ['code', 'title', 'startsAt', 'endsAt']) {
        expect(Object.keys(record), record.code).toContain(field);
      }
    }
  });

  test('every entry is built from its snapshot record, with the repeat link from the code suffix', () => {
    for (const record of snapshot.sessions) {
      const session = get(record.code);
      expect(session.sessionId).toBe(record.code);
      expect(session.title).toBe(record.title);
      expect(session.startsAt).toBe(record.startsAt);
      expect(session.endsAt).toBe(record.endsAt);
      expect(session.venue).toBe((record as { venue?: string }).venue);
      const room = (record as { room?: string }).room;
      expect(session.room).toBe(
        room === undefined
          ? undefined
          : room
              .split('|')
              .map((p) => p.trim())
              .join(', '),
      );
      expect(session.type).toBeUndefined();
      expect(session.level).toBeUndefined();
      expect(session.repeatOf).toBe(
        /-R[0-9]?$/.test(record.code) ? record.code.replace(/-R[0-9]?$/, '') : undefined,
      );
    }
  });

  test('a record with no venue and no room lists both as missing, and a room bar becomes a comma', () => {
    const record = {
      code: 'XYZ1',
      title: 'T',
      startsAt: '2026-12-01T10:00:00-08:00',
      endsAt: '2026-12-01T11:00:00-08:00',
    };
    expect(toSession(record)).toMatchObject({ missingFields: ['venue', 'room'] });
    expect(toSession({ ...record, venue: 'Wynn', room: 'Level 1 | Room 2' })).toMatchObject({
      venue: 'Wynn',
      room: 'Level 1, Room 2',
      missingFields: [],
    });
  });

  test('every entry is a valid NormalisedSession', () => {
    for (const session of DEMO_SESSIONS) {
      expect(NormalisedSessionSchema.parse(session)).toEqual(session);
    }
  });

  test('the demo event has the Las Vegas timezone and a fixed instant', () => {
    expect(DEMO_EVENT.timezone).toBe('America/Los_Angeles');
    expect(DEMO_EVENT.now).toBe('2026-11-29T18:00:00-08:00');
    expect(Date.parse(DEMO_EVENT.now)).toBeLessThan(Date.parse(DEMO_SESSIONS[0]?.startsAt ?? ''));
    expect(DEMO_EVENT.windowStart).toBe('2026-11-30T00:00:00-08:00');
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
    expect(noVenue.map((s) => s.sessionId)).toEqual(['ACT053']);
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
      const base = held.repeatOf ?? held.code;
      const repeats = DEMO_SESSIONS.filter(
        (s) => s.repeatOf === base && s.sessionId !== held.sessionId,
      );
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

  test('INV530-R1 and CMP325-R together fill one whole meal window, and the Starter_Week alone does not', () => {
    const mealStart = 11 * 60 + 30;
    const mealEnd = 14 * 60;
    const pair = ['INV530-R1', 'CMP325-R'].map(get);
    const starter = STARTER_WEEK.map(get);
    const freeOn = (d: string, week: NormalisedSession[]): number => {
      let free = 0;
      for (let minute = mealStart; minute < mealEnd; minute += 1) {
        const busy = week.some((s) => {
          const from =
            Number((s.startsAt ?? '').slice(11, 13)) * 60 +
            Number((s.startsAt ?? '').slice(14, 16));
          return day(s) === d && from <= minute && minute < from + (end(s) - start(s)) / 60_000;
        });
        free += busy ? 0 : 1;
      }
      return free;
    };
    const monday = day(get('INV530-R1'));
    expect(freeOn(monday, pair)).toBe(0);
    expect([...new Set(starter.map(day))].every((d) => freeOn(d, starter) >= 30)).toBe(true);
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
    // QA M6: the held session and its repeat both have seats, so the safe swap is believable.
    expect(['available', 'limited', 'veryLimited']).toContain(held.seatAvailability);
    expect(['available', 'limited', 'veryLimited']).toContain(repeat.seatAvailability);
    expect(repeat.isReservable).toBe(true);
    expect(repeat.title).toBe(held.title);
    // The catalog lists TNC334-R and TNC334-R1 as repeats of TNC334, so both share one base code.
    expect(repeat.repeatOf).toBe(held.repeatOf ?? held.code);
    expect(repeat.code).not.toBe(held.code);
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
