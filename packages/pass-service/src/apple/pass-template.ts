// The fixed server template of every Apple pass (Requirement 9): the owner's Pass Designer
// event ticket (task 44). Pure: the same input always gives the same pass.json.
// Client text appears only as field values and semantic tags; no client string is ever a date
// (review H1): every date here is built from `Date.parse` and written in the canonical
// 24-character toISOString() form.
//
// Pass keys: https://developer.apple.com/documentation/walletpasses/pass
import type { PassFields } from '@compass/contracts';
import {
  formatEventDate,
  formatEventDayTime24,
  formatEventTime24,
  timezoneName,
} from './format-time.js';

import { STATIC_BACK, type StaticBackKey } from './pass-texts.js';

// The fixed texts live in pass-texts.ts, shared with the Google class (task 47.7).
export {
  DISCLAIMER,
  INDEPENDENT_NOTICE,
  PLANS_NOTICE,
  PRIVACY_NOTICE,
  SEAT_RULE,
  UNOFFICIAL_NOTICE,
} from './pass-texts.js';
/** The issuer Wallet names on the pass and the Lock Screen (owner decision, task 44). */
/**
 * The one wallet group for re:Invent 2026 (task 55). Apple's top-level `groupingIdentifier` and
 * Google's `groupingInfo.groupingId` both carry it, so an attendee's session passes stack as one
 * group. A fixed constant: no attendee, session or serial data in it.
 */
export const WALLET_GROUP_ID = 'reinvent-2026-compass';

export const ORGANIZATION_NAME = 'AWS Community South Africa';
export const NO_VENUE = 'Venue not published';
export const NO_ROOM = 'Room not published';
/** The region semantic tag: re:Invent is held in Las Vegas (task 42). */
export const EVENT_REGION = 'Las Vegas';
/**
 * The arrow between the terminal and the gate (tasks 43 and 44), where the boarding pass drew its
 * transit arrow. A rightwards arrow, U+2192.
 */
export const ARROW = '→';
/**
 * The pass colours from the owner's Pass Designer design (task 44): black background, white
 * values and orange labels. Their closeness to the AWS colours is an accepted owner deviation
 * (design, "Post-SP3 change: Pass Designer event ticket").
 */
export const PASS_COLOURS = {
  background: 'rgb(0, 0, 0)',
  foreground: 'rgb(254, 255, 255)',
  label: 'rgb(240, 151, 64)',
} as const;

const MINUTE_MS = 60_000;
const BOARDING_CLOSES_BEFORE_MS = 10 * MINUTE_MS;
const RELEVANT_BEFORE_MS = 40 * MINUTE_MS;

export type TextAlignment =
  | 'PKTextAlignmentLeft'
  | 'PKTextAlignmentCenter'
  | 'PKTextAlignmentRight'
  | 'PKTextAlignmentNatural';

export interface PassField {
  key: string;
  label?: string;
  value: string;
  textAlignment?: TextAlignment;
}

/** The event semantic tags (task 42), kept for Siri and the system. */
export interface PassSemantics {
  eventType: 'PKEventTypeGeneric';
  eventName: string;
  venueName: string;
  venueRegionName: string;
  venueRoom: string;
  eventStartDate: string;
  eventEndDate: string;
}

export interface PassJson {
  formatVersion: 1;
  passTypeIdentifier: string;
  teamIdentifier: string;
  serialNumber: string;
  organizationName: string;
  description: string;
  sharingProhibited: true;
  groupingIdentifier: string;
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  webServiceURL: string;
  authenticationToken: string;
  expirationDate: string;
  voided?: true;
  relevantDates: { startDate: string; endDate: string }[];
  semantics: PassSemantics;
  eventTicket: {
    headerFields: PassField[];
    primaryFields: PassField[];
    secondaryFields: PassField[];
    auxiliaryFields: PassField[];
    backFields: PassField[];
  };
}

export type PassTemplateInput = {
  serialNumber: string;
  fields: PassFields;
  authToken: string;
  webServiceUrl: string;
  timezone: string;
  apple: { passTypeIdentifier: string; teamIdentifier: string };
} & ({ status: 'active' } | { status: 'voided'; voidedAt: string });

/** Canonical 24-character form of an instant, shifted by `offsetMs`. */
function canonical(iso: string, offsetMs = 0): string {
  return new Date(Date.parse(iso) + offsetMs).toISOString();
}

/** Boarding closes 10 minutes before the session starts. */
export function boardingClosesAt(startsAt: string): string {
  return canonical(startsAt, -BOARDING_CLOSES_BEFORE_MS);
}

/** One relevant interval: 40 minutes before the start (30 before boarding closes) to the end. */
export function relevantInterval(fields: PassFields): { startDate: string; endDate: string } {
  return {
    startDate: canonical(fields.startsAt, -RELEVANT_BEFORE_MS),
    endDate: canonical(fields.endsAt),
  };
}

function field(
  key: string,
  label: string,
  value: string,
  textAlignment?: TextAlignment,
): PassField {
  return textAlignment === undefined ? { key, label, value } : { key, label, value, textAlignment };
}

