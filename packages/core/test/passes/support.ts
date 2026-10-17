// Shared test support for the boarding-passes suite (S4). Not a test file: it holds the
// fixed event window, a session factory, a deterministic connection provider and the
// fast-check generators the property tests share.
import fc from 'fast-check';
import type { Commitment, NormalisedSession } from '@compass/contracts';
import type { Clock, ConnectionProvider } from '../../src/passes/interfaces.js';
import type { EventWindow } from '../../src/passes/models.js';

/** The event window used by every test: a fixed, made-up week in Pacific time. */
export const WINDOW: EventWindow = {
  start: '2026-11-30T00:00:00-08:00',
  end: '2026-12-04T23:59:59-08:00',
  timezone: 'America/Los_Angeles',
};

/** Every property test runs at least this many iterations (design, Testing Strategy). */
export const NUM_RUNS = 100;

/** Build a reserved NormalisedSession with sensible defaults and optional overrides. */
export function makeSession(overrides: Partial<NormalisedSession> = {}): NormalisedSession {
  return {
    sessionId: 'sess-0001',
    code: 'DVT301',
    title: 'Build on AWS with the boarding pass pattern',
    venue: 'Venetian',
    room: 'Level 2, Lido 3001',
    startsAt: '2026-12-01T10:30:00-08:00',
    endsAt: '2026-12-01T11:30:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'available',
    missingFields: [],
    ...overrides,
  };
}

/** A reserved-session Commitment. */
export function reservedCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    kind: 'reservedSession',
    sessionId: 'sess-0001',
    startsAt: '2026-12-01T10:30:00-08:00',
    endsAt: '2026-12-01T11:30:00-08:00',
    title: 'Build on AWS with the boarding pass pattern',
    venue: 'Venetian',
    ...overrides,
  };
}

/** A personal-time (layover) Commitment. */
export function layoverCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    kind: 'personalTime',
    title: 'Lunch and a walk',
    startsAt: '2026-12-01T12:00:00-08:00',
    endsAt: '2026-12-01T13:00:00-08:00',
    ...overrides,
  } as Commitment;
}

/** A connection provider backed by a table keyed on "from|to". Unknown pairs are undefined. */
export function fakeConnections(
  table: Record<string, number | undefined> = {},
): ConnectionProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    walkMinutes(fromVenue: string, toVenue: string): number | undefined {
      calls.push(`${fromVenue}|${toVenue}`);
      return table[`${fromVenue}|${toVenue}`];
    },
  };
}

/** The window as epoch milliseconds, for generators. */
const WINDOW_START_MS = Date.parse(WINDOW.start);
const WINDOW_END_MS = Date.parse(WINDOW.end);
const MINUTE_MS = 60_000;

/** A start instant inside the window, leaving room for a session of up to ten hours. */
export const startMsArb = fc.integer({
  min: Math.ceil((WINDOW_START_MS + MINUTE_MS) / MINUTE_MS),
  max: Math.floor((WINDOW_END_MS - 11 * 60 * MINUTE_MS) / MINUTE_MS),
});

/** A valid [startsAt, endsAt] pair inside the window, duration 1 to 600 minutes. */
export const timesArb = fc
  .tuple(startMsArb, fc.integer({ min: 1, max: 600 }))
  .map(([startMinutes, durationMinutes]) => ({
    startsAt: new Date(startMinutes * MINUTE_MS).toISOString(),
    endsAt: new Date((startMinutes + durationMinutes) * MINUTE_MS).toISOString(),
  }));

/** A valid session code, including the repeat marker forms. */
export const sessionCodeArb = fc.stringMatching(/^[A-Z0-9]{2,12}(-R[0-9]?)?$/);

/** Plain safe words, so a generated value always passes the PassFields text rules. */
const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ,-()!'.split('');

/** Safe text of the given length range. May contain leading or trailing spaces. */
export function safeTextArb(minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...SAFE_CHARS), { minLength, maxLength })
    .map((chars) => chars.join(''));
}

/** Safe text that is non-empty after trimming and collapsing whitespace. */
export function visibleTextArb(minLength: number, maxLength: number): fc.Arbitrary<string> {
  return safeTextArb(minLength, maxLength).filter((text) => text.trim().length > 0);
}

/** Text that mixes safe words with hostile fragments the contract refuses. */
const HOSTILE_FRAGMENTS = [
  'https://evil.example/x',
  'www.example.com',
  'example.co.za',
  '10.0.0.1',
  '\u{200B}zero',
  '\u{202E}flip',
  'line\nbreak',
  'tab\there',
  'emoji \u{1F600}',
  '\u{2014}dash\u{2013}',
  '\u{201C}quoted\u{201D}',
  'ellipsis\u{2026}',
  'Node.js',
  '\u{1D49C}\u{1D49D}',
  'café',
  '<script>',
  'plain words',
];

/** Hostile or safe free text of any shape, including empty. */
export const hostileTextArb: fc.Arbitrary<string> = fc
  .array(fc.oneof(fc.constantFrom(...HOSTILE_FRAGMENTS), safeTextArb(0, 30), fc.string()), {
    maxLength: 12,
  })
  .map((parts) => parts.join(' '));

/** A deterministic clock: now is fixed, and sleep records the requested waits. */
export function fakeClock(nowIso = '2026-12-01T08:00:00.000Z'): Clock & { sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => new Date(nowIso),
    sleep(ms: number): Promise<void> {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

/** base64url of a JSON value, as a JWT segment. */
function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * A JWT-shaped ID token whose unverified payload says token_use is id. The label makes the
 * token unique and is carried in the payload and the signature segment.
 */
export function fakeIdToken(label = 'attendee', claims: Record<string, unknown> = {}): string {
  return `${segment({ alg: 'RS256', typ: 'JWT' })}.${segment({ sub: label, token_use: 'id', ...claims })}.${Buffer.from(label, 'utf8').toString('base64url')}`;
}
