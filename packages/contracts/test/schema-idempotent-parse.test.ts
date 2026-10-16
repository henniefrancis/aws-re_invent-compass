import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import type { z } from 'zod';
import {
  SessionWireSchema,
  SessionTimeSchema,
  SeatAvailabilitySchema,
  ScheduleWireSchema,
  ListSessionsSchema,
  GetSessionSchema,
  GetScheduleSchema,
  PersonalTimeSchema,
  PersonalTimeInputSchema,
  EventSchema,
  BulkResultSchema,
  BulkFailureSchema,
  BulkFailureCodeSchema,
  NormalisedSessionSchema,
  CommitmentSchema,
  VenueSchema,
  VerdictSchema,
  ProblemSchema,
  createPassFieldsSchema,
} from '../src/index.js';

// Property test for idempotent schema parsing (foundation-contracts, S0).
//
// Property 5: Schema parsing is idempotent.
// Validates: Requirements 4.12.
//
// For all shared schemas and for all valid generated inputs, parsing a value and then
// parsing the result again produces an equivalent value: parse(parse(x)) equals
// parse(x). This matters because the output of a parse (the normalised, unknown-field
// stripped, enum-mapped value) is itself a valid input the schema must accept without
// further change. A schema whose second parse differed would be unstable: feeding a
// parsed value back (for example a cached value re-validated on read) would mutate it.
//
// Two of the shared schemas are transforms rather than plain objects, so they get their
// own cases below with inputs that exercise both the known and the unknown branch:
//   - SeatAvailabilitySchema maps a known band to its literal and any other string to
//     the sentinel "unknown". The sentinel itself is not one of the five known bands,
//     so parsing "unknown" again yields "unknown": the transform is stable.
//   - BulkFailureCodeSchema is an identity transform over strings (known and unknown
//     alike map to themselves), so idempotence holds trivially but is still asserted.

// Any zod schema whose parsed output is a plain object. Kept wide so one list can hold
// the wire, domain, Problem and PassFields schemas together.
type ObjectSchema = z.ZodType<Record<string, unknown>, unknown>;

// At least 100 iterations per schema, as required for this spec's property tests. Each
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
// Small shared generators for valid field values (same approach as the accept-strip
// test, replicated here so this file is self-contained).
// ----------------------------------------------------------------------------------

// A plain non-empty string, used for the many free-form string fields.
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

// The five known seat availability bands, plus a handful of strings the client does not
// recognise. Both branches of the SeatAvailability transform are exercised.
const knownSeatValue = (): fc.Arbitrary<string> =>
  fc.constantFrom('available', 'limited', 'veryLimited', 'unavailable', 'walkUp');

const anySeatString = (): fc.Arbitrary<string> =>
  fc.oneof(knownSeatValue(), fc.string({ minLength: 0, maxLength: 16 }));

// The nine known bulk failure codes, plus arbitrary strings for the unknown branch.
const anyBulkCodeString = (): fc.Arbitrary<string> =>
  fc.oneof(
    fc.constantFrom(
      'sessionNotReservable',
      'scheduleConflict',
      'alreadyScheduled',
      'sessionFull',
      'insufficientAccess',
      'timePassed',
      'alreadyFavorited',
      'notFavorited',
      'other',
    ),
    fc.string({ minLength: 0, maxLength: 16 }),
  );

// An ISO-8601-with-offset instant that lands INSIDE the PassFields window, paired with an
// end after it and at most 10 hours later. The window is roughly five days wide, so a
// start offset of 0 to 4 days plus a duration of 1 to 10 hours always stays inside.
const windowStartMs = Date.parse(PASS_WINDOW.start);
const windowEndMs = Date.parse(PASS_WINDOW.end);

const passTimes = (): fc.Arbitrary<{ startsAt: string; endsAt: string }> =>
  fc
    .tuple(
      fc.integer({
        min: 0,
        max: Math.floor((windowEndMs - windowStartMs) / 60000) - 10 * 60,
      }),
      fc.integer({ min: 1, max: 10 * 60 }),
    )
    .map(([offsetMin, lengthMin]) => {
      const startMs = windowStartMs + offsetMin * 60000;
      const endMs = startMs + lengthMin * 60000;
      return { startsAt: isoWithOffset(startMs), endsAt: isoWithOffset(endMs) };
    });

// Format a millisecond instant as an ISO-8601 string with a fixed -08:00 offset so it
// matches the schema's offset-required pattern.
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
    { date: plainString(), time: plainString(), length: plainString(), timezone: plainString() },
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
      // A valid wire value for seatAvailability is any string; the schema maps it on
      // parse. Both known and unknown strings are generated so the first parse exercises
      // the transform, and the idempotence check then re-parses the mapped output.
      seatAvailability: anySeatString(),
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
    {
      requiredKeys: ['personalTimeId', 'startDateTime', 'endDateTime', 'title', 'description'],
    },
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
    { items: fc.array(sessionWireArb(), { maxLength: 2 }), totalCount: fc.nat(), nextToken: plainString() },
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
      // Known and unknown codes alike are valid wire values; both map to themselves.
      code: anyBulkCodeString(),
      conflictsWith: stringArray(),
    },
    { requiredKeys: ['sessionId', 'code'] },
  );

const bulkResultArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({ successful: stringArray(), failed: fc.array(bulkFailureArb(), { maxLength: 2 }) });

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
      seatAvailability: fc.constantFrom('available', 'limited', 'walkUp', 'unknown'),
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
    fc.record({ decision: fc.constant('allow'), reasons: stringArray() }),
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
}

