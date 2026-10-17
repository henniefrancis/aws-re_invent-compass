// Generators and samples of valid PassFields for the tests. The event window is made up
// (synthetic): five days in a made-up week, in a fixed zone.
import { createPassFieldsSchema, type PassFields } from '@compass/contracts';
import fc from 'fast-check';

export const TEST_WINDOW = {
  start: '2026-11-30T08:00:00-08:00',
  end: '2026-12-04T20:00:00-08:00',
  timezone: 'America/Los_Angeles',
} as const;

const OFFSET_MINUTES = -8 * 60;
const WINDOW_START_MS = Date.parse(TEST_WINDOW.start);
const WINDOW_END_MS = Date.parse(TEST_WINDOW.end);
const MINUTE = 60_000;

/** ISO 8601 with the window's offset, whole seconds, from an epoch millisecond value. */
export function isoWithOffset(ms: number): string {
  const shifted = new Date(ms + OFFSET_MINUTES * MINUTE).toISOString();
  return `${shifted.slice(0, 19)}-08:00`;
}

export const passFieldsSchema = createPassFieldsSchema(TEST_WINDOW);

const WORDS = [
  'Serverless',
  'Lambda',
  'Data',
  'Lakes',
  'Security',
  'Builders',
  'Workshop',
  'Containers',
  'Observability',
  'Machine',
  'Learning',
  'Storage',
  'Networking',
  'Cost',
  'Migration',
  'Edge',
  'Events',
  'Streaming',
  'Resilience',
  'Identity',
];
const JOINERS = [' ', ' ', ' ', ', ', ' - ', ': ', ' & '];

function textArb(maxLength: number, minWords: number): fc.Arbitrary<string> {
  return fc
    .array(fc.tuple(fc.constantFrom(...WORDS), fc.constantFrom(...JOINERS)), {
      minLength: minWords,
      maxLength: 8,
    })
    .map((parts) => {
      let text = '';
      for (const [word, joiner] of parts) {
        const next = text === '' ? word : `${text}${joiner}${word}`;
        if (next.length > maxLength) {
          break;
        }
        text = next;
      }
      return text === '' ? 'Talk' : text;
    });
}

const sessionCodeArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]{3}$/),
    fc.stringMatching(/^[0-9]{3}$/),
    fc.constantFrom('', '', '-R', '-R1', '-R2'),
  )
  .map(([letters, digits, repeat]) => `${letters}${digits}${repeat}`);

const venueArb = fc.oneof(fc.constant(''), textArb(40, 1));

const startMsArb = fc
  .integer({ min: 0, max: Math.floor((WINDOW_END_MS - WINDOW_START_MS) / MINUTE) - 14 * 60 })
  .map((minutes) => WINDOW_START_MS + minutes * MINUTE);

export const passFieldsArb: fc.Arbitrary<PassFields> = fc
  .tuple(
    sessionCodeArb,
    textArb(80, 1),
    venueArb,
    venueArb,
    startMsArb,
    fc.integer({ min: 15, max: 600 }),
    fc.option(fc.record({ minutes: fc.integer({ min: 0, max: 90 }), fromVenue: venueArb }), {
      nil: undefined,
    }),
    fc.option(
      fc.record({
        sessionCode: sessionCodeArb,
        venue: venueArb,
        walkMinutes: fc.integer({ min: 0, max: 90 }),
        gapMinutes: fc.integer({ min: 1, max: 120 }),
      }),
      { nil: undefined },
    ),
    fc.option(textArb(40, 1), { nil: undefined }),
  )
  .map(([sessionCode, title, venue, room, startMs, durationMinutes, walk, next, name]) => {
    const endMs = startMs + durationMinutes * MINUTE;
    const fields: PassFields = {
      sessionCode,
      title,
      venue,
      room,
      startsAt: isoWithOffset(startMs),
      endsAt: isoWithOffset(endMs),
    };
    if (walk !== undefined) {
      fields.walkFromPrevious = walk;
    }
    if (next !== undefined) {
      fields.nextConnection = {
        sessionCode: next.sessionCode,
        startsAt: isoWithOffset(endMs + next.gapMinutes * MINUTE),
        venue: next.venue,
        walkMinutes: next.walkMinutes,
      };
    }
    if (name !== undefined) {
      fields.attendeeName = name;
    }
    return fields;
  });

/** A fixed, valid sample. */
export function samplePassFields(overrides: Partial<PassFields> = {}): PassFields {
  return {
    sessionCode: 'DAT302-R',
    title: 'Data Lakes at scale',
    venue: 'Made Up Hall',
    room: 'Room 101',
    startsAt: '2026-12-02T10:00:00-08:00',
    endsAt: '2026-12-02T11:00:00-08:00',
    ...overrides,
  };
}
