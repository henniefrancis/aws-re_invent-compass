import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { directionsUrl } from '../../src/lib/content/links';
import { toBoardViewModel } from '../../src/lib/board/board-state';
import {
  locate,
  LOCATE_OPTIONS,
  LOCATE_WATCHDOG_MS,
  type GeolocationLike,
} from '../../src/lib/board/locate';
import { nextSessionIndex } from '../../src/lib/board/next-session';
import { buildIndex, venuePoint } from '../../src/lib/board/venue-points';
import {
  DETOUR_FACTOR,
  ENTRY_ALLOWANCE_MINUTES,
  MAX_DISTANCE_METRES,
  METRES_PER_MINUTE,
  estimateWalk,
  haversineMetres,
} from '../../src/lib/board/walk-estimate';
import {
  IDLE_WALK,
  WALK_TEXT,
  locatingWalk,
  mapsAppFor,
  walkAnnouncement,
  walkForSession,
  walkFromHere,
  walkShown,
} from '../../src/lib/board/walk-view';
import { formatMinutesBefore } from '../../src/lib/time/time-format';
import { exampleBody, validated } from '../support/handoff-data';

const FORUM = { lat: 36.1189571, lon: -115.1661889 };
const VENETIAN = { lat: 36.1219124, lon: -115.1662288 };

describe('estimateWalk', () => {
  test('uses the straight line, the detour factor, the pace and the entry allowance', () => {
    const straight = haversineMetres(FORUM, VENETIAN);
    expect(Math.round(straight)).toBe(329);
    const expected = Math.ceil((straight * DETOUR_FACTOR) / METRES_PER_MINUTE);
    expect(estimateWalk(FORUM, VENETIAN)).toEqual({
      walkMinutes: expected,
      totalMinutes: expected + ENTRY_ALLOWANCE_MINUTES,
    });
    expect(expected).toBe(8);
  });

  test('is at least one minute, even at the venue', () => {
    expect(estimateWalk(VENETIAN, VENETIAN)).toEqual({ walkMinutes: 1, totalMinutes: 16 });
  });

  test('is refused beyond 20 km and given just inside it', () => {
    const north = (metres: number) => ({ lat: VENETIAN.lat + metres / 111_195, lon: VENETIAN.lon });
    expect(estimateWalk(north(MAX_DISTANCE_METRES + 500), VENETIAN)).toBe('tooFar');
    expect(estimateWalk(north(MAX_DISTANCE_METRES - 500), VENETIAN)).not.toBe('tooFar');
    expect(estimateWalk({ lat: Number.NaN, lon: 0 }, VENETIAN)).toBe('tooFar');
  });
});

describe('the detour factor matches the venue file', () => {
  test('is the venue pairs median (1.66) rounded to 1.6', () => {
    const file = JSON.parse(readFileSync(join(__dirname, '../../../data/venues.json'), 'utf8')) as {
      venues: { venue: { name: string; coordinates: { lat: number; lon: number } } }[];
      walkingTimes: { from: string; to: string; source: { basis: string } }[];
    };
    const ratios: number[] = [];
    for (const edge of file.walkingTimes) {
      const metres = /is (\d+) m on OpenStreetMap/.exec(edge.source.basis);
      const a = file.venues.find((v) => v.venue.name === edge.from);
      const b = file.venues.find((v) => v.venue.name === edge.to);
      if (metres !== null && a !== undefined && b !== undefined && edge.from < edge.to) {
        ratios.push(Number(metres[1]) / haversineMetres(a.venue.coordinates, b.venue.coordinates));
      }
    }
    ratios.sort((x, y) => x - y);
    expect(ratios).toHaveLength(15);
    expect(ratios[7]).toBeCloseTo(1.66, 1);
    expect(DETOUR_FACTOR).toBe(1.6);
  });
});

describe('venuePoint', () => {
  test('finds a venue by name or spelling variant, ignoring case', () => {
    expect(venuePoint('The Venetian')).toEqual(VENETIAN);
    expect(venuePoint(' venetian expo ')).toEqual(VENETIAN);
    expect(venuePoint('Caesars Forum')).toEqual(FORUM);
  });
  test('a venue without a point is left out of the index', () => {
    const index = buildIndex([
      { venue: { name: 'No Point Hall' } },
      { venue: { name: 'Pointed Hall', coordinates: VENETIAN }, aliases: [{ name: 'The Hall' }] },
    ]);
    expect([...index.keys()]).toEqual(['pointed hall', 'the hall']);
  });
  test('is null for an unknown venue', () => {
    expect(venuePoint('Nowhere Hall')).toBeNull();
  });
});

