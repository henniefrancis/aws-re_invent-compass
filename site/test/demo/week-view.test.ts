import type { Commitment, NormalisedSession } from '@compass/contracts';
import { describe, expect, test } from 'vitest';
import { DEMO_SESSIONS } from '../../src/lib/demo/demo-catalog';
import { createDemoRuntime } from '../../src/lib/demo/demo-deps';
import { EMPTY_DEMO, type DemoState } from '../../src/lib/demo/demo-state';
import {
  VENUE_NOT_PUBLISHED,
  boardingText,
  buildCatalogView,
  buildWeekView,
  gateText,
  timezoneStatement,
} from '../../src/lib/demo/week-view';
import {
  commitmentOfSession,
  commitmentRef,
  dayOfIso,
  sortCommitments,
  toScheduleInput,
} from '../../src/lib/demo/schedule';
import { createFakeEngine } from '../doubles/rules-double';
import { VENUE_DATA, makeDeps, run } from '../support/demo-harness';

const deps = makeDeps();
const starter = run([{ type: 'loadStarter' }], deps);
const byId = (id: string): NormalisedSession =>
  DEMO_SESSIONS.find((s) => s.sessionId === id) as NormalisedSession;

describe('text helpers', () => {
  test('the gate is venue and room, the venue alone, or "Venue not published"', () => {
    expect(gateText('Encore', 'Room 1')).toBe('Encore, Room 1');
    expect(gateText('Encore', undefined)).toBe('Encore');
    expect(gateText(undefined, undefined)).toBe(VENUE_NOT_PUBLISHED);
    expect(gateText(undefined, 'Room 1')).toBe('Venue not published');
  });

  test('boarding text is the closing time, or the reason the engine gives', () => {
    expect(boardingText({ status: 'closes', at: '2026-12-04T10:20:00-08:00', reason: 'r' })).toBe(
      'Seat released at 10:20 AM',
    );
    expect(boardingText({ status: 'notApplicable', reason: 'No reservation needed.' })).toBe(
      'No reservation needed.',
    );
    expect(boardingText({ status: 'unknown', reason: 'No start time.' })).toBe('No start time.');
  });

  test('the timezone is stated once, with its offset', () => {
    expect(timezoneStatement()).toBe('All times are in America/Los_Angeles (UTC-08:00).');
  });
});

describe('schedule helpers', () => {
  test('commitments are keyed, sorted and turned into a schedule input', () => {
    const layover: Commitment = {
      kind: 'personalTime',
      title: 'Layover',
      startsAt: '2026-12-01T13:00:00-08:00',
      endsAt: '2026-12-01T13:30:00-08:00',
    };
    expect(commitmentRef(layover)).toBe('Layover-2026-12-01T13:00:00-08:00');
    expect(commitmentRef({ ...layover, personalTimeId: 'x' })).toBe('x');
    expect(commitmentRef(commitmentOfSession(byId('syn-003')))).toBe('syn-003');
    const sorted = sortCommitments([
      commitmentOfSession(byId('syn-002')),
      layover,
      commitmentOfSession(byId('syn-003')),
    ]);
    expect(sorted.map(commitmentRef)).toEqual([
      'syn-003',
      'Layover-2026-12-01T13:00:00-08:00',
      'syn-002',
    ]);
    const sameTime = sortCommitments([
      commitmentOfSession(byId('syn-046')),
      commitmentOfSession(byId('syn-003')),
    ]);
    expect(sameTime.map(commitmentRef)).toEqual(['syn-003', 'syn-046']);
    const input = toScheduleInput(sorted, deps.catalog);
    expect(Object.keys(input.sessions).sort()).toEqual(['syn-002', 'syn-003']);
    expect(toScheduleInput([commitmentOfSession(byId('syn-003'))], new Map()).sessions).toEqual({});
    expect(dayOfIso('2026-12-04T10:00:00-08:00')).toBe('2026-12-04');
  });
});

