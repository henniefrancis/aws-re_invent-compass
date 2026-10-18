import { describe, expect, test } from 'vitest';
import type { PersonalTime } from '@compass/contracts';
import { buildItinerary, buildPassFor } from '../../src/passes/itinerary-builder.js';
import type { ScheduleView } from '../../src/passes/itinerary-builder.js';
import { buildPass } from '../../src/passes/pass-builder.js';
import { PassError } from '../../src/passes/redaction.js';
import { WINDOW, fakeConnections, makeSession } from './support.js';

// Review round 1, QA M1: buildPassFor and buildItinerary, so consumers do not rebuild the
// ordering and neighbour logic.

const MORNING = makeSession({
  sessionId: 's-a',
  code: 'DVT301',
  title: 'Morning session',
  venue: 'Venetian',
  startsAt: '2026-12-01T10:00:00-08:00',
  endsAt: '2026-12-01T11:00:00-08:00',
});
const AFTERNOON = makeSession({
  sessionId: 's-b',
  code: 'NET204',
  title: 'Afternoon session',
  venue: 'Caesars Forum',
  startsAt: '2026-12-01T13:00:00-08:00',
  endsAt: '2026-12-01T14:00:00-08:00',
});
const EVENING = makeSession({
  sessionId: 's-c',
  code: 'OPS101',
  title: 'Evening session',
  venue: 'MGM Grand',
  startsAt: '2026-12-01T15:00:00-08:00',
  endsAt: '2026-12-01T16:00:00-08:00',
});
const LUNCH: PersonalTime = {
  personalTimeId: 'pt-1',
  title: 'Lunch',
  description: '',
  location: 'Lounge',
  startDateTime: '2026-12-01T11:30:00-08:00',
  endDateTime: '2026-12-01T12:30:00-08:00',
};

/** Deliberately out of order, with a duplicate code and sessions that cannot be placed. */
const SCHEDULE: ScheduleView = {
  sessions: [
    EVENING,
    MORNING,
    AFTERNOON,
    makeSession({ ...AFTERNOON, sessionId: 's-dup', title: 'Duplicate of the afternoon' }),
    makeSession({ sessionId: 's-n', code: 'NOTIME1', startsAt: undefined, endsAt: undefined }),
    makeSession({ sessionId: 's-e', code: 'NOEND01', endsAt: undefined }),
  ],
  personalTime: [LUNCH],
};

const WALKS = {
  'Lounge|Caesars Forum': 7,
  'Caesars Forum|MGM Grand': 15,
  'Venetian|Caesars Forum': 11,
  'Venetian|Lounge': 3,
};

describe('Feature: boarding-passes, buildItinerary (QA M1)', () => {
  test('commitments are in start order, with walks from the commitment before each reserved session', () => {
    const itinerary = buildItinerary(SCHEDULE, fakeConnections(WALKS));
    expect(itinerary.commitments.map((entry) => entry.commitment.startsAt)).toEqual([
      MORNING.startsAt,
      LUNCH.startDateTime,
      AFTERNOON.startsAt,
      EVENING.startsAt,
    ]);
    expect(itinerary.commitments.map((entry) => entry.walkMinutes)).toEqual([
      undefined,
      undefined,
      7,
      15,
    ]);
    expect(itinerary.commitments.map((entry) => entry.commitment.kind)).toEqual([
      'reservedSession',
      'personalTime',
      'reservedSession',
      'reservedSession',
    ]);
    expect(itinerary.commitments[1]?.commitment).toMatchObject({
      personalTimeId: 'pt-1',
      location: 'Lounge',
      title: 'Lunch',
    });
    expect(itinerary.commitments[3]?.commitment).toMatchObject({
      sessionId: 's-c',
      venue: 'MGM Grand',
    });
  });

  test('an unknown walk is left out and a known one is clamped to 0 to 90', () => {
    const unknown = buildItinerary(SCHEDULE, fakeConnections({}));
    expect(unknown.commitments.every((entry) => entry.walkMinutes === undefined)).toBe(true);
    const clamped = buildItinerary(
      SCHEDULE,
      fakeConnections({ 'Lounge|Caesars Forum': 400, 'Caesars Forum|MGM Grand': -4 }),
    );
    expect(clamped.commitments.map((entry) => entry.walkMinutes)).toEqual([
      undefined,
      undefined,
      90,
      0,
    ]);
  });

  test('a session with no venue is looked up with an empty venue', () => {
    const connections = fakeConnections({});
    buildItinerary(
      {
        sessions: [MORNING, makeSession({ ...AFTERNOON, venue: undefined })],
        personalTime: [],
      },
      connections,
    );
    expect(connections.calls).toEqual(['Venetian|']);
  });

  test('commitments that start together are ordered by their end time', () => {
    const long = makeSession({
      ...MORNING,
      sessionId: 's-l',
      code: 'LONG01',
      endsAt: '2026-12-01T12:00:00-08:00',
    });
    const itinerary = buildItinerary(
      { sessions: [long, MORNING], personalTime: [] },
      fakeConnections(),
    );
    expect(itinerary.commitments.map((entry) => entry.commitment.endsAt)).toEqual([
      MORNING.endsAt,
      long.endsAt,
    ]);
  });

  test('a reserved session before another with no venue is looked up with an empty place', () => {
    const connections = fakeConnections({});
    buildItinerary(
      { sessions: [makeSession({ ...MORNING, venue: undefined }), AFTERNOON], personalTime: [] },
      connections,
    );
    expect(connections.calls).toEqual(['|Caesars Forum']);
  });

  test('a personal time before a reserved session with no location is looked up with an empty place', () => {
    const connections = fakeConnections({});
    buildItinerary(
      {
        sessions: [AFTERNOON],
        personalTime: [{ ...LUNCH, location: undefined }],
      },
      connections,
    );
    expect(connections.calls).toEqual(['|Caesars Forum']);
  });

  test('an empty schedule is an empty itinerary and a bad personal time is refused', () => {
    expect(
      buildItinerary({ sessions: [], personalTime: [] }, fakeConnections()).commitments,
    ).toEqual([]);
    expect(() =>
      buildItinerary(
        { sessions: [], personalTime: [{ ...LUNCH, startDateTime: 'noon-ish' }] },
        fakeConnections(),
      ),
    ).toThrow(PassError);
  });
});