describe('nextSessionIndex', () => {
  const at = (startsAt: string) => ({ ...exampleBody().sessions[0]!, startsAt });
  const sessions = [
    at('2026-11-30T09:00:00-08:00'),
    at('2026-11-30T14:00:00-08:00'),
    at('2026-11-30T11:00:00-08:00'),
    at('2026-11-30T11:00:00-08:00'),
  ].map((s) => ({ ...s, venue: null, applePath: null }));
  test('is the soonest session that has not started, by its own offset', () => {
    // 10:00 in -08:00 is 18:00 UTC.
    expect(nextSessionIndex(sessions, Date.parse('2026-11-30T18:00:00Z'))).toBe(2);
    expect(nextSessionIndex(sessions, Date.parse('2026-11-30T16:00:00Z'))).toBe(0);
  });
  test('a session that starts now has started', () => {
    expect(nextSessionIndex(sessions, Date.parse('2026-11-30T19:00:00Z'))).toBe(1);
  });
  test('is -1 when every session is in the past or has a bad time', () => {
    expect(nextSessionIndex(sessions, Date.parse('2026-12-01T00:00:00Z'))).toBe(-1);
    expect(nextSessionIndex([{ ...sessions[0]!, startsAt: 'soon' }], 0)).toBe(-1);
  });
});

describe('formatMinutesBefore', () => {
  test('writes the earlier time in the offset of the text', () => {
    expect(formatMinutesBefore('2026-11-30T10:30:00-08:00', 38)).toBe('9:52 AM');
    expect(formatMinutesBefore('2026-11-30T00:10:00+02:00', 20)).toBe('11:50 PM');
    expect(formatMinutesBefore('2026-11-30T10:30:00Z', 30)).toBe('10:00 AM');
  });
  test('is not available for a bad date-time', () => {
    expect(formatMinutesBefore('nope', 5)).toBe('Time not available');
  });
});

describe('directionsUrl and the maps app', () => {
  test('names only the destination', () => {
    expect(directionsUrl('apple', VENETIAN)).toBe(
      'https://maps.apple.com/?daddr=36.121912,-115.166229&dirflg=w',
    );
    expect(directionsUrl('google', VENETIAN)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=36.121912,-115.166229&travelmode=walking',
    );
  });
  test('Apple Maps on an iPhone, Google Maps everywhere else', () => {
    expect(mapsAppFor('apple')).toBe('apple');
    expect(mapsAppFor('google')).toBe('google');
    expect(mapsAppFor('both')).toBe('google');
  });
});