describe('catalog view', () => {
  test('groups the sessions by event day with every field of Requirement 8.1', () => {
    const view = buildCatalogView(EMPTY_DEMO, deps);
    expect(view.map((d) => d.heading)).toEqual(['Tuesday 1 December', 'Friday 4 December']);
    expect(view.flatMap((d) => d.sessions)).toHaveLength(DEMO_SESSIONS.length);
    const keynote = view[0]?.sessions.find((s) => s.sessionId === 'syn-120');
    expect(keynote).toMatchObject({
      code: 'KEY259',
      type: 'Keynote',
      level: '400',
      gate: 'The Venetian, Main hall',
      timeRange: '9:00 AM to 10:30 AM',
      boarding: 'KEY259 needs no reservation.',
      reservable: false,
      inWeek: false,
    });
    const noVenue = view[1]?.sessions.find((s) => s.sessionId === 'syn-008');
    expect(noVenue?.gate).toBe('Venue not published');
    const clash = view[1]?.sessions.find((s) => s.sessionId === 'syn-026');
    expect(clash?.boarding).toBe('Seat released at 12:50 PM');
  });

  test('personal time in the week is not a held session', () => {
    const state: DemoState = {
      ...EMPTY_DEMO,
      commitments: [
        {
          kind: 'personalTime',
          title: 'Layover',
          startsAt: '2026-12-04T14:00:00-08:00',
          endsAt: '2026-12-04T14:30:00-08:00',
        },
      ],
    };
    expect(
      buildCatalogView(state, deps)
        .flatMap((d) => d.sessions)
        .some((s) => s.inWeek),
    ).toBe(false);
  });

  test('marks the sessions that are already in the week', () => {
    const view = buildCatalogView(starter, deps).flatMap((d) => d.sessions);
    expect(
      view
        .filter((s) => s.inWeek)
        .map((s) => s.sessionId)
        .sort(),
    ).toEqual(['syn-002', 'syn-003', 'syn-024', 'syn-028']);
  });

  test('shows nothing for a type or level that is not published', () => {
    const bare: NormalisedSession = { ...byId('syn-003'), missingFields: ['type', 'level'] };
    delete (bare as { type?: string }).type;
    delete (bare as { level?: string }).level;
    const custom = createDemoRuntime(createFakeEngine(), VENUE_DATA);
    expect(custom).not.toBeNull();
    const view = buildCatalogView(EMPTY_DEMO, {
      ...(custom as NonNullable<typeof custom>),
      catalog: new Map([['syn-003', bare]]),
    });
    expect(view[0]?.sessions[0]).toMatchObject({ type: null, level: null });
  });
});

