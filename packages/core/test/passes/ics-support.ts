// Test support for the calendar and itinerary suites (boarding-passes, S4): an RFC 5545
// validator built on ical.js (Requirement 9.3) and the itinerary generators.
import fc from 'fast-check';
import ICAL from 'ical.js';
import type { Itinerary, ItineraryCommitment } from '../../src/passes/models.js';

/** The CRLF line ending RFC 5545 requires. */
const CRLF = '\r\n';

/**
 * Validate iCalendar text against the parts of RFC 5545 an importer relies on: CRLF line
 * endings with a final CRLF, lines of at most 75 octets, a parseable VCALENDAR with VERSION
 * 2.0 and a PRODID, VEVENTs with a unique UID, a DTSTAMP and UTC start and end, no VTIMEZONE
 * or TZID, and VALARMs with ACTION, TRIGGER and (for DISPLAY) DESCRIPTION. Returns the list
 * of problems, empty when the text is valid.
 */
export function validateRfc5545(text: string): string[] {
  const problems: string[] = [];
  if (!text.endsWith(CRLF)) problems.push('missing final CRLF');
  if (/(^|[^\r])\n/.test(text)) problems.push('bare LF');
  for (const line of text.split(CRLF)) {
    if (Buffer.byteLength(line, 'utf8') > 75) problems.push('line longer than 75 octets');
  }
  if (text.includes('TZID') || text.includes('VTIMEZONE')) problems.push('timezone component');

  let root: InstanceType<typeof ICAL.Component>;
  try {
    root = new ICAL.Component(ICAL.parse(text) as unknown[]);
  } catch {
    return [...problems, 'does not parse'];
  }
  if (root.name !== 'vcalendar') problems.push('root is not VCALENDAR');
  if (root.getFirstPropertyValue('version') !== '2.0') problems.push('VERSION is not 2.0');
  if (root.getFirstPropertyValue('prodid') === null) problems.push('missing PRODID');

  const uids = new Set<string>();
  for (const event of root.getAllSubcomponents('vevent')) {
    const uid = event.getFirstPropertyValue('uid');
    if (typeof uid !== 'string' || uid === '') problems.push('event without UID');
    else if (uids.has(uid)) problems.push('duplicate UID');
    else uids.add(uid);
    for (const name of ['dtstamp', 'dtstart', 'dtend']) {
      const property = event.getFirstProperty(name);
      const value = property?.getFirstValue();
      if (value === undefined || value === null) problems.push(`event without ${name}`);
      else if (
        !(value as { zone?: { tzid?: string } }).zone ||
        (value as { zone: { tzid: string } }).zone.tzid !== 'UTC'
      )
        problems.push(`${name} is not UTC`);
    }
    for (const alarm of event.getAllSubcomponents('valarm')) {
      if (alarm.getFirstPropertyValue('action') !== 'DISPLAY')
        problems.push('alarm is not DISPLAY');
      if (alarm.getFirstPropertyValue('trigger') === null) problems.push('alarm without TRIGGER');
      if (alarm.getFirstPropertyValue('description') === null)
        problems.push('alarm without DESCRIPTION');
    }
  }
  return problems;
}

/** Format an instant as ISO 8601 with the given offset in minutes (0 gives Z). */
export function isoWithOffset(epochMs: number, offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return new Date(epochMs).toISOString().slice(0, 19) + 'Z';
  }
  const local = new Date(epochMs + offsetMinutes * 60_000).toISOString().slice(0, 19);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  return `${local}${sign}${hours}:${minutes}`;
}

const START_MIN = Date.parse('2026-11-30T08:00:00Z') / 60_000;
const START_MAX = Date.parse('2026-12-05T08:00:00Z') / 60_000;

/** A start and end with a random offset, the end 1 to 600 minutes after the start. */
export const timesWithOffsetArb = fc
  .tuple(
    fc.integer({ min: START_MIN, max: START_MAX }),
    fc.integer({ min: 1, max: 600 }),
    fc.constantFrom(0, -480, 120, 330, -300),
  )
  .map(([startMinutes, duration, offset]) => ({
    startsAt: isoWithOffset(startMinutes * 60_000, offset),
    endsAt: isoWithOffset((startMinutes + duration) * 60_000, offset),
  }));

/** Free text that includes commas, semicolons, backslashes, newlines, controls and emoji. */
export const messyTextArb = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 120 }),
  fc.constantFrom(
    'Deep dive, part 2; with extras',
    'Back\\slash and "quotes"',
    'Line one\nLine two\r\nLine three',
    'Emoji \u{1F680} launch',
    'x\r\nBEGIN:VEVENT\r\nUID:evil@example.test\r\nX-INJECTED:1',
    'bidi \u{202E}txt\u{202C} \u{2066}iso\u{2069} \u{200E}',
    'zero\u{200B}width\u{FEFF}joiner\u{200D}',
    'sep\u{2028}arator\u{2029}para',
    'ESC\u{1B}[0m and NUL\u{0} and C1\u{85}',
    'x'.repeat(200),
    '',
  ),
);

/** Identifiers that try to break out of a UID: line breaks, separators, spaces and long text. */
const hostileIdArb = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.constantFrom('x\r\nATTENDEE:mailto:a@example.test', 'a;b,c', 'has space', 'a'.repeat(65), ''),
);

/** A reserved-session commitment with an optional walk. A small id pool forces duplicates. */
const reservedArb: fc.Arbitrary<ItineraryCommitment> = fc
  .record({
    sessionId: fc.oneof(fc.constantFrom('s1', 's2', 's3', 'sess-0004'), hostileIdArb),
    title: fc.option(messyTextArb, { nil: undefined }),
    venue: fc.option(messyTextArb, { nil: undefined }),
    times: timesWithOffsetArb,
    walk: fc.option(fc.integer({ min: 0, max: 90 }), { nil: undefined }),
  })
  .map(({ sessionId, title, venue, times, walk }) => ({
    commitment: { kind: 'reservedSession' as const, sessionId, title, venue, ...times },
    walkMinutes: walk,
  }));

/** A layover commitment, with and without a personalTimeId. A small title pool forces duplicates. */
const layoverArb: fc.Arbitrary<ItineraryCommitment> = fc
  .record({
    title: fc.oneof(messyTextArb, fc.constantFrom('Lunch', 'Coffee')),
    personalTimeId: fc.option(fc.oneof(fc.constantFrom('p1', 'p2'), hostileIdArb), {
      nil: undefined,
    }),
    location: fc.option(messyTextArb, { nil: undefined }),
    times: timesWithOffsetArb,
  })
  .map(({ title, personalTimeId, location, times }) => ({
    commitment: { kind: 'personalTime' as const, title, personalTimeId, location, ...times },
  }));

/** An itinerary of zero to eight commitments. */
export const itineraryArb: fc.Arbitrary<Itinerary> = fc
  .array(fc.oneof(reservedArb, layoverArb), { maxLength: 8 })
  .map((commitments) => ({ commitments }));