describe('Feature: boarding-passes, buildPassFor (QA M1)', () => {
  const deps = (table: Record<string, number | undefined> = WALKS, attendeeName?: string) => ({
    connections: fakeConnections(table),
    eventWindow: WINDOW,
    attendeeName,
  });

  test('the middle session gets the previous commitment and the next reserved session as neighbours', () => {
    const fields = buildPassFor(SCHEDULE, deps())('NET204');
    expect(fields.walkFromPrevious).toEqual({ minutes: 7, fromVenue: 'Lounge' });
    expect(fields.nextConnection).toEqual({
      sessionCode: 'OPS101',
      startsAt: EVENING.startsAt,
      venue: 'MGM Grand',
      walkMinutes: 15,
    });
  });

  test('the first session has no previous, and its next skips the layover', () => {
    const fields = buildPassFor(SCHEDULE, deps())('DVT301');
    expect(fields.walkFromPrevious).toBeUndefined();
    expect(fields.nextConnection).toEqual({
      sessionCode: 'NET204',
      startsAt: AFTERNOON.startsAt,
      venue: 'Caesars Forum',
      walkMinutes: 11,
    });
  });

  test('the last session has no next connection', () => {
    const fields = buildPassFor(SCHEDULE, deps())('OPS101');
    expect(fields.nextConnection).toBeUndefined();
    expect(fields.walkFromPrevious).toEqual({ minutes: 15, fromVenue: 'Caesars Forum' });
  });

  test('a next session with no venue is looked up with an empty venue', () => {
    const connections = fakeConnections({});
    buildPassFor(
      { sessions: [MORNING, makeSession({ ...AFTERNOON, venue: undefined })], personalTime: [] },
      { connections, eventWindow: WINDOW },
    )('DVT301');
    expect(connections.calls).toEqual(['Venetian|']);
  });

  test('the result is what buildPass gives for the same neighbours, and the name is passed on', () => {
    const viaHelper = buildPassFor(SCHEDULE, deps(WALKS, 'First Timer'))('NET204');
    const direct = buildPass(
      {
        session: AFTERNOON,
        previous: {
          commitment: {
            kind: 'personalTime',
            personalTimeId: 'pt-1',
            title: 'Lunch',
            location: 'Lounge',
            startsAt: LUNCH.startDateTime,
            endsAt: LUNCH.endDateTime,
          },
        },
        next: { sessionCode: 'OPS101', startsAt: EVENING.startsAt as string, venue: 'MGM Grand' },
        attendeeName: 'First Timer',
        eventWindow: WINDOW,
      },
      { connections: fakeConnections(WALKS) },
    ).fields;
    expect(viaHelper).toEqual(direct);
    expect(viaHelper.attendeeName).toBe('First Timer');
  });

  test('a code that is not in the schedule is refused, and a session that cannot be placed fails like buildPass', () => {
    const build = buildPassFor(SCHEDULE, deps());
    let unknown: unknown;
    try {
      build('NOPE999');
    } catch (error) {
      unknown = error;
    }
    expect((unknown as PassError).code).toBe('builder.unknown_session');
    for (const code of ['NOTIME1', 'NOEND01']) {
      let caught: unknown;
      try {
        build(code);
      } catch (error) {
        caught = error;
      }
      expect((caught as PassError).code).toBe('builder.invalid_input');
    }
  });
});