describe('locate', () => {
  const fake = (
    act: (
      ok: Parameters<GeolocationLike['getCurrentPosition']>[0],
      fail: (e: { code: number }) => void,
    ) => void,
  ): GeolocationLike => ({ getCurrentPosition: (ok, fail) => act(ok, fail) });

  test('gives the position, asking once with a small maximum age', async () => {
    const spy = vi.fn((ok: Parameters<GeolocationLike['getCurrentPosition']>[0]) =>
      ok({ coords: { latitude: 36.1, longitude: -115.1 } }),
    );
    const result = await locate({ getCurrentPosition: spy });
    expect(result).toEqual({ ok: true, position: { lat: 36.1, lon: -115.1 } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(3);
    expect(LOCATE_OPTIONS.maximumAge).toBeLessThanOrEqual(30_000);
  });
  test('maps the failures', async () => {
    for (const [code, reason] of [
      [1, 'denied'],
      [2, 'unavailable'],
      [3, 'timeout'],
    ] as const) {
      expect(await locate(fake((_ok, fail) => fail({ code })))).toEqual({ ok: false, reason });
    }
  });
  test('is unavailable without geolocation, on a throw, or on a nonsense position', async () => {
    expect(await locate(undefined)).toEqual({ ok: false, reason: 'unavailable' });
    expect(
      await locate({
        getCurrentPosition: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual({ ok: false, reason: 'unavailable' });
    expect(await locate(fake((ok) => ok({ coords: { latitude: 99, longitude: 0 } })))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(
      await locate(fake((ok) => ok({ coords: { latitude: Number.NaN, longitude: 0 } }))),
    ).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('locate watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a prompt that is dismissed with no answer ends as unavailable, and a retap works', async () => {
    vi.useFakeTimers();
    const silent: GeolocationLike = { getCurrentPosition: () => undefined };
    const pending = locate(silent);
    await vi.advanceTimersByTimeAsync(LOCATE_WATCHDOG_MS);
    expect(await pending).toEqual({ ok: false, reason: 'unavailable' });
    const answered = locate({
      getCurrentPosition: (ok) => {
        ok({ coords: { latitude: 36.1, longitude: -115.1 } });
      },
    });
    expect(await answered).toEqual({ ok: true, position: { lat: 36.1, lon: -115.1 } });
  });

  test('an answer clears the watchdog', async () => {
    vi.useFakeTimers();
    await locate({
      getCurrentPosition: (ok) => {
        ok({ coords: { latitude: 36.1, longitude: -115.1 } });
      },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('walkFromHere', () => {
  const base = { ...exampleBody().sessions[0]!, applePath: null };
  const session = (venue: string | null) => ({ ...base, venue });
  const startsMs = Date.parse(base.startsAt);
  const SERIAL = base.serialNumber;
  const here = (position = FORUM) => vi.fn(() => Promise.resolve({ ok: true as const, position }));
  const estimate = async (wallet: 'both' | 'apple' = 'both', tapMs = startsMs - 3_600_000) => {
    const view = await walkFromHere(session('The Venetian'), here(), wallet, () => tapMs);
    if (view.kind !== 'estimate') {
      throw new Error('expected an estimate');
    }
    return view;
  };

  test('an estimate that names its session, the leave-by time and when it was worked out', async () => {
    expect(await estimate()).toEqual({
      kind: 'estimate',
      serial: SERIAL,
      summary: 'About 8 min walk.',
      // 10:30 minus 8 + 15 = 23 minutes.
      leaveBy: 'Leave by 10:07 AM.',
      // The tap was an hour before the start, written in the session's own offset.
      workedOut: 'Worked out at 9:30 AM.',
      note: WALK_TEXT.estimateNote,
      directions: {
        href: directionsUrl('google', VENETIAN),
        label: 'Directions',
        detail: ' to The Venetian in Google Maps (opens in a new tab)',
        caption: 'Google Maps gets your location only when you open this link.',
      },
    });
  });

  test('the Directions link holds only the two maps hosts and says it opens a new tab', async () => {
    const google = (await estimate('both')).directions;
    const apple = (await estimate('apple')).directions;
    expect(google.href.startsWith('https://www.google.com/maps/dir/')).toBe(true);
    expect(apple.href.startsWith('https://maps.apple.com/')).toBe(true);
    for (const link of [google, apple]) {
      expect(link.detail).toContain('(opens in a new tab)');
    }
  });

  test('says leave now when the leave-by time has already passed at the tap', async () => {
    expect((await estimate('both', startsMs - 23 * 60_000)).leaveBy).toBe('Leave now.');
    expect((await estimate('both', startsMs - 60_000)).leaveBy).toBe('Leave now.');
    expect((await estimate('both', startsMs - 23 * 60_000 - 1)).leaveBy).toBe('Leave by 10:07 AM.');
    const odd = await walkFromHere(
      { ...session('The Venetian'), startsAt: 'soon' },
      here(),
      'both',
      () => 0,
    );
    expect(odd).toMatchObject({
      leaveBy: 'Leave now.',
      workedOut: 'Worked out at Time not available.',
    });
  });

  test('no venue, or no map point: a message, and the location is never asked for', async () => {
    const locateSpy = here();
    expect(await walkFromHere(session(null), locateSpy, 'both', () => 0)).toEqual({
      kind: 'message',
      serial: SERIAL,
      text: WALK_TEXT.noVenue,
    });
    expect(await walkFromHere(session('Nowhere Hall'), locateSpy, 'both', () => 0)).toEqual({
      kind: 'message',
      serial: SERIAL,
      text: WALK_TEXT.noPoint,
    });
    expect(locateSpy).not.toHaveBeenCalled();
  });

  test('denied, unavailable and timeout each give their own message', async () => {
    for (const reason of ['denied', 'unavailable', 'timeout'] as const) {
      const view = await walkFromHere(
        session('The Venetian'),
        () => Promise.resolve({ ok: false, reason }),
        'both',
        () => 0,
      );
      expect(view).toEqual({ kind: 'message', serial: SERIAL, text: WALK_TEXT[reason] });
    }
  });

  test('more than 20 km away gives a message and no estimate', async () => {
    const view = await walkFromHere(
      session('The Venetian'),
      here({ lat: 37.7749, lon: -122.4194 }),
      'both',
      () => 0,
    );
    expect(view).toEqual({ kind: 'message', serial: SERIAL, text: WALK_TEXT.tooFar });
  });

  test('the messages are plain and carry no dash characters', () => {
    for (const text of Object.values(WALK_TEXT)) {
      expect(text).not.toContain(String.fromCharCode(0x2013));
      expect(text).not.toContain(String.fromCharCode(0x2014));
    }
  });

  test('the privacy line says what Compass does and what the phone may do', () => {
    expect(WALK_TEXT.privacy).toBe(
      'Compass does not send your location anywhere or save it. Your phone may use its own location service to find it.',
    );
  });
});

describe('what is shown under the next session', () => {
  const OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const base = { ...exampleBody().sessions[0]!, applePath: null };
  const worked = () =>
    walkFromHere(
      { ...base, venue: 'The Venetian' },
      () => Promise.resolve({ ok: true, position: FORUM }),
      'both',
      () => Date.parse(base.startsAt) - 3_600_000,
    );

  test('a view is shown only under the session it was worked out for', async () => {
    const view = await worked();
    expect(walkShown(view, base.serialNumber).kind).toBe('estimate');
    expect(walkShown(view, OTHER)).toEqual({ kind: 'idle' });
    expect(walkShown(view, null)).toEqual({ kind: 'idle' });
    expect(walkForSession(view, OTHER)).toBe(IDLE_WALK);
    expect(walkForSession(IDLE_WALK, base.serialNumber)).toBe(IDLE_WALK);
  });

  test('locating, message and idle views, and what a screen reader hears', async () => {
    const s = base.serialNumber;
    expect(walkShown(locatingWalk(s), s)).toEqual({ kind: 'locating' });
    expect(walkShown({ kind: 'message', serial: s, text: 'No.' }, s)).toEqual({
      kind: 'message',
      text: 'No.',
    });
    expect(walkShown(IDLE_WALK, s)).toEqual({ kind: 'idle' });
    expect(walkAnnouncement({ kind: 'idle' })).toBe('');
    expect(walkAnnouncement({ kind: 'locating' })).toBe(WALK_TEXT.locating);
    expect(walkAnnouncement({ kind: 'message', text: 'No.' })).toBe('No.');
    expect(walkAnnouncement(walkShown(await worked(), s))).toBe(
      `About 8 min walk. Leave by 10:07 AM. Worked out at 9:30 AM. ${WALK_TEXT.estimateNote}`,
    );
  });
});

describe('the view model marks the next session only', () => {
  const handoff = validated(exampleBody());
  const before = Date.parse('2026-11-30T09:00:00-08:00');

  test('the first session that has not started is next', () => {
    const vm = toBoardViewModel({ kind: 'ready', handoff }, before);
    expect(vm.sessions.map((s) => s.isNext)).toEqual([true, false]);
    expect(vm.nextSession?.sessionCode).toBe('DAT302');
  });
  test('after the first has started the second is next', () => {
    const vm = toBoardViewModel(
      { kind: 'ready', handoff },
      Date.parse('2026-11-30T11:00:00-08:00'),
    );
    expect(vm.sessions.map((s) => s.isNext)).toEqual([false, true]);
  });
  test('when every session is past nothing is next', () => {
    const vm = toBoardViewModel({ kind: 'ready', handoff }, Date.parse('2026-12-05T00:00:00Z'));
    expect(vm.sessions.some((s) => s.isNext)).toBe(false);
    expect(vm.nextSession).toBeNull();
  });
  test('other states have no next session', () => {
    expect(toBoardViewModel({ kind: 'expired' }, 0).nextSession).toBeNull();
  });
});
