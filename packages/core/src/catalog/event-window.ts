// Event window and timezone from the API (events-client, S1, task 13.17, tightened by
// QA M7 and M8).
//
// The event start, end and timezone are read from the ListEvents and GetEvent
// responses; they are never hard-coded and never defaulted (Requirement 17). Each of
// the three is taken from GetEvent when it is usable there, and otherwise from the
// ListEvents entry with the same eventId. A date is usable only if it is an ISO 8601
// date-time with an offset or Z (the format the Events API documents), and a timezone
// only if it is a strictly valid IANA identifier in its exact case. If any of the
// three is missing or unusable, or the start is not before the end, EventWindowError
// is thrown and no value is substituted.

import { EventWindowError } from '../api/errors.js';
import { isValidTimeZone } from './session-time.js';
import type { GetEventResult, ListEventsResult } from '../api/response-wrappers.js';

/** The resolved event window. */
export interface EventWindow {
  start: string;
  end: string;
  /** A valid IANA timezone identifier. */
  timezone: string;
}

const NOT_DETERMINED = 'The event window could not be determined from the Events API';
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function validDate(value: string | undefined): value is string {
  return value !== undefined && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

function validZone(value: string | undefined): value is string {
  return value !== undefined && isValidTimeZone(value);
}

/** The first usable value: GetEvent's, else the ListEvents entry's. */
function firstValid(
  primary: string | undefined,
  fallback: string | undefined,
  usable: (value: string | undefined) => value is string,
): string | undefined {
  if (usable(primary)) {
    return primary;
  }
  return usable(fallback) ? fallback : undefined;
}

/** Resolve the event window, or throw EventWindowError. Never returns a default. */
export function resolveEventWindow(
  listEvents: ListEventsResult,
  getEvent: GetEventResult,
): EventWindow {
  const { event } = getEvent;
  const listed = listEvents.items.find((item) => item.eventId === event.eventId);
  const start = firstValid(event.startDate, listed?.startDate, validDate);
  const end = firstValid(event.endDate, listed?.endDate, validDate);
  const timezone = firstValid(event.timezone, listed?.timezone, validZone);
  if (
    start === undefined ||
    end === undefined ||
    timezone === undefined ||
    Date.parse(start) >= Date.parse(end)
  ) {
    throw new EventWindowError('GetEvent', NOT_DETERMINED);
  }
  return { start, end, timezone };
}
