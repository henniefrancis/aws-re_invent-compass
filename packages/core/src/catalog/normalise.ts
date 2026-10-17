// Session normalisation (events-client, S1, task 13.6).
//
// Turns one wire session into a NormalisedSession (Requirement 15). Nothing is
// invented: a field the wire omits stays absent and is named in missingFields,
// except the four documented defaults (isAllDay=false, isReservable=false,
// seatAvailability="unknown", code=""), which are applied AND recorded.
//
// Tracked fields, recorded by their normalised names when absent: code, type, level,
// venue, room, startsAt, endsAt, isAllDay, isReservable and seatAvailability.
//
// The venue list is injected (already parsed through VenueSchema, see parseVenues)
// and only read. The event timezone is the one read from the API; it is used only
// for a session whose own sessionTime carries no timezone.

import {
  NormalisedSessionSchema,
  type NormalisedSession,
  type SessionWire,
  type Venue,
} from '@compass/contracts';
import { computeSessionInterval } from './session-time.js';
import { recoverVenue } from './venue-recovery.js';

/** The suffix that marks a repeated session, for example DAT302-R or DAT302-R2. */
const REPEAT_SUFFIX = /-R[0-9]?$/;

/** Normalise one wire session. The result always validates against the schema. */
export function normaliseSession(
  wire: SessionWire,
  venues: readonly Venue[] | undefined,
  eventTimezone: string,
): NormalisedSession {
  const missing: string[] = [];
  const note = (name: string, present: boolean): void => {
    if (!present) {
      missing.push(name);
    }
  };

  const code = wire.abbreviation ?? '';
  note('code', wire.abbreviation !== undefined);

  const interval = computeSessionInterval(wire.sessionTime, eventTimezone);
  note('startsAt', interval !== undefined);
  note('endsAt', interval !== undefined);

  const venue = wire.venue ?? (venues === undefined ? undefined : recoverVenue(wire.room, venues));
  note('venue', venue !== undefined);

  note('type', wire.type !== undefined);
  note('level', wire.level !== undefined);
  note('room', wire.room !== undefined);
  note('isAllDay', wire.isAllDaySession !== undefined);
  note('isReservable', wire.isReservable !== undefined);
  note('seatAvailability', wire.seatAvailability !== undefined);

  const base = REPEAT_SUFFIX.test(code) ? code.replace(REPEAT_SUFFIX, '') : '';

  return NormalisedSessionSchema.parse({
    sessionId: wire.sessionId,
    code,
    title: wire.title,
    type: wire.type,
    level: wire.level,
    venue,
    room: wire.room,
    startsAt: interval?.startsAt,
    endsAt: interval?.endsAt,
    isAllDay: wire.isAllDaySession ?? false,
    isReservable: wire.isReservable ?? false,
    seatAvailability: wire.seatAvailability ?? 'unknown',
    repeatOf: base.length > 0 ? base : undefined,
    missingFields: missing,
  });
}
