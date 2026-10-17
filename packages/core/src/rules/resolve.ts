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

/** The fields a resolved commitment can be missing. */
export type Missing = 'venue' | 'startsAt' | 'endsAt' | 'reservability';

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
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => nonEmpty(value) !== undefined) ?? '';
}

/** The session for an id, or undefined. Only own keys count, so odd ids never hit a prototype. */
function sessionFor(sessions: SessionsLookup, sessionId: string): NormalisedSession | undefined {
  return Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : undefined;
}

/**
 * A session time is usable only when it is present, its field name is not listed in
 * missingFields, and it is a valid ISO 8601 instant with an offset.
 */
export function usableTime(
  session: NormalisedSession,
  field: 'startsAt' | 'endsAt',
): string | undefined {
  const value = session[field];
  const usable =
    value !== undefined &&
    !session.missingFields.includes(field) &&
    parseInstant(value) !== undefined;
  return usable ? value : undefined;
}

/** Reservability is missing when isReservable is listed in missingFields. */
export function sessionReservability(session: NormalisedSession): boolean | undefined {
  return session.missingFields.includes('isReservable') ? undefined : session.isReservable;
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

  if (commitment.kind === 'reservedSession') {
    const session = sessionFor(sessions, commitment.sessionId);
    ref = label(
      firstNonEmpty(session?.code, session?.title, commitment.title, commitment.sessionId),
    );
    venue = nonEmpty(session?.venue) ?? nonEmpty(commitment.venue);
    startsAt = session && usableTime(session, 'startsAt');
    endsAt = session && usableTime(session, 'endsAt');
    isAllDay = session?.isAllDay ?? false;
    isReservable = session && sessionReservability(session);
  } else {
    ref = label(commitment.title);
    venue = nonEmpty(commitment.location);
    startsAt = parseInstant(commitment.startsAt) === undefined ? undefined : commitment.startsAt;
    endsAt = parseInstant(commitment.endsAt) === undefined ? undefined : commitment.endsAt;
    isReservable = false;
  }

  const missing: Missing[] = [];
  if (venue === undefined) missing.push('venue');
  if (startsAt === undefined) missing.push('startsAt');
  if (endsAt === undefined) missing.push('endsAt');
  if (isReservable === undefined) missing.push('reservability');
  return { ref, venue, startsAt, endsAt, isAllDay, isReservable, missing };
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
