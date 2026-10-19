// Time formatting for the pass, always in the event timezone. The timezone is named once,
// on the back of the pass.

// ICU puts a narrow no-break space before AM and PM; a plain space reads the same and is
// kept out of the pass text.
function plain(text: string): string {
  return text.replace(/ /g, ' ');
}

function instant(iso: string): Date {
  return new Date(Date.parse(iso));
}

/** For example "10:20 AM". */
export function formatEventTime(iso: string, timezone: string): string {
  return plain(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(instant(iso)),
  );
}

/** For example "Wed 10:30 AM". */
export function formatEventDayTime(iso: string, timezone: string): string {
  return plain(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(instant(iso)),
  );
}

/** The named parts of an instant in the event timezone, with a 24-hour clock. */
function partsOf(iso: string, timezone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant(iso));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** For example "13:05" (24-hour, Apple pass task 32). */
export function formatEventTime24(iso: string, timezone: string): string {
  const parts = partsOf(iso, timezone);
  return `${parts['hour']}:${parts['minute']}`;
}

/** For example "Thu 13:05" (24-hour, Apple pass task 32). */
export function formatEventDayTime24(iso: string, timezone: string): string {
  const parts = partsOf(iso, timezone);
  return `${parts['weekday']} ${parts['hour']}:${parts['minute']}`;
}

/** For example "Thu, 3 Dec 2026" (Apple pass task 35). */
export function formatEventDate(iso: string, timezone: string): string {
  const parts = partsOf(iso, timezone);
  return `${parts['weekday']}, ${parts['day']} ${parts['month']} ${parts['year']}`;
}

/** The short name of the zone at an instant, for example "PST" (Apple pass task 35). */
export function timezoneAbbreviation(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  }).formatToParts(instant(iso));
  return parts.find((part) => part.type === 'timeZoneName')!.value;
}

/** The generic long name of the zone, for example "Pacific Time". */
export function timezoneName(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longGeneric',
  }).formatToParts(instant(iso));
  return parts.find((part) => part.type === 'timeZoneName')!.value;
}
