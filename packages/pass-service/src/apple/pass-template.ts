// The fixed server template of every Apple pass (Requirement 9): a poster generic pass with a
// legacy event ticket fallback in the same pass.json (task 43). Pure: the same input always gives the same pass.json.
// Client text appears only as field values and semantic tags; no client string is ever a date
// (review H1): every date here is built from `Date.parse` and written in the canonical
// 24-character toISOString() form.
//
// Pass keys: https://developer.apple.com/documentation/walletpasses/pass
// Poster generic passes: https://developer.apple.com/documentation/walletpasses/creating-a-poster-generic-pass
import type { PassFields } from '@compass/contracts';
import {
  formatEventDate,
  formatEventDayTime24,
  formatEventTime24,
  timezoneName,
} from './format-time.js';

export const DISCLAIMER = 'Unofficial. Your badge is your ticket.';
export const INDEPENDENT_NOTICE =
  're:Invent Compass is an independent community project, not affiliated with AWS.';
export const NO_VENUE = 'Venue not published';
export const NO_ROOM = 'Room not published';
/** The poster's region tag: re:Invent is held in Las Vegas (task 42). */
export const EVENT_REGION = 'Las Vegas';
/**
 * The arrow between the terminal and the gate on the poster front (task 43), where the boarding
 * pass drew its transit arrow. A rightwards arrow, U+2192.
 */
export const ARROW = '→';
/**
 * The pass colours (owner decision, task 35): background #232F3F, white values and #A166FF
 * labels. The background's closeness to AWS Squid Ink and the label contrast are accepted
 * owner deviations (design, "Post-SP3 change: pass review 3").
 */
export const PASS_COLOURS = {
  background: 'rgb(35, 47, 63)',
  foreground: 'rgb(255, 255, 255)',
  label: 'rgb(161, 102, 255)',
} as const;

const MINUTE_MS = 60_000;
const BOARDING_CLOSES_BEFORE_MS = 10 * MINUTE_MS;
const RELEVANT_BEFORE_MS = 40 * MINUTE_MS;

export interface PassField {
  key: string;
  label: string;
  value: string;
  textAlignment?: 'PKTextAlignmentRight';
}

/** The event semantic tags (task 42); kept for Siri and the system (task 43). */
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
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  webServiceURL: string;
  authenticationToken: string;
  expirationDate: string;
  voided?: true;
  relevantDates: { startDate: string; endDate: string }[];
  semantics: PassSemantics;
  /** The iOS 27 poster front (task 43). Wallet prefers it when present. */
  posterGeneric: {
    headerFields: PassField[];
    primaryFields: PassField[];
    footerFields: PassField[];
    backFields: PassField[];
  };
  /** The legacy fallback for systems without poster generic passes. */
  eventTicket: {
    headerFields: PassField[];
    primaryFields: PassField[];
    secondaryFields: PassField[];
    auxiliaryFields: PassField[];
    additionalInfoFields: PassField[];
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

function field(key: string, label: string, value: string, alignRight = false): PassField {
  return alignRight
    ? { key, label, value, textAlignment: 'PKTextAlignmentRight' }
    : { key, label, value };
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

function backFields(input: PassTemplateInput): PassField[] {
  const { fields, timezone } = input;
  const back: PassField[] = [];
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
    field('disclaimerBack', 'NOTICE', DISCLAIMER),
    field('independent', 'ABOUT', INDEPENDENT_NOTICE),
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
  const session = [field('session', 'SESSION', fields.sessionCode)];
  const title = field('title', 'FLIGHT NAME', fields.title);
  const terminal = field('terminal', 'TERMINAL', venue);
  const gateField = field('gate', 'GATE', gate, true);
  // The bottom row (task 39): the date and time together on the left and boarding closes on
  // the right. The zone and the disclaimer are on the back (Requirements 9.2 and 9.6).
  const bottom: PassField[] = [
    field(
      'date',
      'DATE',
      `${formatEventDate(fields.startsAt, timezone)} | ${formatEventTime24(fields.startsAt, timezone)}-${formatEventTime24(fields.endsAt, timezone)}`,
    ),
    field('boardingCloses', 'BOARDING CLOSES', closes, true),
  ];
  const back = backFields(input);
  const expiration = input.status === 'voided' ? input.voidedAt : fields.endsAt;
  return {
    formatVersion: 1,
    passTypeIdentifier: input.apple.passTypeIdentifier,
    teamIdentifier: input.apple.teamIdentifier,
    serialNumber: input.serialNumber,
    organizationName: 're:Invent Compass (unofficial)',
    description: 'Unofficial Boarding Pass',
    sharingProhibited: true,
    backgroundColor: PASS_COLOURS.background,
    foregroundColor: PASS_COLOURS.foreground,
    labelColor: PASS_COLOURS.label,
    webServiceURL: input.webServiceUrl,
    authenticationToken: input.authToken,
    expirationDate: canonical(expiration),
    ...(input.status === 'voided' ? { voided: true as const } : {}),
    relevantDates: [relevantInterval(fields)],
    semantics: passSemantics(fields),
    // The owner's layout on iOS 27 (task 43): logo top left and the session top right; the
    // flight name; terminal, arrow and gate; then date and boarding closes in the footer, over
    // the unblurred artwork.
    posterGeneric: {
      headerFields: session,
      primaryFields: [title, terminal, field('arrow', '', ARROW), gateField],
      footerFields: bottom,
      backFields: back,
    },
    // The legacy event ticket shows one primary field, so the terminal and the gate move to the
    // secondary row where both stay in view (task 43).
    eventTicket: {
      headerFields: session,
      primaryFields: [title],
      secondaryFields: [terminal, gateField],
      auxiliaryFields: bottom,
      additionalInfoFields: [
        field('boardingClosesInfo', 'BOARDING CLOSES', closes),
        field('disclaimerInfo', 'NOTICE', DISCLAIMER),
      ],
      backFields: back,
    },
  };
}
