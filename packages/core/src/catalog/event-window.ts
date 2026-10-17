// Event window and timezone from the API (events-client, S1, task 13.17).
//
// The event start, end and timezone are read from the ListEvents and GetEvent
// responses; they are never hard-coded and never defaulted (Requirement 17). If any
// of the three is absent, or the timezone is not a valid IANA identifier, or a date
// is not a parseable date, EventWindowError is thrown and no value is substituted.
//
// GetEvent is the primary source. The timezone may also come from the ListEvents
// entry with the same eventId when the GetEvent body omits it.

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

/** Resolve the event window, or throw EventWindowError. Never returns a default. */
export function resolveEventWindow(
  listEvents: ListEventsResult,
  getEvent: GetEventResult,
): EventWindow {
  const { event } = getEvent;
  const listed = listEvents.items.find((item) => item.eventId === event.eventId);
  const timezone = event.timezone ?? listed?.timezone;
  const { startDate: start, endDate: end } = event;

  const present = (value: string | undefined): value is string =>
    value !== undefined && value.length > 0;
  if (
    !present(start) ||
    !present(end) ||
    !present(timezone) ||
    Number.isNaN(Date.parse(start)) ||
    Number.isNaN(Date.parse(end)) ||
    !isValidTimeZone(timezone)
  ) {
    throw new EventWindowError('GetEvent', NOT_DETERMINED);
  }
  return { start, end, timezone };
}
