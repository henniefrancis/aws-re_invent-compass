// Demo catalog and demo event (showcase-site, Component 6).
//
// DEMO_SESSIONS are 17 real sessions of the re:Invent 2026 catalog, read from the AWS Events API
// and committed as demo-sessions.json by site/scripts/make-demo-sessions.mjs. The snapshot holds
// the session code, title, start, end, venue and room only (owner rule, docs/hackathon-rules.md
// row 11), with the time the catalog was fetched and a source credit. Nothing else of the catalog
// is copied: no abstract, speaker, type, level, seat or reservation data.
//
// What the demo adds itself is marked here and is not catalog data:
//   - the sessionId is the session code (the codes are unique);
//   - repeatOf comes from the code suffix, by the same rule as S1 normaliseSession: DAT302-R and
//     DAT302-R1 are repeats of DAT302;
//   - whether a session can be reserved and whether seats are left (DEMO_SETTINGS). The Events API
//     fields are not copied, so every demo session can be reserved with seats left, except the
//     sessions the demo needs otherwise.
//
// Scenarios in this set (days are event local time, 2026):
//   - the guided clash: CMP340 (MGM Grand) overlaps TNC334-R (Caesars Palace) on Monday 30 Nov;
//   - a held session with a true repeat that fits: TNC334-R (Monday 13:00) and its repeat
//     TNC334-R1 (Thursday 3 Dec 12:30), the same title and room; a second pair is SEC318-R1
//     (Tuesday 1 Dec) and SEC318-R (Wednesday 2 Dec);
//   - other overlaps at two venues: ANT414 and SEC318-R1 (Tuesday 15:00), ANT402-R1 and SEC411
//     (Thursday afternoon);
//   - consecutive sessions at different venues, with an impossible connection: INV530-R1 (MGM
//     Grand, ends 12:30) then TNC334-R (Caesars Palace, starts 13:00);
//   - sessions with no reservation: KEY002 (the CEO keynote), COP304 (a breakout) and SNR309 (a
//     mainstage talk);
//   - a missing meal layover is reachable by holding INV530-R1 (MGM Grand, 11:30 to 12:30) and
//     CMP325-R (MGM Grand, 12:30 to 14:30) on Monday, which fill the whole meal window; the
//     Starter_Week itself is clean, with no impossible connection and no layover problem;
//   - a long stretch without a break: ACT053 (06:30 to 08:30) then SEC318-R (08:30 to 10:30) on
//     Wednesday is 240 minutes, so the engine suggests a rest;
//   - a session with no venue, shown as "Venue not published": ACT053, the 5K race, which the
//     catalog places at Allegiant Stadium, not at one of the six venues;
//   - all six venues: Caesars Forum, Caesars Palace, Encore, MGM Grand, The Venetian, Wynn.

import type { NormalisedSession } from '@compass/contracts';
import snapshot from './demo-sessions.json';
import { normalisePassText } from './pass-text';

export interface DemoEvent {
  /** The event timezone (the catalog times carry the -08:00 offset of Las Vegas in winter). */
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
  now: '2026-11-29T18:00:00-08:00',
  windowStart: '2026-11-30T00:00:00-08:00',
  windowEnd: '2026-12-04T23:59:00-08:00',
};

/** Where the snapshot came from, shown on the Demo_Page. */
export interface DemoSource {
  readonly name: string;
  /** When the catalog was fetched, as the cache recorded it (ISO 8601). */
  readonly fetchedAt: string;
  /** The same date in words, for example "29 October 2026". */
  readonly asOf: string;
}

export const DEMO_SOURCE: DemoSource = {
  name: snapshot.source.name,
  fetchedAt: snapshot.fetchedAt,
  asOf: '29 October 2026',
};

export interface SnapshotSession {
  readonly code: string;
  readonly title: string;
  readonly venue?: string;
  readonly room?: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** The suffix that marks a repeated session, as in S1 normaliseSession: DAT302-R or DAT302-R2. */
const REPEAT_SUFFIX = /-R[0-9]?$/;

type DemoSetting = Pick<NormalisedSession, 'isReservable' | 'seatAvailability'>;

const SEATS_LEFT: DemoSetting = { isReservable: true, seatAvailability: 'available' };
const WALK_UP: DemoSetting = { isReservable: false, seatAvailability: 'walkUp' };
const NO_SEATS: DemoSetting = { isReservable: true, seatAvailability: 'unavailable' };

/**
 * Demo settings, not catalog data: the sessions that cannot be reserved (a keynote, a breakout and
 * a mainstage talk) and the one session with no venue, which has no seats so that the engine warns
 * twice. Every other session can be reserved with seats left.
 */
const DEMO_SETTINGS: Readonly<Record<string, DemoSetting>> = {
  KEY002: WALK_UP,
  COP304: WALK_UP,
  SNR309: WALK_UP,
  ACT053: NO_SEATS,
};

export function toSession(record: SnapshotSession): NormalisedSession {
  const setting = DEMO_SETTINGS[record.code] ?? SEATS_LEFT;
  const missing = [
    ...(record.venue === undefined ? ['venue'] : []),
    ...(record.room === undefined ? ['room'] : []),
  ];
  return {
    sessionId: record.code,
    code: record.code,
    title: record.title,
    ...(record.venue === undefined ? {} : { venue: record.venue }),
    ...(record.room === undefined ? {} : { room: normalisePassText(record.room) }),
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    isAllDay: false,
    ...setting,
    ...(REPEAT_SUFFIX.test(record.code)
      ? { repeatOf: record.code.replace(REPEAT_SUFFIX, '') }
      : {}),
    missingFields: missing,
  };
}

/** The demo session codes, in the order of the snapshot (also their sessionIds). */
export const DEMO_SOURCE_IDS: readonly string[] = (snapshot.sessions as SnapshotSession[]).map(
  (record) => record.code,
);

export const DEMO_SESSIONS: readonly NormalisedSession[] = (
  snapshot.sessions as SnapshotSession[]
).map(toSession);

/** The sessions "Start with a sample week" holds, by sessionId. */
export const STARTER_WEEK: readonly string[] = ['TNC334-R', 'SEC411'];

/** The guided path: load the sample week, then try to add the session named here. */
export const GUIDED_CLASH = {
  /** The session the guided path names. It overlaps clashesWith. */
  tryAdd: 'CMP340',
  /** A Starter_Week session that overlaps tryAdd. */
  clashesWith: 'TNC334-R',
  /** The repeat of clashesWith. It overlaps no other Starter_Week session. */
  heldRepeat: 'TNC334-R1',
} as const;
