// Request rules the simulated transport enforces (events-client, S1, QA M5).
//
// The live Events API refuses a request that breaks the OpenAPI constraints, so the
// simulation must too, or a client could pass every simulated test and fail live. The
// constraints come from packages/contracts/events-api.openapi.json:
//   - ReserveSessions and AssociateFavorites: sessionIds is 1 to 10 unique strings of
//     1 to 128 characters,
//   - personal time: startDateTime and endDateTime match YYYY-MM-DDTHH:MM:SS, are UTC
//     (no Z, no offset), have seconds 00 and are real dates; the end is after the start
//     and the length is a whole number of 5-minute steps; title is 1 to 128, description
//     1 to 250 and location (optional) 1 to 255 characters.
// A failure returns a fixed message and never echoes the offending value.

import type { PersonalTimeInput } from '@compass/contracts';

const MAX_ID_LENGTH = 128;
const MIN_BULK_IDS = 1;
const MAX_BULK_IDS = 10;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const FIVE_MINUTES_MS = 5 * 60_000;

/** The result of checking a request body: the parsed value, or a fixed error message. */
export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function inLength(value: unknown, min: number, max: number): value is string {
  return isString(value) && value.length >= min && value.length <= max;
}

/** Check a bulk request body: { sessionIds } with 1 to 10 unique ids of 1 to 128 characters. */
export function checkBulkBody(body: unknown): Checked<{ sessionIds: string[] }> {
  const fail = {
    ok: false,
    message: 'sessionIds must hold 1 to 10 unique ids of 1 to 128 characters each',
  } as const;
  const ids =
    typeof body === 'object' && body !== null
      ? (body as { sessionIds?: unknown }).sessionIds
      : undefined;
  if (
    !Array.isArray(ids) ||
    ids.length < MIN_BULK_IDS ||
    ids.length > MAX_BULK_IDS ||
    !ids.every((id) => inLength(id, 1, MAX_ID_LENGTH)) ||
    new Set(ids).size !== ids.length
  ) {
    return fail;
  }
  return { ok: true, value: { sessionIds: ids } };
}

/** The UTC time in milliseconds for a YYYY-MM-DDTHH:MM:00 value, or undefined if invalid. */
function utcMinuteMs(value: unknown): number | undefined {
  if (!isString(value) || !DATE_TIME.test(value) || !value.endsWith(':00')) {
    return undefined;
  }
  // Parsing as UTC and printing back catches impossible dates such as 2026-02-31.
  const ms = Date.parse(`${value}Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === value ? ms : undefined;
}

/** Check a personal time body against the OpenAPI PersonalTimeInput constraints. */
export function checkPersonalTimeBody(body: unknown): Checked<PersonalTimeInput> {
  const fail = {
    ok: false,
    message:
      'Personal time is invalid: dates must be UTC YYYY-MM-DDTHH:MM:00, the end after the start in 5 minute steps, and the text within its length limits',
  } as const;
  if (typeof body !== 'object' || body === null) {
    return fail;
  }
  const b = body as Record<string, unknown>;
  const start = utcMinuteMs(b.startDateTime);
  const end = utcMinuteMs(b.endDateTime);
  if (
    start === undefined ||
    end === undefined ||
    end <= start ||
    (end - start) % FIVE_MINUTES_MS !== 0 ||
    !inLength(b.title, 1, 128) ||
    !inLength(b.description, 1, 250) ||
    (b.location !== undefined && !inLength(b.location, 1, 255))
  ) {
    return fail;
  }
  return {
    ok: true,
    value: {
      startDateTime: b.startDateTime as string,
      endDateTime: b.endDateTime as string,
      title: b.title,
      description: b.description,
      ...(b.location === undefined ? {} : { location: b.location }),
    },
  };
}
