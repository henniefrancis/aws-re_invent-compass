// Deterministic synthetic catalog generator (foundation-contracts, S0).
//
// Produces a made-up re:Invent catalog in the real Events API shape so tests and
// the public demo never touch live data (ADR-016, build plan sections 6 and 9.2).
// Everything is deterministic:
//   - a small in-repo mulberry32 PRNG seeded from a fixed constant, so there is no
//     dependency and the seed is explicit;
//   - fixed, sorted source lists, iterated in order, so output never depends on
//     map or object iteration order;
//   - byte-stable serialization (object keys sorted recursively, a single trailing
//     newline), so the committed files are reproducible to the byte.
//
// The generator emits two files under fixtures/synthetic/:
//   - catalog.json: an array of about 120 SessionWire-shaped sessions;
//   - index.json:   a small manifest (seed, count, and the session ids) so a
//                   consumer can read the catalog size without parsing every
//                   session.
//
// Session titles, speakers and codes are invented. Venue names are real Las Vegas
// re:Invent venues so S2's walking-time data is realistic. The generator
// deliberately includes the required optional-field edge cases: at least one
// repeat (an abbreviation ending in -R or -R<digit>), one all-day session, one
// session with no venue, and one session with no end time (a sessionTime with no
// length). Every generated session parses against SessionWireSchema.
//
// This file contains no em dash or en dash.

// ----------------------------------------------------------------------------
// Deterministic PRNG: mulberry32. Given a 32-bit seed it yields a reproducible
// sequence of floats in [0, 1). Implemented in-repo so the seed is explicit and
// there is no dependency.
// ----------------------------------------------------------------------------

/** The fixed seed. Changing it regenerates a different (still deterministic) catalog. */
export const SEED = 0x5eed1234;

/** The target number of sessions. */
export const SESSION_COUNT = 120;

/**
 * Create a mulberry32 PRNG from a 32-bit seed.
 *
 * @param seed a 32-bit unsigned integer seed
 * @returns a function returning the next float in [0, 1)
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----------------------------------------------------------------------------
// Fixed source lists, all sorted and iterated in order.
// ----------------------------------------------------------------------------

// Real re:Invent Las Vegas venue names (used so S2 walking-time data is realistic).
const VENUES = [
  'Caesars Forum',
  'Encore',
  'Mandalay Bay',
  'MGM Grand',
  'The Venetian',
  'Wynn',
] as const;

// Made-up service area prefixes used to build session codes (two to four letters).
const CODE_PREFIXES = [
  'AIM',
  'ANT',
  'ARC',
  'BWP',
  'CMP',
  'DAT',
  'DEV',
  'NET',
  'SEC',
  'STG',
] as const;

// Made-up title fragments. Combined deterministically into a human-friendly title.
const TITLE_TOPICS = [
  'Serverless APIs',
  'Event-driven systems',
  'Cost optimisation',
  'Zero-downtime deploys',
  'Data lakes',
  'Observability',
  'Container platforms',
  'Identity and access',
  'Edge delivery',
  'Machine learning pipelines',
] as const;

const TITLE_SHAPES = [
  'A builder guide',
  'Patterns and practice',
  'From zero to production',
  'Lessons from the field',
  'Deep dive',
  'Hands on workshop',
] as const;

// Made-up speaker names (first and last lists combined deterministically).
const FIRST_NAMES = [
  'Alex',
  'Blair',
  'Casey',
  'Devon',
  'Emery',
  'Finley',
  'Gray',
  'Harper',
] as const;

const LAST_NAMES = [
  'Adams',
  'Bello',
  'Chen',
  'Diaz',
  'Eriksson',
  'Farrell',
  'Gupta',
  'Haddad',
] as const;

// Known session types and levels (made-up but shaped like the real taxonomy).
// Per the official re:Invent FAQ, keynotes and lecture-style breakout sessions
// take no reservation, so "Breakout session" (and the separately added keynotes)
// are non-reservable. The other four types are reservable.
const TYPES = [
  'Breakout session',
  'Chalk talk',
  'Workshop',
  'Builders session',
  'Code talk',
] as const;

// The session types that take no reservation (walk-up only).
const NON_RESERVABLE_TYPES = new Set<string>(['Breakout session', 'Keynote']);

const LEVELS = ['100', '200', '300', '400'] as const;

// Service taxonomy tokens (made-up labels used for the services array).
const SERVICES = [
  'compute',
  'storage',
  'database',
  'networking',
  'security',
  'analytics',
  'machine-learning',
  'containers',
] as const;

// Seat availability bands for reservable sessions: a realistic mix. Non-reservable
// sessions (breakouts and keynotes) always use "walkUp".
const RESERVABLE_SEAT_BANDS = ['available', 'limited', 'veryLimited', 'unavailable'] as const;

// The five event days (re:Invent 2026 window, local dates, no hard-coded use in
// the contract: these are catalog content only).
const EVENT_DAYS = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'] as const;

const START_TIMES = ['08:30', '10:00', '11:30', '13:00', '14:30', '16:00'] as const;
const LENGTHS = ['60', '90', '120'] as const;

// ----------------------------------------------------------------------------
// Session shape (a subset of SessionWire; the generator only sets fields it means
// to, and every one is valid under SessionWireSchema).
// ----------------------------------------------------------------------------

export interface GeneratedSession {
  sessionId: string;
  title: string;
  abbreviation: string;
  abstract: string;
  type: string;
  level: string;
  venue?: string;
  room?: string;
  isAllDaySession: boolean;
  isReservable: boolean;
  seatAvailability: string;
  sessionTime?: {
    date: string;
    time?: string;
    length?: string;
    timezone: string;
  };
  speakers: Array<{ name: string }>;
  services: string[];
}

// Pick an element deterministically from a list using the next PRNG draw.
function pick<T>(rng: () => number, list: readonly T[]): T {
  const index = Math.floor(rng() * list.length);
  // Guard the upper bound in case rng() returns a value extremely close to 1.
  return list[Math.min(index, list.length - 1)] as T;
}

/**
 * Generate the deterministic catalog as an array of sessions, in id order.
 *
 * @param options optional overrides for the seed and count
 * @returns the generated sessions, sorted by sessionId
 */
