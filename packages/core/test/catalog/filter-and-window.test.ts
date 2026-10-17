import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { filterCatalog, type CatalogFilter } from '../../src/catalog/filter.js';
import { resolveEventWindow } from '../../src/catalog/event-window.js';
import { EventWindowError } from '../../src/api/errors.js';
import { normaliseSession } from '../../src/catalog/normalise.js';
import { wireArb } from './arbitraries.js';
import type { CacheEntry } from '../../src/catalog/cache.js';
import type { Event } from '@compass/contracts';

// Tests for local filtering and the event window (events-client, S1, tasks 13.17 to
// 13.19). Filtering touches no transport at all: it takes entries and returns entries.

const ZONE = 'America/Los_Angeles';
const entryArb: fc.Arbitrary<CacheEntry> = wireArb.map((wire) => ({
  session: normaliseSession(wire, [{ name: 'Venetian' }], ZONE),
  wire,
}));
const textPiece = fc.constantFrom('a', 'e', 'Title', 'cost', 'x');

const filterArb: fc.Arbitrary<CatalogFilter> = fc.record(
  {
    text: textPiece,
    type: fc.constantFrom('Workshop', 'chalk talk', 'Other'),
    level: fc.constantFrom('100', '300'),
    day: fc.constantFrom('2026-11-30', '2026-12-01', '2026-06-15'),
    venue: fc.constantFrom('venetian', 'Wynn'),
    service: fc.constantFrom('S3', 'lambda'),
    topic: fc.constantFrom('AI', 'cost'),
  },
  { requiredKeys: [] },
);

/** Independent reference implementation of one criterion. */
function matches(entry: CacheEntry, f: CatalogFilter): boolean {
  const { session, wire } = entry;
  const eq = (a: string | undefined, b: string | undefined): boolean =>
    b === undefined || (a !== undefined && a.toLowerCase() === b.toLowerCase());
  const has = (list: string[] | undefined, b: string | undefined): boolean =>
    b === undefined || (list ?? []).some((v) => v.toLowerCase() === b.toLowerCase());
  const text =
    f.text === undefined ||
    [
      session.title,
      wire.abstract ?? '',
      session.code,
      session.room ?? '',
      session.venue ?? '',
      ...(wire.speakers ?? []).map((sp) => sp.name ?? ''),
    ]
      .join(' ')
      .toLowerCase()
      .includes(f.text.toLowerCase());
  const day = f.day === undefined || (session.startsAt ?? '').startsWith(f.day);
  return (
    text &&
    day &&
    eq(session.type, f.type) &&
    eq(session.level, f.level) &&
    eq(session.venue, f.venue) &&
    has(wire.services, f.service) &&
    has(wire.topics, f.topic)
  );
}

describe('Feature: events-client, Property 34: Local filtering is a conjunctive subset with no API call', () => {
  // Validates: Requirements 16.1, 16.2, 16.3, 16.4
  test('for any catalog and filter the result is exactly the conjunctive matches, in order', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 12 }), filterArb, (entries, filter) => {
        const result = filterCatalog(entries, filter);
        expect(result).toEqual(entries.filter((e) => matches(e, filter)));
        for (const r of result) {
          expect(entries).toContain(r);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('no criteria returns everything, and so do empty or blank criteria', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 8 }), (entries) => {
        expect(filterCatalog(entries, {})).toEqual(entries);
        expect(filterCatalog(entries, { text: '', type: '  ', day: '' })).toEqual(entries);
      }),
      { numRuns: 100 },
    );
  });

  test('adding a criterion never grows the result', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 10 }), filterArb, filterArb, (entries, a, b) => {
        const both = filterCatalog(entries, { ...a, ...b });
        expect(both.length).toBeLessThanOrEqual(filterCatalog(entries, a).length);
        expect(both.length).toBeLessThanOrEqual(filterCatalog(entries, b).length);
      }),
      { numRuns: 100 },
    );
  });

  test('named cases: every criterion matches by case-insensitive equality on its own field', () => {
    const wire = {
      sessionId: 's',
      title: 'T',
      type: 'Workshop',
      level: '300',
      venue: 'Wynn',
      services: ['Lambda', 'S3'],
      topics: ['AI'],
    };
    const entries = [{ session: normaliseSession(wire, undefined, ZONE), wire }];
    const all = { type: 'workshop', level: '300', venue: 'WYNN', service: 's3', topic: 'ai' };
    expect(filterCatalog(entries, all)).toHaveLength(1);
    for (const miss of [
      { type: 'chalk talk' },
      { level: '100' },
      { venue: 'MGM' },
      { service: 'ec2' },
      { topic: 'cost' },
    ]) {
      expect(filterCatalog(entries, { ...all, ...miss })).toHaveLength(0);
    }
    const bare = { sessionId: 'b', title: 'Bare' };
    const bareEntries = [{ session: normaliseSession(bare, undefined, ZONE), wire: bare }];
    for (const key of ['type', 'level', 'venue', 'service', 'topic'] as const) {
      expect(filterCatalog(bareEntries, { [key]: 'x' })).toHaveLength(0);
    }
  });

  test('named cases: text spans title and abstract, day is the local date of startsAt', () => {
    const wire = {
      sessionId: 's',
      title: 'Serverless Basics',
      abstract: 'All about Lambda',
      sessionTime: { date: '2026-11-30', time: '23:30', length: '60', timezone: ZONE },
    };
    const entries = [{ session: normaliseSession(wire, undefined, ZONE), wire }];
    expect(filterCatalog(entries, { text: 'lambda' })).toHaveLength(1);
    expect(filterCatalog(entries, { text: 'serverless' })).toHaveLength(1);
    expect(filterCatalog(entries, { text: 'nothing' })).toHaveLength(0);
    expect(filterCatalog(entries, { day: '2026-11-30' })).toHaveLength(1);
    expect(filterCatalog(entries, { day: '2026-12-01' })).toHaveLength(0);
    const noTime = { sessionId: 'n', title: 'No time' };
    expect(
      filterCatalog([{ session: normaliseSession(noTime, undefined, ZONE), wire: noTime }], {
        day: '2026-11-30',
      }),
    ).toHaveLength(0);
  });
});

