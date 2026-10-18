// Commitment resolution (itinerary-rules, S2). Internal, not exported by index.ts.
//
// This is the one place that turns a Commitment plus the Sessions_Lookup into a single
// resolved view, so venue, time and reservability resolution are defined once and every
// rule reads the same answer (design, Resolved view).
//
// Honesty about uncertainty: a field that is absent, listed in missingFields, or not a
// valid ISO 8601 instant is "missing". It is never replaced by a default.
import type { Commitment, NormalisedSession } from '@compass/contracts';
import { label } from './reasons.js';
import { parseInstant } from './time.js';

/** A map of NormalisedSession keyed by sessionId, supplied with the commitments. */
export type SessionsLookup = Readonly<Record<string, NormalisedSession>>;

/** The engine's view of an itinerary: commitments plus the sessions they refer to. */
export interface ScheduleInput {
  commitments: readonly Commitment[];
  sessions: SessionsLookup;
}

/** The fields a resolved commitment can be missing, or "order" when its end is not after its start. */
export type Missing = 'venue' | 'startsAt' | 'endsAt' | 'reservability' | 'order';

/** One commitment with its venue, times and reservability resolved. */
export interface ResolvedCommitment {
  /** A short, safe name used in reasons. */
  ref: string;
  /** The result of Venue_Resolution. */
  venue?: string;
  /** ISO instant, absent when unusable. */
  startsAt?: string;
  /** ISO instant, absent when unusable. */
  endsAt?: string;
  isAllDay: boolean;
  /** Absent when the flag is missing. */
  isReservable?: boolean;
  /** Every field left absent, in a fixed order. */
  missing: Missing[];
  /**
   * True for personal time with no location: the attendee stays where they are. Its venue is not
   * missing data. See inheritStayPutVenues.
   */
  stayPut?: boolean;
}

/** A value that is text with something in it. Anything else (absent, not text, blank) is missing. */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Is a field name listed in missingFields? A missingFields that is not a list lists nothing. */
function isListed(session: NormalisedSession, field: string): boolean {
  return Array.isArray(session.missingFields) && session.missingFields.includes(field);
}

function firstNonEmpty(...values: unknown[]): string {
  return nonEmpty(values.find((value) => nonEmpty(value) !== undefined)) ?? '';
}

/** The session for an id, or undefined. Only own keys count, so odd ids never hit a prototype. */
function sessionFor(sessions: SessionsLookup, sessionId: string): NormalisedSession | undefined {
  return Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : undefined;
}

/** A time string that is text and a valid ISO 8601 instant, else undefined. */
function usableText(value: unknown): string | undefined {
  return typeof value === 'string' && parseInstant(value) !== undefined ? value : undefined;
}

/**
 * A session time is usable only when it is present, its field name is not listed in
 * missingFields, and it is a valid ISO 8601 instant with an offset.
 */
export function usableTime(
  session: NormalisedSession,
  field: 'startsAt' | 'endsAt',
): string | undefined {
  const value: unknown = session[field];
  const usable =
    typeof value === 'string' && !isListed(session, field) && parseInstant(value) !== undefined;
  return usable ? value : undefined;
}

/** Reservability is missing when isReservable is listed in missingFields. */
export function sessionReservability(session: NormalisedSession): boolean | undefined {
  return isListed(session, 'isReservable') || typeof session.isReservable !== 'boolean'
    ? undefined
    : session.isReservable;
}

/** A short, safe name for a session: its code, else its title, else its id. */
export function sessionRef(session: NormalisedSession): string {
  return label(firstNonEmpty(session.code, session.title, session.sessionId));
}

/**
 * Resolve one commitment.
 *
 * Venue_Resolution order: NormalisedSession.venue, then Commitment.venue for a
 * reservedSession, then Commitment.location for a personalTime. For a reservedSession the
 * times and reservability come from the session; a sessionId absent from the lookup gives
 * unknown times and reservability (its venue can still come from the commitment). For
 * personalTime the times come from the commitment and no reservation is needed.
 */
