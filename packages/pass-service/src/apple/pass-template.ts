// The fixed server template of every Apple pass (Requirement 9). Pure: the same input
// always gives the same pass.json. Client text appears only as field values; no client
// string is ever a date (review H1): every date here is built from `Date.parse` and written
// in the canonical 24-character toISOString() form.
//
// Pass keys: https://developer.apple.com/documentation/walletpasses/pass
import type { PassFields } from '@compass/contracts';
import { formatEventDayTime, formatEventTime, timezoneName } from './format-time.js';

export const DISCLAIMER = 'Unofficial. Your badge is your ticket.';
export const INDEPENDENT_NOTICE =
  're:Invent Compass is an independent community project, not affiliated with AWS.';
export const NO_VENUE = 'Venue not published';

const MINUTE_MS = 60_000;
const BOARDING_CLOSES_BEFORE_MS = 10 * MINUTE_MS;
const RELEVANT_BEFORE_MS = 40 * MINUTE_MS;

export interface PassField {
  key: string;
  label: string;
  value: string;
}

export interface PassJson {
  formatVersion: 1;
  passTypeIdentifier: string;
  teamIdentifier: string;
  serialNumber: string;
  organizationName: string;
  description: string;
  logoText: string;
  sharingProhibited: true;
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  webServiceURL: string;
  authenticationToken: string;
  expirationDate: string;
  voided?: true;
  relevantDates: { startDate: string; endDate: string }[];
  boardingPass: {
    transitType: 'PKTransitTypeGeneric';
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

function field(key: string, label: string, value: string): PassField {
  return { key, label, value };
}

function backFields(input: PassTemplateInput): PassField[] {
  const { fields, timezone } = input;
  const back: PassField[] = [];
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
        `${next.sessionCode} at ${formatEventDayTime(next.startsAt, timezone)}, ${venue}, ${next.walkMinutes} min walk`,
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

export function buildPassJson(input: PassTemplateInput): PassJson {
  const { fields, timezone } = input;
  const auxiliary: PassField[] = [];
  if (fields.room !== '') {
    auxiliary.push(field('room', 'ROOM', fields.room));
  }
  auxiliary.push(
    field('starts', 'STARTS', formatEventDayTime(fields.startsAt, timezone)),
    field('ends', 'ENDS', formatEventDayTime(fields.endsAt, timezone)),
    field('notice', 'NOTICE', DISCLAIMER),
  );
  const expiration = input.status === 'voided' ? input.voidedAt : fields.endsAt;
  return {
    formatVersion: 1,
    passTypeIdentifier: input.apple.passTypeIdentifier,
    teamIdentifier: input.apple.teamIdentifier,
    serialNumber: input.serialNumber,
    organizationName: 're:Invent Compass (unofficial)',
    description: 'Unofficial boarding pass',
    logoText: 'Compass',
    sharingProhibited: true,
    backgroundColor: 'rgb(14, 62, 74)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(190, 226, 232)',
    webServiceURL: input.webServiceUrl,
    authenticationToken: input.authToken,
    expirationDate: canonical(expiration),
    ...(input.status === 'voided' ? { voided: true as const } : {}),
    relevantDates: [relevantInterval(fields)],
    boardingPass: {
      transitType: 'PKTransitTypeGeneric',
      headerFields: [
        field(
          'boardingCloses',
          'BOARDING CLOSES',
          formatEventTime(boardingClosesAt(fields.startsAt), timezone),
        ),
      ],
      primaryFields: [
        field('session', 'SESSION', fields.sessionCode),
        field('gate', 'GATE', fields.venue === '' ? NO_VENUE : fields.venue),
      ],
      secondaryFields: [field('title', 'TITLE', fields.title)],
      auxiliaryFields: auxiliary,
      backFields: backFields(input),
    },
  };
}