/**
 * The room as the front shows it: the part after the first comma, which is the room itself
 * without the level or area ("Academy 409" from "Level 1, Academy 409"), or the whole room
 * when it has one part (task 32).
 */
export function shortRoom(room: string): string {
  const parts = room
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const [first = '', second] = parts;
  return second ?? first;
}

/**
 * The back, in the owner's Pass Designer order (task 44): about, unofficial pass and the seat
 * rule; then the per-pass room, walk, next session and name when there is data; then the times,
 * what to do when plans change, and privacy. The Google object shows the same texts in its
 * details (task 47).
 */
export function backFields(fields: PassFields, timezone: string): PassField[] {
  const fixed = (key: StaticBackKey): PassField =>
    field(key, STATIC_BACK[key].label, STATIC_BACK[key].value);
  const back: PassField[] = [fixed('about'), fixed('unofficial'), fixed('seatRule')];
  if (fields.room !== '') {
    back.push(field('roomFull', 'ROOM', fields.room));
  }
  if (fields.walkFromPrevious !== undefined) {
    const from =
      fields.walkFromPrevious.fromVenue === ''
        ? 'the previous venue'
        : fields.walkFromPrevious.fromVenue;
    back.push(
      field('walk', 'WALK FROM PREVIOUS', `${fields.walkFromPrevious.minutes} min from ${from}`),
    );
  }
  if (fields.nextConnection !== undefined) {
    const next = fields.nextConnection;
    const venue = next.venue === '' ? NO_VENUE.toLowerCase() : next.venue;
    back.push(
      field(
        'next',
        'NEXT SESSION',
        `${next.sessionCode} at ${formatEventDayTime24(next.startsAt, timezone)}, ${venue}, ${next.walkMinutes} min walk`,
      ),
    );
  }
  if (fields.attendeeName !== undefined) {
    back.push(field('name', 'NAME', fields.attendeeName));
  }
  back.push(
    field('timezone', 'TIMES', `All times are ${timezoneName(fields.startsAt, timezone)}.`),
    fixed('plans'),
    fixed('privacy'),
  );
  return back;
}

/**
 * The event semantic tags (task 42). The dates are canonical, built from Date.parse, never a
 * client string.
 */
export function passSemantics(fields: PassFields): PassSemantics {
  return {
    eventType: 'PKEventTypeGeneric',
    eventName: fields.title,
    venueName: fields.venue === '' ? NO_VENUE : fields.venue,
    venueRegionName: EVENT_REGION,
    venueRoom: fields.room === '' ? NO_ROOM : fields.room,
    eventStartDate: canonical(fields.startsAt),
    eventEndDate: canonical(fields.endsAt),
  };
}

export function buildPassJson(input: PassTemplateInput): PassJson {
  const { fields, timezone } = input;
  const closes = formatEventTime24(boardingClosesAt(fields.startsAt), timezone);
  const venue = fields.venue === '' ? NO_VENUE : fields.venue;
  const gate = shortRoom(fields.room) === '' ? NO_ROOM : shortRoom(fields.room);
  const expiration = input.status === 'voided' ? input.voidedAt : fields.endsAt;
  return {
    formatVersion: 1,
    passTypeIdentifier: input.apple.passTypeIdentifier,
    teamIdentifier: input.apple.teamIdentifier,
    serialNumber: input.serialNumber,
    organizationName: ORGANIZATION_NAME,
    description: 'Unofficial Boarding Pass',
    sharingProhibited: true,
    groupingIdentifier: WALLET_GROUP_ID,
    backgroundColor: PASS_COLOURS.background,
    foregroundColor: PASS_COLOURS.foreground,
    labelColor: PASS_COLOURS.label,
    webServiceURL: input.webServiceUrl,
    authenticationToken: input.authToken,
    expirationDate: canonical(expiration),
    ...(input.status === 'voided' ? { voided: true as const } : {}),
    relevantDates: [relevantInterval(fields)],
    semantics: passSemantics(fields),
    // The owner's Pass Designer layout (task 44), over the owner's Pass Designer gradient (background.png):
    // the logo and the session code; the flight name; terminal, arrow and gate; then the date
    // and boarding closes. The alignments are the design's.
    eventTicket: {
      headerFields: [field('session', 'SESSION', fields.sessionCode, 'PKTextAlignmentNatural')],
      primaryFields: [field('title', 'FLIGHT NAME', fields.title, 'PKTextAlignmentNatural')],
      secondaryFields: [
        field('terminal', 'TERMINAL', venue, 'PKTextAlignmentLeft'),
        { key: 'arrow', value: ARROW, textAlignment: 'PKTextAlignmentCenter' },
        field('gate', 'GATE', gate, 'PKTextAlignmentRight'),
      ],
      auxiliaryFields: [
        field(
          'date',
          'DATE',
          `${formatEventDate(fields.startsAt, timezone)} | ${formatEventTime24(fields.startsAt, timezone)}-${formatEventTime24(fields.endsAt, timezone)}`,
          'PKTextAlignmentLeft',
        ),
        field('boardingCloses', 'BOARDING CLOSES', closes, 'PKTextAlignmentNatural'),
      ],
      backFields: backFields(fields, timezone),
    },
  };
}
