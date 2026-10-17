// Boarding_Closes for the pass side (boarding-passes, S4, Requirement 1.2).
//
// A reserved seat is released to walk-ups when the attendee is not in the room ten minutes
// before the session starts, so Boarding_Closes is the server-supplied session start minus ten
// minutes. The pass builder owns no clock and sets no such field (the server does); this
// helper serves the local artifacts, the calendar alarms and the itinerary page.
import { passError } from './redaction.js';

/** Minutes before the session start at which boarding closes. */
export const BOARDING_CLOSES_MINUTES = 10;

/** ISO 8601 with an explicit offset, as every server-supplied instant is. */
const ISO_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Parse an ISO 8601 instant with an offset. Throws a PassError (a fixed sentence, never the
 * value) when the text is not one.
 */
export function parseInstant(iso: string): Date {
  const at = ISO_OFFSET_PATTERN.test(iso) ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(at)) {
    throw passError('time.invalid_instant', 'A time from the schedule is not a valid instant.');
  }
  return new Date(at);
}

/** Boarding_Closes for a session: the start minus ten minutes, as an instant. */
export function boardingClosesAt(startsAt: string): Date {
  return new Date(parseInstant(startsAt).getTime() - BOARDING_CLOSES_MINUTES * 60_000);
}