describe('week view', () => {
  test('is empty for an empty week', () => {
    expect(buildWeekView(EMPTY_DEMO, deps)).toEqual([]);
  });

  test('groups the week by day with boarding, gate and time range for each item', () => {
    const view = buildWeekView(starter, deps);
    expect(view.map((d) => d.heading)).toEqual(['Tuesday 1 December', 'Friday 4 December']);
    expect(view[0]?.items[0]).toEqual({
      ref: 'syn-003',
      kind: 'reservedSession',
      code: 'AIM321',
      title: 'Identity and access: Deep dive',
      label: 'AIM321',
      gate: 'MGM Grand, Room 118',
      timeRange: '11:30 AM to 1:00 PM',
      boarding: 'Seat released at 11:20 AM',
    });
  });

  test('states each connection in words with the engine reason and the walk', () => {
    const view = buildWeekView(starter, deps);
    expect(view[0]?.connections).toEqual([
      {
        classification: 'impossible',
        text: 'Impossible: AIM321 to BWP213. Walk from MGM Grand to MGM Grand is about 10 minutes (estimate), with -20 spare.',
        walk: 'Walk plus buffer: 10 minutes.',
      },
      {
        classification: 'impossible',
        text: 'Impossible: BWP213 to DAT204. Walk from MGM Grand to Wynn is about 40 minutes (estimate), with -20 spare.',
        walk: 'Walk plus buffer: 40 minutes.',
      },
    ]);
    expect(view[1]?.connections).toEqual([]);
  });

  test('shows the layover report with its suggested blocks', () => {
    const day = buildWeekView(starter, deps)[0];
    expect(day?.layovers.lines).toEqual(['Only 0 free minutes in the meal window on 2026-12-01.']);
    expect(day?.layovers.suggestions).toEqual([
      {
        start: '2026-12-01T14:00:00-08:00',
        end: '2026-12-01T14:30:00-08:00',
        label: '2:00 PM to 2:30 PM: A free gap just after the meal window.',
      },
    ]);
  });

  test('shows the reason when the engine cannot judge a day, and hides nothing', () => {
    const unknown = makeDeps({
      connectionsForDay: () => ({ status: 'unknown', reason: 'The event timezone is not set.' }),
      checkLayovers: () => ({ status: 'unknown', reason: 'The meal window is unknown.' }),
    });
    const day = buildWeekView(starter, unknown)[0];
    expect(day?.connections).toEqual([
      {
        classification: 'unknown',
        text: 'The event timezone is not set.',
        walk: 'Walk time unknown.',
      },
    ]);
    expect(day?.layovers).toEqual({ lines: ['The meal window is unknown.'], suggestions: [] });
    expect(day?.items).toHaveLength(3);
  });

  test('an unknown connection class keeps the engine reason and says the walk is unknown', () => {
    const scripted = makeDeps({
      connectionsForDay: () => ({
        status: 'ok',
        connections: [
          { from: 'A', to: 'B', result: { classification: 'unknown', reason: 'No venue for B.' } },
        ],
        skipped: [],
      }),
    });
    expect(buildWeekView(starter, scripted)[0]?.connections).toEqual([
      {
        classification: 'unknown',
        text: 'Unknown: A to B. No venue for B.',
        walk: 'Walk time unknown.',
      },
    ]);
  });

  test('a day the layover report leaves out has no lines, and a placement reason is shown', () => {
    const empty = makeDeps({ checkLayovers: () => ({ status: 'ok', days: [], skipped: [] }) });
    expect(buildWeekView(starter, empty)[0]?.layovers).toEqual({ lines: [], suggestions: [] });
    const noRoom = makeDeps({
      checkLayovers: () => ({
        status: 'ok',
        days: [
          {
            day: '2026-12-01',
            mealLayoverMissing: true,
            freeMealMinutes: 0,
            reasons: ['No meal time.'],
            suggestions: [],
            noPlacementReason: 'No gap is long enough.',
          },
        ],
        skipped: [],
      }),
    });
    expect(buildWeekView(starter, noRoom)[0]?.layovers.lines).toEqual([
      'No meal time.',
      'No gap is long enough.',
    ]);
  });

  test('items carry a label for their accessible names: the code, or the title with the start time', () => {
    const state: DemoState = {
      ...EMPTY_DEMO,
      commitments: [
        {
          kind: 'personalTime',
          title: 'Layover',
          startsAt: '2026-12-01T12:00:00-08:00',
          endsAt: '2026-12-01T12:30:00-08:00',
        },
        {
          kind: 'personalTime',
          title: 'Layover',
          startsAt: '2026-12-01T13:00:00-08:00',
          endsAt: '2026-12-01T13:30:00-08:00',
        },
        {
          kind: 'reservedSession',
          sessionId: 'syn-002',
          startsAt: '2026-12-01T14:30:00-08:00',
          endsAt: '2026-12-01T16:00:00-08:00',
        },
        {
          kind: 'reservedSession',
          sessionId: 'gone',
          startsAt: '2026-12-01T17:00:00-08:00',
          endsAt: '2026-12-01T17:30:00-08:00',
          title: 'Titled',
        },
        {
          kind: 'reservedSession',
          sessionId: 'gone2',
          startsAt: '2026-12-01T18:00:00-08:00',
          endsAt: '2026-12-01T18:30:00-08:00',
        },
      ],
    };
    const items = buildWeekView(state, deps)[0]?.items ?? [];
    expect(items.map((i) => i.label)).toEqual([
      'Layover at 12:00 PM',
      'Layover at 1:00 PM',
      'DAT204',
      'Titled',
      'gone2',
    ]);
    expect(new Set(items.map((i) => i.label)).size).toBe(items.length);
  });

  test('personal time and sessions missing from the catalog are shown without invented fields', () => {
    const layover: Commitment = {
      kind: 'personalTime',
      title: 'Layover',
      startsAt: '2026-12-01T13:00:00-08:00',
      endsAt: '2026-12-01T13:30:00-08:00',
    };
    const stray: Commitment = {
      kind: 'reservedSession',
      sessionId: 'gone',
      startsAt: '2026-12-01T15:00:00-08:00',
      endsAt: '2026-12-01T16:00:00-08:00',
    };
    const titled: Commitment = {
      ...stray,
      sessionId: 'gone2',
      title: 'Titled',
      venue: 'Encore',
      startsAt: '2026-12-01T16:30:00-08:00',
      endsAt: '2026-12-01T17:00:00-08:00',
    };
    const located: Commitment = {
      ...layover,
      personalTimeId: 'p',
      location: 'Wynn',
      startsAt: '2026-12-01T17:30:00-08:00',
      endsAt: '2026-12-01T18:00:00-08:00',
    };
    const state: DemoState = { ...EMPTY_DEMO, commitments: [layover, stray, titled, located] };
    const items = buildWeekView(state, deps)[0]?.items;
    expect(items?.[0]).toMatchObject({
      kind: 'personalTime',
      code: null,
      gate: 'Venue not published',
      boarding: 'Personal time. No boarding.',
      timeRange: '1:00 PM to 1:30 PM',
    });
    expect(items?.[1]).toMatchObject({
      code: null,
      title: 'gone',
      gate: 'Venue not published',
      boarding: 'Boarding time not available.',
    });
    expect(items?.[2]).toMatchObject({ title: 'Titled', gate: 'Encore' });
    expect(items?.[3]).toMatchObject({ gate: 'Wynn' });
  });
});
