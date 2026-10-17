// Demo catalog and demo event (showcase-site, Component 6).
//
// DEMO_SESSIONS is a committed copy of 15 records of fixtures/synthetic/catalog.json (made-up
// data, ADR-016), each normalised to the NormalisedSession shape. Nothing was edited by hand:
// a provenance test compares every entry with the S1 normaliseSession of the synthetic record
// that has the same id, and checks that the scenarios of Requirement 7 criterion 3 are present.
//
// Only sessions at the six official 2026 venues (or with no venue at all) are used, so the
// rules engine can judge every walk. Sessions at other venues were left out on purpose.
//
// Scenarios in this set:
//   - overlap on one day: syn-003 and syn-046 (2026-12-01);
//   - a held session with a true repeat that fits: syn-024 (BWP213, Tuesday 13:00, MGM Grand,
//     seats available) and its repeat syn-025 (BWP213-R, Friday 11:30, The Venetian, seats
//     available); a second pair is syn-068 (SEC431) and syn-069 (SEC431-R2);
//   - the guided clash: syn-076 (ARC228) overlaps syn-024 on Tuesday;
//   - consecutive sessions at different venues: syn-047 (Encore) then syn-026 (MGM Grand);
//   - sessions that cannot be reserved: syn-120 (keynote) and syn-087 (breakout);
//   - a missing meal layover: syn-003 then syn-024 fill the meal window on 2026-12-01;
//   - a session with no venue, shown as "Venue not published": syn-008.

import type { NormalisedSession } from '@compass/contracts';

export interface DemoEvent {
  /** The event timezone, from the sessionTime.timezone of the copied records. */
  readonly timezone: string;
  /** The fixed demo instant: 18:00 event local time on the day before the first demo day. */
  readonly now: string;
  /** 00:00 event local time on the first demo day. */
  readonly windowStart: string;
  /** 23:59 event local time on the last demo day. */
  readonly windowEnd: string;
}

export const DEMO_EVENT: DemoEvent = {
  timezone: 'America/Los_Angeles',
  now: '2026-11-30T18:00:00-08:00',
  windowStart: '2026-12-01T00:00:00-08:00',
  windowEnd: '2026-12-04T23:59:00-08:00',
};

/** The synthetic catalog ids of the demo sessions, in the same order as DEMO_SESSIONS. */
export const DEMO_SOURCE_IDS: readonly string[] = [
  'syn-068',
  'syn-120',
  'syn-003',
  'syn-046',
  'syn-024',
  'syn-076',
  'syn-002',
  'syn-063',
  'syn-087',
  'syn-008',
  'syn-025',
  'syn-047',
  'syn-026',
  'syn-028',
  'syn-069',
];

