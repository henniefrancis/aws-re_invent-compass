// Event local time formatting (showcase-site, Component 15).
//
// Times on the site are shown in the event's local time. The hand-off page knows no IANA
// zone, so it reads the wall clock written in the ISO string itself. The demo knows the zone
// and uses Intl. Both give the same text for the same instant.

import { parseIsoWithOffset } from './iso';

/** Shown when a value is not an ISO 8601 date-time with an offset. Never an invented time. */
export const TIME_NOT_AVAILABLE = 'Time not available';

const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const NARROW_NO_BREAK_SPACE = String.fromCharCode(0x202f);

function twelveHour(hour: number, minute: string): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${String(hour % 12 === 0 ? 12 : hour % 12)}:${minute} ${suffix}`;
}

/** The hour and minute written in the string, in 12-hour form, such as "10:20 AM". */
export function formatWallClock(iso: string): string {
  const match = ISO_WITH_OFFSET.exec(iso);
  if (match === null) {
    return TIME_NOT_AVAILABLE;
  }
  return twelveHour(Number(match[4]), match[5] as string);
}

/**
 * The wall clock, 24-hour (such as "09:48"), of the moment a number of minutes before an
 * instant, written in the offset of the instant's own text. Returns TIME_NOT_AVAILABLE when the
 * text is not an ISO 8601 date-time with an offset.
 */
export function formatMinutesBefore24(iso: string, minutes: number): string {
  const match = ISO_WITH_OFFSET.exec(iso);
  const instant = parseIsoWithOffset(iso);
  if (match === null || instant === null) {
    return TIME_NOT_AVAILABLE;
  }
  const offset = match[6] as string;
  const sign = offset.startsWith('-') ? -1 : 1;
  const offsetMinutes =
    offset === 'Z' ? 0 : sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(instant - minutes * 60_000 + offsetMinutes * 60_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** The offset written in the string, such as "UTC-08:00". Zero offsets read "UTC". */
export function offsetLabel(iso: string): string {
  const match = ISO_WITH_OFFSET.exec(iso);
  if (match === null) {
    return 'offset not available';
  }
  const offset = match[6] as string;
  return offset === 'Z' || offset === '+00:00' || offset === '-00:00' ? 'UTC' : `UTC${offset}`;
}

/** The wall clock of an instant in an IANA zone, in 12-hour form, such as "10:20 AM". */
export function formatInZone(iso: string, timeZone: string): string {
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
  return text.split(NARROW_NO_BREAK_SPACE).join(' ');
}

function zoneParts(iso: string, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** The wall clock of an instant in an IANA zone, 24-hour, such as "13:00". */
export function formatInZone24(iso: string, timeZone: string): string {
  const parts = zoneParts(iso, timeZone);
  return `${parts['hour']}:${parts['minute']}`;
}

/** The date of an instant in an IANA zone, such as "3 Dec 2026". */
export function formatDateInZone(iso: string, timeZone: string): string {
  const parts = zoneParts(iso, timeZone);
  return `${parts['day']} ${parts['month']} ${parts['year']}`;
}

/** A short date for a board session card, for example "Mon, 30 Nov 2026" (task 39). */
export function shortDay(isoDate: string): string {
  const date = new Date(
    Date.UTC(
      Number(isoDate.slice(0, 4)),
      Number(isoDate.slice(5, 7)) - 1,
      Number(isoDate.slice(8, 10)),
    ),
  );
  const part = (options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date);
  return `${part({ weekday: 'short' })}, ${part({ day: 'numeric' })} ${part({ month: 'short' })} ${part({ year: 'numeric' })}`;
}

/** A day heading such as "Monday 30 November", from an event local date (YYYY-MM-DD). */
export function dayHeading(isoDate: string): string {
  const date = new Date(
    Date.UTC(
      Number(isoDate.slice(0, 4)),
      Number(isoDate.slice(5, 7)) - 1,
      Number(isoDate.slice(8, 10)),
    ),
  );
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * One note stating the offset when every value in the view has the same offset, otherwise
 * null (each row then shows its own offset).
 */
export function timezoneNote(isos: readonly string[]): string | null {
  const first = isos[0];
  if (first === undefined) {
    return null;
  }
  const offset = offsetLabel(first);
  return isos.every((iso) => offsetLabel(iso) === offset)
    ? `Times are event local time (${offset}).`
    : null;
}