const event: Event = {
  eventId: 'reinvent2026',
  name: 'AWS re:Invent 2026',
  eventType: 'conference',
  startDate: '2026-11-30T00:00:00-08:00',
  endDate: '2026-12-04T23:59:59-08:00',
  isOnline: false,
  authenticationRequired: true,
  timezone: 'America/Los_Angeles',
};

describe('Feature: events-client, Property 35: Event window comes from the API or errors, never a default', () => {
  // Validates: Requirements 17.1, 17.2, 17.3, 17.4
  const maybe = (arb: fc.Arbitrary<string>): fc.Arbitrary<string | undefined> =>
    fc.option(arb, { nil: undefined });
  const GOOD_ZONES = ['America/Los_Angeles', 'Europe/Paris', 'Asia/Kolkata', 'UTC'];
  const zoneArb = fc.constantFrom(
    ...GOOD_ZONES,
    'Not/AZone',
    'PST8NOPE',
    '',
    'america/los_angeles',
    'AMERICA/LOS_ANGELES',
    'Europe/PARIS',
  );
  const dateArb = fc.constantFrom(
    '2026-11-30T00:00:00-08:00',
    '2026-12-04T23:59:59-08:00',
    '2026-12-04T23:59:59Z',
    '2026-12-04',
    '2026-12-04 10:00:00',
    'garbage',
    '',
  );
  const isoOk = (d: string | undefined): d is string =>
    d !== undefined &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(d) &&
    !Number.isNaN(Date.parse(d));
  const first = (
    a: string | undefined,
    b: string | undefined,
    ok: (v: string | undefined) => boolean,
  ) => (ok(a) ? a : ok(b) ? b : undefined);

  test('for any responses the window is returned only when start, end and a strict IANA zone are usable', () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        dateArb,
        dateArb,
        maybe(zoneArb),
        maybe(zoneArb),
        (start, end, listedStart, listedEnd, ownZone, listedZone) => {
          const got: Event = { ...event, startDate: start, endDate: end, timezone: ownZone };
          const listed: Event = {
            ...event,
            startDate: listedStart,
            endDate: listedEnd,
            timezone: listedZone,
          };
          const goodZone = (z: string | undefined): boolean =>
            z !== undefined && GOOD_ZONES.includes(z);
          const s = first(start, listedStart, isoOk);
          const e = first(end, listedEnd, isoOk);
          const z = first(ownZone, listedZone, goodZone);
          const run = (): unknown => resolveEventWindow({ items: [listed] }, { event: got });
          if (
            s !== undefined &&
            e !== undefined &&
            z !== undefined &&
            Date.parse(s) < Date.parse(e)
          ) {
            expect(run()).toEqual({ start: s, end: e, timezone: z });
          } else {
            expect(run).toThrow(EventWindowError);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test('start, end and timezone each fall back to the matching ListEvents entry, never to another event', () => {
    const bare: Event = { ...event, startDate: '', endDate: 'bad', timezone: undefined };
    expect(resolveEventWindow({ items: [event] }, { event: bare })).toEqual({
      start: event.startDate,
      end: event.endDate,
      timezone: 'America/Los_Angeles',
    });
    expect(() =>
      resolveEventWindow({ items: [{ ...event, eventId: 'other' }] }, { event: bare }),
    ).toThrow(EventWindowError);
    expect(() => resolveEventWindow({ items: [] }, { event: bare })).toThrow(EventWindowError);
  });

  test('the start must be before the end', () => {
    for (const [startDate, endDate] of [
      ['2026-12-04T00:00:00-08:00', '2026-11-30T00:00:00-08:00'],
      ['2026-12-04T00:00:00-08:00', '2026-12-04T00:00:00-08:00'],
      ['2026-12-04T08:00:00Z', '2026-12-04T00:00:00-08:00'],
    ] as const) {
      expect(() =>
        resolveEventWindow({ items: [] }, { event: { ...event, startDate, endDate } }),
      ).toThrow(EventWindowError);
    }
  });

  test('a zone in the wrong case is refused even though Intl would accept it', () => {
    for (const timezone of ['america/los_angeles', 'AMERICA/LOS_ANGELES', 'Europe/PARIS', 'utc']) {
      expect(() => resolveEventWindow({ items: [] }, { event: { ...event, timezone } })).toThrow(
        EventWindowError,
      );
    }
    for (const timezone of ['America/Los_Angeles', 'Asia/Kolkata', 'UTC', 'Etc/GMT+8']) {
      expect(resolveEventWindow({ items: [] }, { event: { ...event, timezone } }).timezone).toBe(
        timezone,
      );
    }
  });

  test('the error carries no substituted value', () => {
    try {
      resolveEventWindow({ items: [] }, { event: { ...event, timezone: undefined } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EventWindowError);
      expect((error as Error).message).not.toContain('Los_Angeles');
    }
  });
});
