import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import type { z } from 'zod';
import {
  SessionWireSchema,
  SessionTimeSchema,
  ScheduleWireSchema,
  ListSessionsSchema,
  GetSessionSchema,
  GetScheduleSchema,
  PersonalTimeSchema,
  PersonalTimeInputSchema,
  EventSchema,
  BulkResultSchema,
  BulkFailureSchema,
  NormalisedSessionSchema,
  CommitmentSchema,
  VenueSchema,
  VerdictSchema,
  ProblemSchema,
  createPassFieldsSchema,
  mcpTools,
} from '../src/index.js';

// Property test for schemas accepting valid inputs and stripping unknown fields
// (foundation-contracts, S0).
//
// Property 2: Schemas accept valid inputs and strip unknown fields.
// Validates: Requirements 4.1, 4.2, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11.
//
// For every shared OBJECT schema (the wire schemas, the domain types, Problem, the
// PassFields factory instance and every MCP tool input and output), and for all valid
// generated inputs, parsing succeeds; and when arbitrary unknown extra fields are added
// to an otherwise valid value, parsing still succeeds, the unknown fields are stripped
// (not carried through), and only the known fields are preserved.
//
// The two scalar/transform schemas (SeatAvailabilitySchema and BulkFailureCodeSchema)
// are intentionally excluded from the strip assertion because they are not objects; they
// are covered by Property 4 (wire enum forward-compatibility).

// Any zod schema whose parsed output is a plain object. Kept deliberately wide so one
// list can hold wire, domain, Problem, PassFields and MCP tool schemas together.
type ObjectSchema = z.ZodType<Record<string, unknown>, unknown>;

// At least 100 iterations per property, as required for this spec's property tests. Each
// schema is exercised in its own fc.assert run, so every schema gets the full count.
const NUM_RUNS = 120;

// A fixed event window for the PassFields factory, taken from the task brief. No date is
// hard-coded in the contract itself: the window is supplied here only to build a schema
// instance to test.
const PASS_WINDOW = {
  start: '2026-11-30T00:00:00-08:00',
  end: '2026-12-05T00:00:00-08:00',
  timezone: 'America/Los_Angeles',
} as const;

const PassFieldsSchema = createPassFieldsSchema(PASS_WINDOW) as unknown as ObjectSchema;

// ----------------------------------------------------------------------------------
// Small shared generators for valid field values.
// ----------------------------------------------------------------------------------

// A plain non-empty string. Used for the many free-form string fields that the wire and
// domain schemas accept without constraint.
const plainString = (): fc.Arbitrary<string> => fc.string({ minLength: 1, maxLength: 16 });

// An array of plain strings, zero to a few entries.
const stringArray = (): fc.Arbitrary<string[]> => fc.array(plainString(), { maxLength: 3 });

// Safe free text for PassFields: letters, digits and single spaces only, so it never
// trips the URL, domain, control-character or bidirectional-override checks and never
// collapses to an empty or whitespace-only value when a minimum length applies.
const safeText = (minLength: number, maxLength: number): fc.Arbitrary<string> =>
  fc
    .array(
      fc.constantFrom(
        ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '.split(''),
      ),
      { minLength: Math.max(minLength, 1), maxLength },
    )
    .map((chars) => chars.join('').trim())
    .filter((s) => s.length >= minLength && s.length <= maxLength);

// A session code matching ^[A-Z0-9]{2,12}(-R[0-9]?)?$.
const sessionCode = (): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc
        .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
          minLength: 2,
          maxLength: 12,
        })
        .map((chars) => chars.join('')),
      fc.constantFrom('', '-R', '-R1', '-R2', '-R9'),
    )
    .map(([base, suffix]) => `${base}${suffix}`);

// An ISO-8601-with-offset instant that lands INSIDE the PassFields window, paired with an
// end that is after it and at most 10 hours later. The window is roughly five days wide,
// so a start offset of 0 to 4 days plus a duration of 1 to 10 hours always stays inside.
const windowStartMs = Date.parse(PASS_WINDOW.start);
const windowEndMs = Date.parse(PASS_WINDOW.end);