describe('Feature: boarding-passes, neighbours only count within 12 hours (S2 rule)', () => {
  const at = (code: string, venue: string, start: string, end: string) =>
    makeSession({ sessionId: `s-${code}`, code, venue, startsAt: start, endsAt: end });
  const TUESDAY = at('TUE101', 'Wynn', '2026-12-01T10:00:00-08:00', '2026-12-01T11:00:00-08:00');
  const FRIDAY = at('FRI101', 'Venetian', '2026-12-04T10:00:00-08:00', '2026-12-04T11:00:00-08:00');
  const FRIDAY_LATE = at(
    'FRI102',
    'MGM Grand',
    '2026-12-04T12:00:00-08:00',
    '2026-12-04T13:00:00-08:00',
  );
  const table = { 'Wynn|Venetian': 5, 'Venetian|MGM Grand': 9 };
  const deps = (walks = fakeConnections(table)) => ({ connections: walks, eventWindow: WINDOW });

  test('a session on another day is not the previous stop or the next connection', () => {
    const schedule: ScheduleView = { sessions: [TUESDAY, FRIDAY], personalTime: [] };
    const friday = buildPassFor(schedule, deps())('FRI101');
    expect(friday.walkFromPrevious).toBeUndefined();
    const tuesday = buildPassFor(schedule, deps())('TUE101');
    expect(tuesday.nextConnection).toBeUndefined();
    expect(
      buildItinerary(schedule, fakeConnections(table)).commitments.map((e) => e.walkMinutes),
    ).toEqual([undefined, undefined]);
  });

  test('the same day still connects, and the lookup is not even asked across days', () => {
    const walks = fakeConnections(table);
    const schedule: ScheduleView = { sessions: [TUESDAY, FRIDAY, FRIDAY_LATE], personalTime: [] };
    const friday = buildPassFor(schedule, deps(walks))('FRI101');
    expect(friday.walkFromPrevious).toBeUndefined();
    expect(friday.nextConnection).toMatchObject({ sessionCode: 'FRI102', walkMinutes: 9 });
    expect(walks.calls).not.toContain('Wynn|Venetian');
  });

  test('exactly 12 hours apart connects, one millisecond more does not, and midnight is crossed freely', () => {
    const base = at('AAA101', 'Wynn', '2026-12-01T08:00:00-08:00', '2026-12-01T09:00:00-08:00');
    const exactly = at(
      'BBB101',
      'Venetian',
      '2026-12-01T21:00:00-08:00',
      '2026-12-01T22:00:00-08:00',
    );
    const justOver = at(
      'CCC101',
      'Venetian',
      '2026-12-01T21:00:00.001-08:00',
      '2026-12-01T22:00:00-08:00',
    );
    const evening = at('EEE101', 'Wynn', '2026-12-01T20:00:00-08:00', '2026-12-01T21:00:00-08:00');
    const acrossMidnight = at(
      'DDD101',
      'Venetian',
      '2026-12-02T02:00:00-08:00',
      '2026-12-02T03:00:00-08:00',
    );
    const pass = (other: typeof exactly, code: string) =>
      buildPassFor({ sessions: [base, other], personalTime: [] }, deps())(code);
    expect(pass(exactly, 'BBB101').walkFromPrevious).toEqual({ minutes: 5, fromVenue: 'Wynn' });
    expect(pass(justOver, 'CCC101').walkFromPrevious).toBeUndefined();
    expect(
      buildPassFor({ sessions: [evening, acrossMidnight], personalTime: [] }, deps())('DDD101')
        .walkFromPrevious,
    ).toEqual({ minutes: 5, fromVenue: 'Wynn' });
    expect(
      buildPassFor({ sessions: [base, exactly], personalTime: [] }, deps())('AAA101')
        .nextConnection,
    ).toBeDefined();
    expect(
      buildPassFor({ sessions: [base, justOver], personalTime: [] }, deps())('AAA101')
        .nextConnection,
    ).toBeUndefined();
  });

  test('a far-away layover before a session is not its previous stop either', () => {
    const lunch = {
      ...LUNCH,
      startDateTime: '2026-12-01T11:30:00-08:00',
      endDateTime: '2026-12-01T12:30:00-08:00',
    };
    const schedule: ScheduleView = { sessions: [FRIDAY], personalTime: [lunch] };
    expect(buildPassFor(schedule, deps())('FRI101').walkFromPrevious).toBeUndefined();
    expect(buildItinerary(schedule, fakeConnections()).commitments[1]?.walkMinutes).toBeUndefined();
  });
});
