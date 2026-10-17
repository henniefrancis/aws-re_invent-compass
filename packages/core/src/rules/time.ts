// Internal time toolkit (itinerary-rules, S2). Not part of the public surface.
//
// Two kinds of time work are kept apart here, as the design requires (Req 11.2):
//   1. Durations and elapsed time are computed on absolute instants (epoch
//      milliseconds parsed from ISO 8601 strings with an offset). A change of the local
//      offset inside the event window can never shift such a result.
//   2. Day bucketing and meal-window placement use event-timezone wall-clock time,
//      read through Intl.DateTimeFormat with the timeZone option.
//
// This file depends only on the Intl global and standard ECMAScript. It imports nothing,
// reads no clock and does not use Temporal. A Date is built only from an explicit
// number, never from the current time.

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

// An ISO 8601 date-time with seconds optional and an offset that is Z or +/-HH:MM.
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const LONG_OFFSET_PATTERN = /GMT([+\-−])(\d{2}):(\d{2})/;

/** Why a timezone cannot be used. */
export type ZoneProblem = 'missing' | 'unrecognised';

/** The result of validating the event timezone. */
export type ZoneCheck = { ok: true; zone: string } | { ok: false; reason: ZoneProblem };

/** Local wall-clock fields for one instant in one timezone. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Parse an ISO 8601 string with an offset to epoch milliseconds. Any other string, or a
 * string that is not a real date, gives undefined.
 */
export function parseInstant(iso: string): number | undefined {
  if (!ISO_PATTERN.test(iso)) {
    return undefined;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Elapsed minutes from one instant to another, computed on the absolute instants. */
export function minutesBetween(startMs: number, endMs: number): number {
  return (endMs - startMs) / MS_PER_MINUTE;
}

/**
 * Validate an IANA timezone name. A missing or empty value is "missing". A value that
 * starts with + or - is rejected as "unrecognised", even though some Intl versions
 * accept fixed offsets. A name that Intl refuses (a thrown RangeError) is "unrecognised".
 * No default timezone is ever substituted.
 */
export function checkZone(zone: string | undefined): ZoneCheck {
  if (!zone) {
    return { ok: false, reason: 'missing' };
  }
  if (zone.startsWith('+') || zone.startsWith('-')) {
    return { ok: false, reason: 'unrecognised' };
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    return { ok: false, reason: 'unrecognised' };
  }
  return { ok: true, zone };
}

function partValues(formatter: Intl.DateTimeFormat, ms: number): Record<string, string> {
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    values[part.type] = part.value;
  }
  return values;
}

/** Read the local wall-clock fields of an instant in a timezone. */
export function wallClock(ms: number, zone: string): WallClock {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const values = partValues(formatter, ms);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

/** The local offset from UTC, in minutes, of a timezone at an instant (longOffset part). */
export function offsetMinutes(ms: number, zone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  });
  const name = partValues(formatter, ms).timeZoneName as string;
  const match = LONG_OFFSET_PATTERN.exec(name) as RegExpExecArray;
  const total = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '+' ? total : -total;
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** Format an offset in minutes as +HH:MM or -HH:MM. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
}

/** The local calendar day of an instant in a timezone, as YYYY-MM-DD. */
export function dayKey(ms: number, zone: string): string {
  const clock = wallClock(ms, zone);
  return `${pad(clock.year, 4)}-${pad(clock.month, 2)}-${pad(clock.day, 2)}`;
}

/** An instant as an ISO 8601 string in the timezone, with its offset (whole seconds). */
export function toZonedIso(ms: number, zone: string): string {
  const clock = wallClock(ms, zone);
  const date = `${pad(clock.year, 4)}-${pad(clock.month, 2)}-${pad(clock.day, 2)}`;
  const time = `${pad(clock.hour, 2)}:${pad(clock.minute, 2)}:${pad(clock.second, 2)}`;
  return `${date}T${time}${formatOffset(offsetMinutes(ms, zone))}`;
}

/** A short local label for an instant: YYYY-MM-DD HH:mm, with :ss only when not zero. */
export function formatLocal(ms: number, zone: string): string {
  const clock = wallClock(ms, zone);
  const date = `${pad(clock.year, 4)}-${pad(clock.month, 2)}-${pad(clock.day, 2)}`;
  const seconds = clock.second === 0 ? '' : `:${pad(clock.second, 2)}`;
  return `${date} ${pad(clock.hour, 2)}:${pad(clock.minute, 2)}${seconds}`;
}

/** Minutes after midnight for a local clock string such as "11:30". */
export function clockToMinutes(clock: string): number {
  const [hours, minutes] = clock.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Convert a local wall-clock time on a local day to an instant.
 *
 * The local offset is read a day before and a day after, and a candidate instant is kept
 * only when its own wall-clock time equals the one asked for. When two offsets are
 * possible (a daylight saving fall-back overlap) the earlier instant wins. When none is
 * valid (a spring-forward gap) the time moves forward by the gap.
 */
export function instantAt(
  day: string,
  minutesOfDay: number,
  seconds: number,
  zone: string,
): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(
    year,
    month - 1,
    date,
    Math.floor(minutesOfDay / 60),
    minutesOfDay % 60,
    seconds,
  );
  const before = offsetMinutes(guess - MS_PER_DAY, zone) * MS_PER_MINUTE;
  const after = offsetMinutes(guess + MS_PER_DAY, zone) * MS_PER_MINUTE;
  const valid = [guess - before, guess - after].filter(
    (candidate) => candidate + offsetMinutes(candidate, zone) * MS_PER_MINUTE === guess,
  );
  return valid.length > 0 ? Math.min(...valid) : guess - before;
}

/** The local day after a local day, as YYYY-MM-DD. */
export function nextDayKey(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/** The instants where a local day starts and where the next local day starts. */
export function dayBounds(day: string, zone: string): { start: number; end: number } {
  return { start: instantAt(day, 0, 0, zone), end: instantAt(nextDayKey(day), 0, 0, zone) };
}