const passTimes = (): fc.Arbitrary<{ startsAt: string; endsAt: string }> =>
  fc
    .tuple(
      // Minutes from window start, leaving at least 10 hours of headroom before window end.
      fc.integer({
        min: 0,
        max: Math.floor((windowEndMs - windowStartMs) / 60000) - 10 * 60,
      }),
      // Session length in minutes, 1 minute to 10 hours (the maximum the schema allows).
      fc.integer({ min: 1, max: 10 * 60 }),
    )
    .map(([offsetMin, lengthMin]) => {
      const startMs = windowStartMs + offsetMin * 60000;
      const endMs = startMs + lengthMin * 60000;
      return {
        startsAt: isoWithOffset(startMs),
        endsAt: isoWithOffset(endMs),
      };
    });

// Format a millisecond instant as an ISO-8601 string with a fixed -08:00 offset so it
// matches the schema's offset-required pattern. The offset is applied by shifting the
// displayed wall-clock time; the instant represented stays correct for the comparison.
function isoWithOffset(ms: number): string {
  const offsetMinutes = -8 * 60;
  const shifted = new Date(ms + offsetMinutes * 60000);
  const yyyy = shifted.getUTCFullYear().toString().padStart(4, '0');
  const mm = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = shifted.getUTCDate().toString().padStart(2, '0');
  const hh = shifted.getUTCHours().toString().padStart(2, '0');
  const mi = shifted.getUTCMinutes().toString().padStart(2, '0');
  const ss = shifted.getUTCSeconds().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-08:00`;
}

// ----------------------------------------------------------------------------------
// Valid-value arbitraries, one per object schema.
// ----------------------------------------------------------------------------------

const sessionTimeArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      date: plainString(),
      time: plainString(),
      length: plainString(),
      timezone: plainString(),
    },
    { requiredKeys: [] },
  );

const sessionWireArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      sessionId: plainString(),
      title: plainString(),
      abbreviation: sessionCode(),
      abstract: plainString(),
      type: plainString(),
      level: plainString(),
      venue: plainString(),
      room: plainString(),
      isAllDaySession: fc.boolean(),
      isReservable: fc.boolean(),
      seatAvailability: fc.constantFrom('available', 'limited', 'walkUp', 'anythingElse'),
      sessionTime: sessionTimeArb(),
      speakers: fc.array(fc.record({ name: plainString() }, { requiredKeys: [] }), {
        maxLength: 3,
      }),
      tracks: stringArray(),
      topics: stringArray(),
      industries: stringArray(),
      areasOfInterest: stringArray(),
      roles: stringArray(),
      services: stringArray(),
      segments: stringArray(),
      features: stringArray(),
      customerPersonas: stringArray(),
      experiences: stringArray(),
      additionalActivities: stringArray(),
      focusAreas: stringArray(),
    },
    // Only sessionId and title are required; every other field is optional on the wire.
    { requiredKeys: ['sessionId', 'title'] },
  );

const personalTimeArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      personalTimeId: plainString(),
      startDateTime: plainString(),
      endDateTime: plainString(),
      title: plainString(),
      description: plainString(),
      location: plainString(),
    },
    { requiredKeys: ['personalTimeId', 'startDateTime', 'endDateTime', 'title', 'description'] },
  );

const personalTimeInputArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      startDateTime: plainString(),
      endDateTime: plainString(),
      title: plainString(),
      description: plainString(),
      location: plainString(),
    },
    { requiredKeys: ['startDateTime', 'endDateTime', 'title', 'description'] },
  );

const scheduleWireArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    reserved: stringArray(),
    favorites: stringArray(),
    personalTime: fc.array(personalTimeArb(), { maxLength: 2 }),
  });

const listSessionsArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      items: fc.array(sessionWireArb(), { maxLength: 2 }),
      totalCount: fc.nat(),
      nextToken: plainString(),
    },
    { requiredKeys: ['items', 'totalCount'] },
  );

const getSessionArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({ session: sessionWireArb() });

const getScheduleArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({ schedule: scheduleWireArb() });

const eventArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      eventId: plainString(),
      name: plainString(),
      eventType: plainString(),
      startDate: plainString(),
      endDate: plainString(),
      isOnline: fc.boolean(),
      authenticationRequired: fc.boolean(),
      timezone: plainString(),
      timezoneAbbreviation: plainString(),
      timeFormat: plainString(),
      address: fc.record({ city: plainString() }, { requiredKeys: [] }),
      supportedLanguageCodes: stringArray(),
    },
    {
      requiredKeys: [
        'eventId',
        'name',
        'eventType',
        'startDate',
        'endDate',
        'isOnline',
        'authenticationRequired',
      ],
    },
  );

const bulkFailureArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      sessionId: plainString(),
      code: fc.constantFrom('sessionFull', 'scheduleConflict', 'other', 'somethingNew'),
      conflictsWith: stringArray(),
    },
    { requiredKeys: ['sessionId', 'code'] },
  );

const bulkResultArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    successful: stringArray(),
    failed: fc.array(bulkFailureArb(), { maxLength: 2 }),
  });

const normalisedSessionArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      sessionId: plainString(),
      code: plainString(),
      title: plainString(),
      type: plainString(),
      level: plainString(),
      venue: plainString(),
      room: plainString(),
      startsAt: plainString(),
      endsAt: plainString(),
      isAllDay: fc.boolean(),
      isReservable: fc.boolean(),
      seatAvailability: fc.constantFrom('available', 'limited', 'walkUp', 'brandNew'),
      repeatOf: plainString(),
      missingFields: stringArray(),
    },
    {
      requiredKeys: [
        'sessionId',
        'code',
        'title',
        'isAllDay',
        'isReservable',
        'seatAvailability',
        'missingFields',
      ],
    },
  );

const commitmentArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.oneof(
    fc.record(
      {
        kind: fc.constant('reservedSession'),
        sessionId: plainString(),
        startsAt: plainString(),
        endsAt: plainString(),
        title: plainString(),
        venue: plainString(),
      },
      { requiredKeys: ['kind', 'sessionId', 'startsAt', 'endsAt'] },
    ),
    fc.record(
      {
        kind: fc.constant('personalTime'),
        title: plainString(),
        startsAt: plainString(),
        endsAt: plainString(),
        personalTimeId: plainString(),
        location: plainString(),
      },
      { requiredKeys: ['kind', 'title', 'startsAt', 'endsAt'] },
    ),
  );

const venueArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      name: plainString(),
      coordinates: fc.record({
        lat: fc.double({ noNaN: true, noDefaultInfinity: true, min: -90, max: 90 }),
        lon: fc.double({ noNaN: true, noDefaultInfinity: true, min: -180, max: 180 }),
      }),
    },
    { requiredKeys: ['name'] },
  );

const verdictArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.oneof(
    // allow may carry zero or more reasons.
    fc.record({ decision: fc.constant('allow'), reasons: stringArray() }),
    // warn and block always carry at least one reason.
    fc.record({
      decision: fc.constant('warn'),
      reasons: fc.array(plainString(), { minLength: 1, maxLength: 3 }),
    }),
    fc.record({
      decision: fc.constant('block'),
      reasons: fc.array(plainString(), { minLength: 1, maxLength: 3 }),
    }),
  );

const problemArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    type: plainString(),
    title: plainString(),
    status: fc.integer({ min: 100, max: 599 }),
    code: plainString(),
  });

const passFieldsArb = (): fc.Arbitrary<Record<string, unknown>> =>
  passTimes().chain((times) =>
    fc.record(
      {
        sessionCode: sessionCode(),
        title: safeText(1, 80),
        venue: safeText(0, 40),
        room: safeText(0, 40),
        startsAt: fc.constant(times.startsAt),
        endsAt: fc.constant(times.endsAt),
        walkFromPrevious: fc.record({
          minutes: fc.integer({ min: 0, max: 90 }),
          fromVenue: safeText(0, 40),
        }),
        nextConnection: passTimes().map((t) => ({
          sessionCode: 'NEXT1',
          startsAt: t.startsAt,
          venue: 'Venetian',
          walkMinutes: 5,
        })),
        attendeeName: safeText(1, 40),
      },
      { requiredKeys: ['sessionCode', 'title', 'venue', 'room', 'startsAt', 'endsAt'] },
    ),
  );

// ----------------------------------------------------------------------------------
// The object schema list under test, each paired with a valid-value arbitrary.
// ----------------------------------------------------------------------------------

interface SchemaCase {
  name: string;
  schema: ObjectSchema;
  arb: fc.Arbitrary<Record<string, unknown>>;
  // Every known top-level field name for the schema, including optional fields that a
  // given generated value may omit. An injected "unknown" key must never be one of these,
  // otherwise it is a known field the schema legitimately keeps, not a stray to be stripped.
  knownKeys: string[];
}

const schemaCases: SchemaCase[] = [
  {
    name: 'SessionTimeSchema',
    schema: SessionTimeSchema,
    arb: sessionTimeArb(),
    knownKeys: ['date', 'time', 'length', 'timezone'],
  },
  {
    name: 'SessionWireSchema',
    schema: SessionWireSchema,
    arb: sessionWireArb(),
    knownKeys: [
      'sessionId',
      'title',
      'abbreviation',
      'abstract',
      'type',
      'level',
      'venue',
      'room',
      'isAllDaySession',
      'isReservable',
      'seatAvailability',
      'sessionTime',
      'speakers',
      'tracks',
      'topics',
      'industries',
      'areasOfInterest',
      'roles',
      'services',
      'segments',
      'features',
      'customerPersonas',
      'experiences',
      'additionalActivities',
      'focusAreas',
    ],
  },
  {
    name: 'ScheduleWireSchema',
    schema: ScheduleWireSchema,
    arb: scheduleWireArb(),
    knownKeys: ['reserved', 'favorites', 'personalTime'],
  },
  {
    name: 'ListSessionsSchema',
    schema: ListSessionsSchema,
    arb: listSessionsArb(),
    knownKeys: ['items', 'totalCount', 'nextToken'],
  },
  {
    name: 'GetSessionSchema',
    schema: GetSessionSchema,
    arb: getSessionArb(),
    knownKeys: ['session'],
  },
  {
    name: 'GetScheduleSchema',
    schema: GetScheduleSchema,
    arb: getScheduleArb(),
    knownKeys: ['schedule'],
  },
  {
    name: 'PersonalTimeSchema',
    schema: PersonalTimeSchema,
    arb: personalTimeArb(),
    knownKeys: [
      'personalTimeId',
      'startDateTime',
      'endDateTime',
      'title',
      'description',
      'location',
    ],
  },
  {
    name: 'PersonalTimeInputSchema',
    schema: PersonalTimeInputSchema,
    arb: personalTimeInputArb(),
    knownKeys: ['startDateTime', 'endDateTime', 'title', 'description', 'location'],
  },
  {
    name: 'EventSchema',
    schema: EventSchema,
    arb: eventArb(),
    knownKeys: [
      'eventId',
      'name',
      'eventType',
      'startDate',
      'endDate',
      'isOnline',
      'authenticationRequired',
      'timezone',
      'timezoneAbbreviation',
      'timeFormat',
      'address',
      'supportedLanguageCodes',
    ],
  },
  {
    name: 'BulkResultSchema',
    schema: BulkResultSchema,
    arb: bulkResultArb(),
    knownKeys: ['successful', 'failed'],
  },
  {
    name: 'BulkFailureSchema',
    schema: BulkFailureSchema,
    arb: bulkFailureArb(),
    knownKeys: ['sessionId', 'code', 'conflictsWith'],
  },
  {
    name: 'NormalisedSessionSchema',
    schema: NormalisedSessionSchema,
    arb: normalisedSessionArb(),
    knownKeys: [
      'sessionId',
      'code',
      'title',
      'type',
      'level',
      'venue',
      'room',
      'startsAt',
      'endsAt',
      'isAllDay',
      'isReservable',
      'seatAvailability',
      'repeatOf',
      'missingFields',
    ],
  },
  {
    name: 'CommitmentSchema',
    schema: CommitmentSchema,
    arb: commitmentArb(),
    // Both variants together: the discriminant plus every field of either variant.
    knownKeys: [
      'kind',
      'sessionId',
      'startsAt',
      'endsAt',
      'title',
      'venue',
      'personalTimeId',
      'location',
    ],
  },
  {
    name: 'VenueSchema',
    schema: VenueSchema,
    arb: venueArb(),
    knownKeys: ['name', 'coordinates'],
  },
  {
    name: 'VerdictSchema',
    schema: VerdictSchema,
    arb: verdictArb(),
    knownKeys: ['decision', 'reasons'],
  },
  {
    name: 'ProblemSchema',
    schema: ProblemSchema,
    arb: problemArb(),
    knownKeys: ['type', 'title', 'status', 'code'],
  },
  {
    name: 'PassFieldsSchema',
    schema: PassFieldsSchema,
    arb: passFieldsArb(),
    knownKeys: [
      'sessionCode',
      'title',
      'venue',
      'room',
      'startsAt',
      'endsAt',
      'walkFromPrevious',
      'nextConnection',
      'attendeeName',
    ],
  },
];

// ----------------------------------------------------------------------------------
// Valid MCP tool input and output samples, one minimal valid value per tool. These give
// real coverage of every tool input and output schema when the unknown-field injection
// runs over them.
// ----------------------------------------------------------------------------------

const normalisedSample = {
  sessionId: 's1',
  code: 'AIM101',
  title: 'Sample session',
  isAllDay: false,
  isReservable: true,
  seatAvailability: 'available',
  missingFields: [],
};

const commitmentSample = {
  kind: 'reservedSession',
  sessionId: 's1',
  startsAt: '2026-12-01T09:00:00-08:00',
  endsAt: '2026-12-01T10:00:00-08:00',
};

const verdictSample = { decision: 'allow', reasons: [] };
const bulkResultSample = { successful: ['s1'], failed: [] };
const personalTimeInputSample = {
  startDateTime: '2026-12-01T12:00:00-08:00',
  endDateTime: '2026-12-01T13:00:00-08:00',
  title: 'Lunch',
  description: 'Layover',
};

const toolSamples: Record<
  string,
  { input: Record<string, unknown>; output: Record<string, unknown> }
> = {
  sign_in: { input: { force: true }, output: { signedIn: true } },
  sign_out: { input: {}, output: { signedOut: true } },
  refresh_catalog: {
    input: { force: false },
    output: { sessionCount: 120, refreshedAt: '2026-11-30T00:00:00-08:00' },
  },
  find_sessions: {
    input: { query: 'ai', filters: { services: ['bedrock'], level: '300' }, limit: 10 },
    output: { sessions: [normalisedSample], totalMatched: 1 },
  },
  scan_repo: {
    input: { path: '/repo' },
    output: {
      services: ['bedrock'],
      depthByService: [{ service: 'bedrock', depth: 2 }],
      technologies: [{ technology: '.NET', score: 12 }],
    },
  },
  plan_week: {
    input: { goals: ['learn'], level: '300', maxPerDay: 4 },
    output: { commitments: [commitmentSample] },
  },
  check_itinerary: {
    input: { commitments: [commitmentSample] },
    output: { verdict: verdictSample },
  },
  show_schedule: {
    input: {},
    output: {
      schedule: {
        reserved: ['s1'],
        favorites: ['s2'],
        personalTime: [{ ...personalTimeInputSample, personalTimeId: 'pt1' }],
      },
      notInCatalog: ['s2'],
    },
  },
  reserve_with_guardrails: {
    input: { sessionIds: ['AIM101'] },
    output: { verdict: verdictSample, result: bulkResultSample },
  },
  cancel_reservation: { input: { sessionId: 's1' }, output: { cancelled: true } },
  add_standby: { input: { sessionIds: ['AIM101'] }, output: { result: bulkResultSample } },
  remove_standby: { input: { sessionId: 's1' }, output: { removed: true } },
  add_layover: {
    input: { action: 'create', personalTime: personalTimeInputSample },
    output: { action: 'create', done: true, personalTimeId: 'pt1' },
  },
  issue_boarding_passes: {
    input: { sessionIds: ['AIM101'] },
    output: { issued: ['s1'], serials: ['serial-1'] },
  },
  send_to_phone: {
    input: { sessionIds: ['s1'] },
    output: { handoffUrl: 'https://example/handoff', expiresAt: '2026-12-01T00:15:00-08:00' },
  },
  sync_passes: {
    input: { sessionIds: ['s1'] },
    output: { issued: ['s1'], updated: [], voided: [] },
  },
  export_calendar: {
    input: { commitments: [commitmentSample] },
    output: { ics: 'BEGIN:VCALENDAR' },
  },
  forget_me: { input: { confirm: true }, output: { forgotten: true } },
  show_my_tech: {
    input: { top: 5 },
    output: {
      services: [{ service: 'Amazon S3', depth: 2, projects: 3 }],
      technologies: [{ technology: '.NET', group: 'platform', projects: 2, score: 40 }],
      sources: { folders: 1, githubRepositories: 4 },
    },
  },
  find_sessions_by_tech: {
    input: { tech: '.NET', limit: 10 },
    output: { groups: [{ tech: '.NET', sessions: [normalisedSample], totalMatched: 1 }] },
  },
  connect_github: {
    input: {},
    output: {
      state: 'waiting',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
    },
  },
  scan_github: {
    input: { owners: ['octo-org'], includeForks: false, maxRepositories: 50 },
    output: { scanned: 4, skipped: 1, services: ['Amazon S3'], technologies: ['.NET'] },
  },
  disconnect_github: { input: {}, output: { disconnected: true } },
};

// ----------------------------------------------------------------------------------
// The shared assertion: a valid value parses, and the same value with injected unknown
// keys still parses, strips the unknown keys and preserves the known fields.
// ----------------------------------------------------------------------------------

// Generate a set of unknown extra keys with arbitrary JSON values. Keys are filtered so
// they are never one of the schema's known top-level keys and never empty.
function unknownFieldsArb(knownKeys: Set<string>): fc.Arbitrary<Record<string, unknown>> {
  return fc.dictionary(
    fc.string({ minLength: 1, maxLength: 12 }).filter((k) => !knownKeys.has(k)),
    fc.anything(),
    { maxKeys: 4 },
  );
}

// Assert accept-and-strip for a single schema. A valid base value and an unknown-field
// overlay are generated together in one flat property, so each schema runs NUM_RUNS
// iterations total (not NUM_RUNS squared). knownKeyList is the schema's full top-level
// field set (including optional fields a base may omit), so an injected key is never a
// legitimate known field.
function assertStrips(
  schema: ObjectSchema,
  baseArb: fc.Arbitrary<Record<string, unknown>>,
  knownKeyList: string[],
  schemaName: string,
): void {
  const knownKeys = new Set(knownKeyList);

  fc.assert(
    fc.property(baseArb, unknownFieldsArb(knownKeys), (base, unknown) => {
      // 1. The base value is valid: parsing a correctly shaped value succeeds.
      const baseResult = schema.safeParse(base);
      expect(baseResult.success, `${schemaName} rejected a value it should accept`).toBe(true);
      if (!baseResult.success) {
        return;
      }

      const injectedKeys = Object.keys(unknown);
      // Unknown keys first, then the base, so a known key always wins a collision. Since
      // the generator already excludes known keys, there is no collision in practice.
      const augmented = { ...unknown, ...base };

      const augmentedResult = schema.safeParse(augmented);
      // 2. Parsing still succeeds with the unknown fields present.
      expect(augmentedResult.success).toBe(true);
      if (!augmentedResult.success) {
        return;
      }

      const parsed = augmentedResult.data;
      // 3. None of the injected unknown keys survive: they are stripped.
      for (const key of injectedKeys) {
        expect(Object.prototype.hasOwnProperty.call(parsed, key)).toBe(false);
      }
      // 4. Only the known fields are preserved: the augmented parse equals the base parse.
      expect(parsed).toEqual(baseResult.data);
    }),
    { numRuns: NUM_RUNS },
  );
}

describe('Feature: foundation-contracts, Property 2: Schemas accept valid inputs and strip unknown fields', () => {
  test('Feature: foundation-contracts, Property 2: Schemas accept valid inputs and strip unknown fields', () => {
    // Every listed object schema: generate a valid value, then check accept-and-strip.
    for (const { name, schema, arb, knownKeys } of schemaCases) {
      assertStrips(schema, arb, knownKeys, name);
    }
  });

  test('Feature: foundation-contracts, Property 2: MCP tool inputs and outputs accept valid inputs and strip unknown fields', () => {
    // The known top-level key set for a plain zod object schema, read from its shape. Every
    // MCP tool input and output is a plain z.object, so this yields the full field set
    // including optional fields a given sample omits.
    const shapeKeys = (schema: unknown): string[] => {
      const shape = (schema as { shape?: Record<string, unknown> }).shape;
      return shape ? Object.keys(shape) : [];
    };

    // Every MCP tool input and output schema, over its valid sample.
    for (const [toolName, tool] of Object.entries(mcpTools)) {
      const sample = toolSamples[toolName];
      expect(sample, `missing sample for tool ${toolName}`).toBeDefined();

      assertStrips(
        tool.input,
        fc.constant(sample.input),
        shapeKeys(tool.input),
        `${toolName}.input`,
      );
      assertStrips(
        tool.output,
        fc.constant(sample.output),
        shapeKeys(tool.output),
        `${toolName}.output`,
      );
    }
  });
});
