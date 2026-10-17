// Strict ISO 8601 date-time parsing (showcase-site).
//
// Date.parse accepts dates that do not exist (30 February) and the hour 24. A hand-off is
// refused whole when a date-time is not a real one, so the board page uses this parser.

const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * The instant, in milliseconds since the epoch, of an ISO 8601 date-time that carries an
 * offset (Z or +HH:MM or -HH:MM), or null when the text is not a real date-time of that form.
 */
export function parseIsoWithOffset(text: string): number | null {
  const match = ISO_DATE_TIME.exec(text);
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const offsetHours = Number(match[9] ?? 0);
  const offsetMinutes = Number(match[10] ?? 0);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const real =
    year >= 1000 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHours <= 23 &&
    offsetMinutes <= 59;
  if (!real) {
    return null;
  }
  const sign = match[8] === '-' ? -1 : 1;
  const fraction = Math.floor(Number(`0${match[7] ?? ''}`) * 1000);
  return (
    Date.UTC(year, month - 1, day, hour, minute, second, fraction) -
    sign * (offsetHours * 60 + offsetMinutes) * 60_000
  );
}

/** An instant as an iCalendar UTC stamp, YYYYMMDDTHHMMSSZ, or null when the text is not a real date-time. */
export function toUtcStamp(iso: string): string | null {
  const ms = parseIsoWithOffset(iso);
  return ms === null
    ? null
    : `${new Date(ms).toISOString().slice(0, 19).split('-').join('').split(':').join('')}Z`;
}