export function resolveCommitment(
  commitment: Commitment,
  sessions: SessionsLookup,
): ResolvedCommitment {
  let ref: string;
  let venue: string | undefined;
  let startsAt: string | undefined;
  let endsAt: string | undefined;
  let isAllDay = false;
  let isReservable: boolean | undefined;
  let stayPut = false;

  if (commitment.kind === 'reservedSession') {
    const session = sessionFor(sessions, commitment.sessionId);
    ref = label(
      firstNonEmpty(session?.code, session?.title, commitment.title, commitment.sessionId),
    );
    venue = nonEmpty(session?.venue) ?? nonEmpty(commitment.venue);
    // A session that is not in the lookup falls back to the commitment's own times.
    startsAt = session ? usableTime(session, 'startsAt') : usableText(commitment.startsAt);
    endsAt = session ? usableTime(session, 'endsAt') : usableText(commitment.endsAt);
    isAllDay = session?.isAllDay === true;
    isReservable = session && sessionReservability(session);
  } else {
    ref = label(commitment.title);
    venue = nonEmpty(commitment.location);
    startsAt = usableText(commitment.startsAt);
    endsAt = usableText(commitment.endsAt);
    isReservable = false;
    stayPut = venue === undefined;
  }

  const missing: Missing[] = [];
  if (venue === undefined && !stayPut) missing.push('venue');
  if (startsAt === undefined) missing.push('startsAt');
  if (endsAt === undefined) missing.push('endsAt');
  if (isReservable === undefined) missing.push('reservability');
  // An end that is not after the start is bad data. All-day items ignore their end.
  if (
    !isAllDay &&
    startsAt !== undefined &&
    endsAt !== undefined &&
    (parseInstant(endsAt) as number) <= (parseInstant(startsAt) as number)
  ) {
    missing.push('order');
  }
  return {
    ref,
    venue,
    startsAt,
    endsAt,
    isAllDay,
    isReservable,
    missing,
    ...(stayPut ? { stayPut } : {}),
  };
}

/**
 * Fill in the venue of personal time that has no location, in a list sorted by time: the attendee
 * stays where they were, so it takes the venue of the commitment before it (which may itself have
 * been filled in). The first commitment of a list, with nothing before it, keeps no venue. Only
 * stay-put items change; the input is not modified.
 */
export function inheritStayPutVenues(
  sequence: readonly ResolvedCommitment[],
): ResolvedCommitment[] {
  let previous: string | undefined;
  return sequence.map((item) => {
    const filled =
      item.stayPut === true && item.venue === undefined ? { ...item, venue: previous } : item;
    previous = filled.venue;
    return filled;
  });
}

const KNOWN_SEAT_BANDS: readonly unknown[] = [
  'available',
  'limited',
  'veryLimited',
  'unavailable',
  'walkUp',
];

/**
 * Is the seat availability of a session that may need a reservation unknown? A missing value, the
 * "unknown" band and any value not in the known bands all count, and none is ever read as
 * available. A session known to need no reservation has no seat availability to know, so it is
 * never "unknown" in this sense (the real API leaves seatAvailability out for those).
 */
export function isSeatUnknown(session: NormalisedSession): boolean {
  return (
    sessionReservability(session) !== false && !KNOWN_SEAT_BANDS.includes(session.seatAvailability)
  );
}

/** Is the session full: only walk-up seats or none left? A session that needs no reservation is not. */
export function isSeatFull(session: NormalisedSession): boolean {
  return (
    (session.seatAvailability === 'unavailable' || session.seatAvailability === 'walkUp') &&
    sessionReservability(session) !== false
  );
}

/**
 * Turn a candidate session into a reservedSession commitment, so every rule sees the
 * candidate in the same shape as the rest of the schedule. Times the session lacks become
 * empty strings, which resolve as missing.
 */
export function sessionToCommitment(session: NormalisedSession): Commitment {
  return {
    kind: 'reservedSession',
    sessionId: session.sessionId,
    startsAt: session.startsAt ?? '',
    endsAt: session.endsAt ?? '',
    title: session.title,
    venue: session.venue,
  };
}