const schemaCases: SchemaCase[] = [
  { name: 'SessionTimeSchema', schema: SessionTimeSchema as ObjectSchema, arb: sessionTimeArb() },
  { name: 'SessionWireSchema', schema: SessionWireSchema as ObjectSchema, arb: sessionWireArb() },
  { name: 'ScheduleWireSchema', schema: ScheduleWireSchema as ObjectSchema, arb: scheduleWireArb() },
  { name: 'ListSessionsSchema', schema: ListSessionsSchema as ObjectSchema, arb: listSessionsArb() },
  { name: 'GetSessionSchema', schema: GetSessionSchema as ObjectSchema, arb: getSessionArb() },
  { name: 'GetScheduleSchema', schema: GetScheduleSchema as ObjectSchema, arb: getScheduleArb() },
  { name: 'PersonalTimeSchema', schema: PersonalTimeSchema as ObjectSchema, arb: personalTimeArb() },
  {
    name: 'PersonalTimeInputSchema',
    schema: PersonalTimeInputSchema as ObjectSchema,
    arb: personalTimeInputArb(),
  },
  { name: 'EventSchema', schema: EventSchema as ObjectSchema, arb: eventArb() },
  { name: 'BulkResultSchema', schema: BulkResultSchema as ObjectSchema, arb: bulkResultArb() },
  { name: 'BulkFailureSchema', schema: BulkFailureSchema as ObjectSchema, arb: bulkFailureArb() },
  {
    name: 'NormalisedSessionSchema',
    schema: NormalisedSessionSchema as ObjectSchema,
    arb: normalisedSessionArb(),
  },
  { name: 'CommitmentSchema', schema: CommitmentSchema as ObjectSchema, arb: commitmentArb() },
  { name: 'VenueSchema', schema: VenueSchema as ObjectSchema, arb: venueArb() },
  { name: 'VerdictSchema', schema: VerdictSchema as ObjectSchema, arb: verdictArb() },
  { name: 'ProblemSchema', schema: ProblemSchema as ObjectSchema, arb: problemArb() },
  { name: 'PassFieldsSchema', schema: PassFieldsSchema, arb: passFieldsArb() },
];

// ----------------------------------------------------------------------------------
// The shared assertion: a valid value parses once, and parsing the parsed result again
// yields a deeply equal value. parse(parse(x)) equals parse(x).
// ----------------------------------------------------------------------------------

function assertIdempotent(
  schema: ObjectSchema,
  arb: fc.Arbitrary<Record<string, unknown>>,
  schemaName: string,
): void {
  fc.assert(
    fc.property(arb, (value) => {
      const first = schema.safeParse(value);
      // The generated value is valid: the first parse succeeds.
      expect(first.success, `${schemaName} rejected a value it should accept`).toBe(true);
      if (!first.success) {
        return;
      }

      const once = first.data;
      const second = schema.safeParse(once);
      // Re-parsing a parsed value succeeds: the output is itself a valid input.
      expect(second.success, `${schemaName} rejected its own parsed output`).toBe(true);
      if (!second.success) {
        return;
      }

      const twice = second.data;
      // parse(parse(x)) equals parse(x): the second parse changed nothing.
      expect(twice).toEqual(once);
    }),
    { numRuns: NUM_RUNS },
  );
}

// Idempotence for a scalar transform schema. The schema maps a string input to its
// parsed output; parsing that output again must produce the same value.
function assertScalarIdempotent(
  schema: z.ZodType<unknown, string>,
  arb: fc.Arbitrary<string>,
  schemaName: string,
): void {
  fc.assert(
    fc.property(arb, (value) => {
      const first = schema.safeParse(value);
      expect(first.success, `${schemaName} rejected a value it should accept`).toBe(true);
      if (!first.success) {
        return;
      }

      const once = first.data;
      // The parsed output must itself be a string the schema accepts (both transforms
      // produce strings), so re-parsing it is valid input.
      const second = schema.safeParse(once as string);
      expect(second.success, `${schemaName} rejected its own parsed output`).toBe(true);
      if (!second.success) {
        return;
      }

      expect(second.data).toEqual(once);
    }),
    { numRuns: NUM_RUNS },
  );
}

describe('Feature: foundation-contracts, Property 5: Schema parsing is idempotent', () => {
  test('Feature: foundation-contracts, Property 5: Schema parsing is idempotent', () => {
    // Every listed object schema: parse a valid value, then parse the parsed output and
    // assert deep equality.
    for (const { name, schema, arb } of schemaCases) {
      assertIdempotent(schema, arb, name);
    }
  });

  test('Feature: foundation-contracts, Property 5: SeatAvailabilitySchema parsing is idempotent', () => {
    // A known band maps to its literal; an unknown string maps to the sentinel "unknown".
    // "unknown" is not one of the five known bands, so parsing it again yields "unknown":
    // the transform is stable on its own output. Both branches are generated.
    assertScalarIdempotent(
      SeatAvailabilitySchema as unknown as z.ZodType<unknown, string>,
      anySeatString(),
      'SeatAvailabilitySchema',
    );
  });

  test('Feature: foundation-contracts, Property 5: BulkFailureCodeSchema parsing is idempotent', () => {
    // Known and unknown codes both map to themselves (an identity transform), so
    // parse(parse(x)) equals parse(x) over any generated string.
    assertScalarIdempotent(
      BulkFailureCodeSchema as unknown as z.ZodType<unknown, string>,
      anyBulkCodeString(),
      'BulkFailureCodeSchema',
    );
  });
});
