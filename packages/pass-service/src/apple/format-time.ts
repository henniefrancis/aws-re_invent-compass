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

/** The generic long name of the zone, for example "Pacific Time". */
export function timezoneName(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longGeneric',
  }).formatToParts(instant(iso));
  return parts.find((part) => part.type === 'timeZoneName')!.value;
}