export const DEMO_SESSIONS: readonly NormalisedSession[] = [
  {
    sessionId: 'syn-068',
    code: 'SEC431',
    title: 'Identity and access: Hands on workshop',
    type: 'Workshop',
    level: '400',
    venue: 'Encore',
    room: 'Room 126',
    startsAt: '2026-12-01T08:30:00-08:00',
    endsAt: '2026-12-01T10:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'veryLimited',
    missingFields: [],
  },
  {
    sessionId: 'syn-120',
    code: 'KEY259',
    title: 'Innovation Keynote: Builders at scale',
    type: 'Keynote',
    level: '400',
    venue: 'The Venetian',
    room: 'Main hall',
    startsAt: '2026-12-01T09:00:00-08:00',
    endsAt: '2026-12-01T10:30:00-08:00',
    isAllDay: false,
    isReservable: false,
    seatAvailability: 'walkUp',
    missingFields: [],
  },
  {
    sessionId: 'syn-003',
    code: 'AIM321',
    title: 'Identity and access: Deep dive',
    type: 'Workshop',
    level: '400',
    venue: 'MGM Grand',
    room: 'Room 118',
    startsAt: '2026-12-01T11:30:00-08:00',
    endsAt: '2026-12-01T13:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'veryLimited',
    missingFields: [],
  },
  {
    sessionId: 'syn-046',
    code: 'ANT148',
    title: 'Cost optimisation: A builder guide',
    type: 'Builders session',
    level: '300',
    venue: 'Caesars Forum',
    room: 'Room 102',
    startsAt: '2026-12-01T11:30:00-08:00',
    endsAt: '2026-12-01T13:30:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'veryLimited',
    missingFields: [],
  },
  {
    sessionId: 'syn-024',
    code: 'BWP213',
    title: 'Data lakes: A builder guide',
    type: 'Workshop',
    level: '400',
    venue: 'MGM Grand',
    room: 'Room 114',
    startsAt: '2026-12-01T13:00:00-08:00',
    endsAt: '2026-12-01T14:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'available',
    missingFields: [],
  },
  {
    sessionId: 'syn-076',
    code: 'ARC228',
    title: 'Zero-downtime deploys: Deep dive',
    type: 'Code talk',
    level: '400',
    venue: 'The Venetian',
    room: 'Room 109',
    startsAt: '2026-12-01T13:00:00-08:00',
    endsAt: '2026-12-01T14:30:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'veryLimited',
    missingFields: [],
  },
  {
    sessionId: 'syn-002',
    code: 'DAT204',
    title: 'Event-driven systems: Lessons from the field',
    type: 'Code talk',
    level: '400',
    venue: 'Wynn',
    room: 'Room 114',
    startsAt: '2026-12-01T14:30:00-08:00',
    endsAt: '2026-12-01T16:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'veryLimited',
    missingFields: [],
  },
  {
    sessionId: 'syn-063',
    code: 'ARC313',
    title: 'Observability: A builder guide',
    type: 'Code talk',
    level: '300',
    venue: 'The Venetian',
    room: 'Room 130',
    startsAt: '2026-12-04T10:00:00-08:00',
    endsAt: '2026-12-04T11:30:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'available',
    missingFields: [],
  },
  {
    sessionId: 'syn-087',
    code: 'ANT136',
    title: 'Event-driven systems: From zero to production',
    type: 'Breakout session',
    level: '300',
    venue: 'Encore',
    room: 'Room 104',
    startsAt: '2026-12-04T10:00:00-08:00',
    endsAt: '2026-12-04T11:30:00-08:00',
    isAllDay: false,
    isReservable: false,
    seatAvailability: 'walkUp',
    missingFields: [],
  },
  {
    sessionId: 'syn-008',
    code: 'AIM482',
    title: 'Observability: From zero to production',
    type: 'Builders session',
    level: '300',
    startsAt: '2026-12-04T11:30:00-08:00',
    endsAt: '2026-12-04T13:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'unavailable',
    missingFields: ['venue', 'room'],
  },
  {
    sessionId: 'syn-025',
    code: 'BWP213-R',
    title: 'Data lakes: A builder guide',
    type: 'Workshop',
    level: '400',
    venue: 'The Venetian',
    room: 'Room 135',
    startsAt: '2026-12-04T11:30:00-08:00',
    endsAt: '2026-12-04T13:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'available',
    repeatOf: 'BWP213',
    missingFields: [],
  },
  {
    sessionId: 'syn-047',
    code: 'NET381',
    title: 'Cost optimisation: From zero to production',
    type: 'Chalk talk',
    level: '200',
    venue: 'Encore',
    room: 'Room 139',
    startsAt: '2026-12-04T11:30:00-08:00',
    endsAt: '2026-12-04T13:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'available',
    missingFields: [],
  },
  {
    sessionId: 'syn-026',
    code: 'CMP327',
    title: 'Event-driven systems: Hands on workshop',
    type: 'Code talk',
    level: '200',
    venue: 'MGM Grand',
    room: 'Room 101',
    startsAt: '2026-12-04T13:00:00-08:00',
    endsAt: '2026-12-04T14:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'available',
    missingFields: [],
  },
  {
    sessionId: 'syn-028',
    code: 'NET217',
    title: 'Event-driven systems: Patterns and practice',
    type: 'Chalk talk',
    level: '200',
    venue: 'The Venetian',
    room: 'Room 132',
    startsAt: '2026-12-04T14:30:00-08:00',
    endsAt: '2026-12-04T15:30:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'available',
    missingFields: [],
  },
  {
    sessionId: 'syn-069',
    code: 'SEC431-R2',
    title: 'Identity and access: Hands on workshop',
    type: 'Workshop',
    level: '400',
    venue: 'Encore',
    room: 'Room 112',
    startsAt: '2026-12-04T16:00:00-08:00',
    endsAt: '2026-12-04T17:30:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'limited',
    repeatOf: 'SEC431',
    missingFields: [],
  },
];

/** The sessions "Start with a sample week" holds, by sessionId. */
export const STARTER_WEEK: readonly string[] = ['syn-003', 'syn-024', 'syn-002', 'syn-028'];

/** The guided path: load the sample week, then try to add the session named here. */
export const GUIDED_CLASH = {
  /** The session the guided path names. It overlaps clashesWith. */
  tryAdd: 'syn-076',
  /** A Starter_Week session that overlaps tryAdd. */
  clashesWith: 'syn-024',
  /** The -R repeat of clashesWith. It overlaps no other Starter_Week session. */
  heldRepeat: 'syn-025',
} as const;