export function generateCatalog({
  seed = SEED,
  count = SESSION_COUNT,
}: { seed?: number; count?: number } = {}): GeneratedSession[] {
  const rng = mulberry32(seed);
  const sessions: GeneratedSession[] = [];

  // Reserve the last two ids for the keynotes so the total stays at count.
  const KEYNOTE_COUNT = 2;
  const generatedCount = Math.max(count - KEYNOTE_COUNT, 0);

  for (let i = 0; i < generatedCount; i += 1) {
    // A zero-padded sequence so ids sort lexicographically in numeric order.
    const seq = String(i + 1).padStart(3, '0');
    const sessionId = `syn-${seq}`;

    const prefix = pick(rng, CODE_PREFIXES);
    const codeNumber = 100 + Math.floor(rng() * 400);

    // Every fourth session is a repeat, carrying the -R suffix (sometimes -R<digit>).
    const isRepeat = i % 4 === 0 && i > 0;
    const repeatSuffix = isRepeat ? (i % 8 === 0 ? '-R' : '-R2') : '';
    const abbreviation = `${prefix}${codeNumber}${repeatSuffix}`;

    const title = `${pick(rng, TITLE_TOPICS)}: ${pick(rng, TITLE_SHAPES)}`;
    const speaker = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;

    // Deterministic edge-case flags based on the index so each path is exercised.
    const isAllDay = i === 5; // exactly one all-day session
    const missingVenue = i === 7; // exactly one session with no venue
    const missingEndTime = i === 9; // exactly one session with no end time (no length)

    const day = pick(rng, EVENT_DAYS);
    const startTime = pick(rng, START_TIMES);
    const length = pick(rng, LENGTHS);

    const type = pick(rng, TYPES);
    // A session is reservable only when it is not all-day and its type takes a
    // reservation. Breakouts (and keynotes, added below) are walk-up only.
    const reservable = !isAllDay && !NON_RESERVABLE_TYPES.has(type);
    // Non-reservable sessions are always "walkUp"; reservable sessions get a
    // realistic mix of available, limited, veryLimited and unavailable.
    const seatAvailability = reservable ? pick(rng, RESERVABLE_SEAT_BANDS) : 'walkUp';

    const session: GeneratedSession = {
      sessionId,
      title,
      abbreviation,
      abstract: `A made-up abstract for ${title}. Synthetic data for testing only.`,
      type,
      level: pick(rng, LEVELS),
      isAllDaySession: isAllDay,
      isReservable: reservable,
      seatAvailability,
      speakers: [{ name: speaker }],
      services: [pick(rng, SERVICES)],
    };

    // Venue and room, unless this is the missing-venue case.
    if (!missingVenue) {
      session.venue = pick(rng, VENUES);
      session.room = `Room ${100 + Math.floor(rng() * 40)}`;
    }

    // Session time. An all-day session has a date and timezone but no time or
    // length. The missing-end-time case has a time but no length. Otherwise a full
    // time with a length.
    if (isAllDay) {
      session.sessionTime = { date: day, timezone: 'America/Los_Angeles' };
    } else if (missingEndTime) {
      session.sessionTime = {
        date: day,
        time: startTime,
        timezone: 'America/Los_Angeles',
      };
    } else {
      session.sessionTime = {
        date: day,
        time: startTime,
        length,
        timezone: 'America/Los_Angeles',
      };
    }

    sessions.push(session);
  }

  // Two keynotes (made-up titles). Per the re:Invent FAQ keynotes take no
  // reservation, so they are non-reservable and walk-up only, held at The
  // Venetian. Their ids continue the zero-padded sequence so sorting is stable.
  const KEYNOTE_TITLES = [
    'Opening Keynote: The year ahead',
    'Innovation Keynote: Builders at scale',
  ] as const;
  const KEYNOTE_DAYS = ['2026-11-30', '2026-12-01'] as const;

  for (let k = 0; k < KEYNOTE_COUNT; k += 1) {
    const seq = String(generatedCount + k + 1).padStart(3, '0');
    const codeNumber = 100 + Math.floor(rng() * 400);
    const speaker = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    sessions.push({
      sessionId: `syn-${seq}`,
      title: KEYNOTE_TITLES[k] as string,
      abbreviation: `KEY${codeNumber}`,
      abstract: `A made-up abstract for ${KEYNOTE_TITLES[k]}. Synthetic data for testing only.`,
      type: 'Keynote',
      level: pick(rng, LEVELS),
      isAllDaySession: false,
      isReservable: false,
      seatAvailability: 'walkUp',
      venue: 'The Venetian',
      room: 'Main hall',
      sessionTime: {
        date: KEYNOTE_DAYS[k] as string,
        time: '09:00',
        length: '90',
        timezone: 'America/Los_Angeles',
      },
      speakers: [{ name: speaker }],
      services: [pick(rng, SERVICES)],
    });
  }

  // Sort by sessionId so ordering never depends on insertion details.
  sessions.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  return sessions;
}

// ----------------------------------------------------------------------------
// Byte-stable serialization: sort object keys recursively and end with a single
// trailing newline, so the committed files are reproducible to the byte.
// ----------------------------------------------------------------------------

/**
 * Return a deep copy of value with every plain-object key sorted. Arrays keep their
 * order; primitives are returned as is.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Serialise a value to byte-stable JSON: keys sorted recursively, two-space indent,
 * and a single trailing newline.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

/**
 * The index manifest for the catalog: the seed, the session count and the ordered
 * list of session ids.
 */
export interface CatalogIndex {
  seed: number;
  count: number;
  sessionIds: string[];
}

/**
 * Build the index manifest from a generated catalog.
 */
export function buildIndex(sessions: GeneratedSession[], seed: number = SEED): CatalogIndex {
  return {
    seed,
    count: sessions.length,
    sessionIds: sessions.map((s) => s.sessionId),
  };
}
