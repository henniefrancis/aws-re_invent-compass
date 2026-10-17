// Session time computation (events-client, S1, task 13.6).
//
// Turns a wire sessionTime (date, time, length in minutes, optional timezone) into
// offset-aware ISO 8601 start and end values (Requirements 15.2, 15.3). The UTC
// offset is computed through Intl for the session's own timezone when it has one,
// otherwise for the event timezone supplied by the caller (read from the API, never
// a default). A time is usable only when it has a valid date, a valid clock time, a
// whole-number length in minutes and a valid IANA timezone to place it in; anything
// else yields undefined and nothing is guessed.

import type { SessionTime } from '@compass/contracts';

/** A computed session interval. */
export interface SessionInterval {
  /** Start as offset-aware ISO 8601, for example 2026-11-30T14:30:00-08:00. */
  startsAt: string;
  /** End as offset-aware ISO 8601. */
  endsAt: string;
  /** Start and end as epoch milliseconds, for overlap comparison. */
  startMs: number;
  endMs: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const LENGTH_PATTERN = /^\d{1,5}$/;
const MS_PER_MINUTE = 60_000;

const formatterCache = new Map<string, Intl.DateTimeFormat | null>();
/** At most this many zones are cached. */
export const MAX_CACHED_ZONES = 64;

/** The IANA identifiers the runtime reports, in their canonical case. */
const SUPPORTED_ZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'));
/** The shape of a properly cased Area/Location alias such as Asia/Kolkata. */
const ALIAS_PATTERN = /^[A-Z][a-z]+(\/[A-Z][A-Za-z0-9_+-]*)+$/;

/**
 * Strict IANA check (QA M8). Intl accepts any letter case, so it is not enough: the
 * identifier must be exactly as the runtime lists it, or UTC, or exactly the name the
 * runtime resolves it to, or a properly cased alias of a listed zone (such as Asia/Kolkata, which the runtime resolves to its
 * canonical name). A different casing of the same zone is refused.
 */
function isStrictZone(zone: string, resolved: string): boolean {
  if (SUPPORTED_ZONES.has(zone) || zone === 'UTC' || resolved === zone) {
    return true;
  }
  if (resolved.toLowerCase() === zone.toLowerCase()) {
    return false;
  }
  return ALIAS_PATTERN.test(zone);
}
/** A formatter for the zone, or null when the zone is not a valid IANA identifier. */
function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(zone);
  if (cached !== undefined) {
    return cached;
  }
  let formatter: Intl.DateTimeFormat | null;
  try {
    const candidate = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatter = isStrictZone(zone, candidate.resolvedOptions().timeZone) ? candidate : null;
  } catch {
    formatter = null;
  }
  // Bounded cache: a hostile stream of distinct zone names cannot grow it (finding N6).
  if (formatterCache.size >= MAX_CACHED_ZONES) {
    for (const oldest of formatterCache.keys()) {
      formatterCache.delete(oldest);
      break;
    }
  }
  formatterCache.set(zone, formatter);
  return formatter;
}

/** True when `zone` is a valid IANA timezone identifier known to the runtime. */
export function isValidTimeZone(zone: string): boolean {
  return zone.length > 0 && formatterFor(zone) !== null;
}

/** The wall-clock fields of an instant in a zone, as a UTC-based millisecond value. */
function wallClockMs(formatter: Intl.DateTimeFormat, instantMs: number): number {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instantMs)).map((p) => [p.type, p.value]),
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

/** The zone's UTC offset in minutes at an instant. */
function offsetMinutes(formatter: Intl.DateTimeFormat, instantMs: number): number {
  return Math.round((wallClockMs(formatter, instantMs) - instantMs) / MS_PER_MINUTE);
}

/** Render an instant as local ISO 8601 with the zone's offset at that instant. */
function renderWithOffset(formatter: Intl.DateTimeFormat, instantMs: number): string {
  const offset = offsetMinutes(formatter, instantMs);
  const local = new Date(wallClockMs(formatter, instantMs)).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${hh}:${mm}`;
}

/**
 * Find the instant whose wall-clock time in the zone is the given local time. The
 * offset is looked up twice so a time just after a daylight saving change resolves
 * to the correct instant.
 */
function localToInstant(formatter: Intl.DateTimeFormat, localMs: number): number {
  const first = localMs - offsetMinutes(formatter, localMs) * MS_PER_MINUTE;
  return localMs - offsetMinutes(formatter, first) * MS_PER_MINUTE;
}

/**
 * Compute the session interval, or undefined when the wire time is not usable. The
 * zone is sessionTime.timezone when present, else `eventTimezone`.
 */
export function computeSessionInterval(
  sessionTime: SessionTime | undefined,
  eventTimezone: string,
): SessionInterval | undefined {
  if (sessionTime === undefined) {
    return undefined;
  }
  const date = DATE_PATTERN.exec(sessionTime.date ?? '');
  const time = TIME_PATTERN.exec(sessionTime.time ?? '');
  if (date === null || time === null || !LENGTH_PATTERN.test(sessionTime.length ?? '')) {
    return undefined;
  }
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const [hour, minute] = [Number(time[1]), Number(time[2])];
  const localMs = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(localMs);
  if (
    hour > 23 ||
    minute > 59 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }
  const formatter = formatterFor(sessionTime.timezone ?? eventTimezone);
  if (formatter === null) {
    return undefined;
  }
  const startMs = localToInstant(formatter, localMs);
  const endMs = startMs + Number(sessionTime.length) * MS_PER_MINUTE;
  return {
    startsAt: renderWithOffset(formatter, startMs),
    endsAt: renderWithOffset(formatter, endMs),
    startMs,
    endMs,
  };
}
