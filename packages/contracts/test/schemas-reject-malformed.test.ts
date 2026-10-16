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
  SeatAvailabilitySchema,
  BulkFailureCodeSchema,
  createPassFieldsSchema,
} from '../src/index.js';

// Property test for schemas rejecting malformed inputs without coercion
// (foundation-contracts, S0).
//
// Property 3: Schemas reject malformed inputs without coercion.
// Validates: Requirements 4.3, 4.13.
//
// For every shared schema, and for any valid value in which one field is replaced by a
// value of the wrong type or a value outside the field rules, parsing FAILS rather than
// coercing the value or substituting a default. In particular, a wire Session missing
// sessionId or title is rejected, and a PassFields value whose text looks like a URL or
// domain, or contains a control character or a bidirectional override, is rejected. Wire
// enums reject a wrong type (for example a number where a string belongs) but keep an
// unknown string (that string behaviour is covered by Property 4).

// Any zod schema whose input we probe with safeParse. Kept deliberately wide so one list
// can hold wire, domain, Problem and the PassFields factory instance together.
type AnySchema = z.ZodType<unknown, unknown>;

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

const PassFieldsSchema = createPassFieldsSchema(PASS_WINDOW) as unknown as AnySchema;

// ----------------------------------------------------------------------------------
// Small shared generators for valid field values (mirrored from the accept-strip test so
// this file stays self-contained).
// ----------------------------------------------------------------------------------

const plainString = (): fc.Arbitrary<string> => fc.string({ minLength: 1, maxLength: 16 });

const stringArray = (): fc.Arbitrary<string[]> => fc.array(plainString(), { maxLength: 3 });

// Safe free text for PassFields: letters, digits and single spaces only, so a valid base
// never trips the URL, domain, control-character or bidirectional-override checks.
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

const windowStartMs = Date.parse(PASS_WINDOW.start);
const windowEndMs = Date.parse(PASS_WINDOW.end);

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

// ----------------------------------------------------------------------------------
// Valid-base arbitraries, one per object schema, matching the accept-strip test.
// ----------------------------------------------------------------------------------

const sessionWireArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record(
    {
      sessionId: plainString(),
      title: plainString(),
      abbreviation: sessionCode(),
      seatAvailability: fc.constantFrom('available', 'limited', 'walkUp'),
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
      code: fc.constantFrom('sessionFull', 'scheduleConflict', 'other'),
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
      isAllDay: fc.boolean(),
      isReservable: fc.boolean(),
      seatAvailability: fc.constantFrom('available', 'limited', 'walkUp'),
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
  fc.record(
    {
      kind: fc.constant('reservedSession'),
      sessionId: plainString(),
      startsAt: plainString(),
      endsAt: plainString(),
    },
    { requiredKeys: ['kind', 'sessionId', 'startsAt', 'endsAt'] },
  );

const venueArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({ name: plainString() }, { requiredKeys: ['name'] });

const verdictArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    decision: fc.constant('block'),
    reasons: fc.array(plainString(), { minLength: 1, maxLength: 3 }),
  });

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
        attendeeName: safeText(1, 40),
      },
      { requiredKeys: ['sessionCode', 'title', 'venue', 'room', 'startsAt', 'endsAt'] },
    ),
  );

// ----------------------------------------------------------------------------------
// Wrong-typed value generators per expected field type. Each generator yields values of
// the WRONG type for the field so the schema must reject them with no coercion.
// ----------------------------------------------------------------------------------

type FieldKind = 'string' | 'boolean' | 'number' | 'array' | 'object';

// A value of the wrong type for a given expected field kind, plus null. For a string
// field, numbers, booleans, objects, arrays and null are all wrong; and so on. null is
// always wrong because every field under test is either required (so null is not a valid
// absence) or, where optional, still not nullable.
function wrongTypedValue(expected: FieldKind): fc.Arbitrary<unknown> {
  const numbers = fc.integer({ min: -1000, max: 1000 });
  const strings = fc.string({ maxLength: 8 });
  const booleans = fc.boolean();
  const objects = fc.record({ unexpected: fc.string({ maxLength: 4 }) });
  const arrays = fc.array(fc.string({ maxLength: 4 }), { maxLength: 3 });
  const nulls = fc.constant(null);

  switch (expected) {
    case 'string':
      // A string field: numbers, booleans, objects, arrays and null are all wrong.
      return fc.oneof(numbers, booleans, objects, arrays, nulls);
    case 'boolean':
      // A boolean field: strings (including 'true'), numbers (including 0 and 1),
      // objects, arrays and null are all wrong.
      return fc.oneof(
        fc.constantFrom('true', 'false', 'yes', ''),
        strings,
        numbers,
        objects,
        arrays,
        nulls,
      );
    case 'number':
      // A number field: strings (including numeric-looking strings like '404'),
      // booleans, objects, arrays and null are all wrong.
      return fc.oneof(
        fc.constantFrom('0', '1', '404', '3.14'),
        strings,
        booleans,
        objects,
        arrays,
        nulls,
      );
    case 'array':
      // An array field: a string, a number, a boolean, a plain object and null are all
      // wrong.
      return fc.oneof(strings, numbers, booleans, objects, nulls);
    case 'object':
      // An object field: a string, a number, a boolean, an array and null are all wrong.
      return fc.oneof(strings, numbers, booleans, arrays, nulls);
  }
}

// ----------------------------------------------------------------------------------
// The object schema list under test, each paired with a valid-base arbitrary and the map
// of its REQUIRED fields to their expected kind. Optional fields are not corrupted here,
// because an absent optional field is valid; we corrupt a genuinely required field so the
// wrong type is actually rejected.
//
// SessionTimeSchema has no required fields, so it carries an empty required-field map and
// is exercised only for the "extra wrong-typed value on an optional field" case below.
// ----------------------------------------------------------------------------------

interface RejectCase {
  name: string;
  schema: AnySchema;
  arb: fc.Arbitrary<Record<string, unknown>>;
  // Required field name to its expected type kind. A value of a different kind must fail.
  requiredFields: Record<string, FieldKind>;
}

const rejectCases: RejectCase[] = [
  {
    name: 'SessionWireSchema',
    schema: SessionWireSchema as AnySchema,
    arb: sessionWireArb(),
    requiredFields: { sessionId: 'string', title: 'string' },
  },
  {
    name: 'ScheduleWireSchema',
    schema: ScheduleWireSchema as AnySchema,
    arb: scheduleWireArb(),
    requiredFields: { reserved: 'array', favorites: 'array', personalTime: 'array' },
  },
  {
    name: 'ListSessionsSchema',
    schema: ListSessionsSchema as AnySchema,
    arb: listSessionsArb(),
    requiredFields: { items: 'array', totalCount: 'number' },
  },
  {
    name: 'GetSessionSchema',
    schema: GetSessionSchema as AnySchema,
    arb: getSessionArb(),
    requiredFields: { session: 'object' },
  },
  {
    name: 'GetScheduleSchema',
    schema: GetScheduleSchema as AnySchema,
    arb: getScheduleArb(),
    requiredFields: { schedule: 'object' },
  },
  {
    name: 'PersonalTimeSchema',
    schema: PersonalTimeSchema as AnySchema,
    arb: personalTimeArb(),
    requiredFields: {
      personalTimeId: 'string',
      startDateTime: 'string',
      endDateTime: 'string',
      title: 'string',
      description: 'string',
    },
  },
  {
    name: 'PersonalTimeInputSchema',
    schema: PersonalTimeInputSchema as AnySchema,
    arb: personalTimeInputArb(),
    requiredFields: {
      startDateTime: 'string',
      endDateTime: 'string',
      title: 'string',
      description: 'string',
    },
  },
  {
    name: 'EventSchema',
    schema: EventSchema as AnySchema,
    arb: eventArb(),
    requiredFields: {
      eventId: 'string',
      name: 'string',
      eventType: 'string',
      startDate: 'string',
      endDate: 'string',
      isOnline: 'boolean',
      authenticationRequired: 'boolean',
    },
  },
  {
    name: 'BulkResultSchema',
    schema: BulkResultSchema as AnySchema,
    arb: bulkResultArb(),
    requiredFields: { successful: 'array', failed: 'array' },
  },
  {
    name: 'BulkFailureSchema',
    schema: BulkFailureSchema as AnySchema,
    arb: bulkFailureArb(),
    requiredFields: { sessionId: 'string', code: 'string' },
  },
  {
    name: 'NormalisedSessionSchema',
    schema: NormalisedSessionSchema as AnySchema,
    arb: normalisedSessionArb(),
    requiredFields: {
      sessionId: 'string',
      code: 'string',
      title: 'string',
      isAllDay: 'boolean',
      isReservable: 'boolean',
      seatAvailability: 'string',
      missingFields: 'array',
    },
  },
  {
    name: 'CommitmentSchema',
    schema: CommitmentSchema as AnySchema,
    arb: commitmentArb(),
    // kind is the discriminant literal; corrupting the other required fields to a wrong
    // type must fail. kind is corrupted to a non-matching value by the discriminant case.
    requiredFields: { sessionId: 'string', startsAt: 'string', endsAt: 'string' },
  },
  {
    name: 'VenueSchema',
    schema: VenueSchema as AnySchema,
    arb: venueArb(),
    requiredFields: { name: 'string' },
  },
  {
    name: 'VerdictSchema',
    schema: VerdictSchema as AnySchema,
    arb: verdictArb(),
    requiredFields: { reasons: 'array' },
  },
  {
    name: 'ProblemSchema',
    schema: ProblemSchema as AnySchema,
    arb: problemArb(),
    requiredFields: { type: 'string', title: 'string', status: 'number', code: 'string' },
  },
  {
    name: 'PassFieldsSchema',
    schema: PassFieldsSchema,
    arb: passFieldsArb(),
    requiredFields: {
      sessionCode: 'string',
      title: 'string',
      venue: 'string',
      room: 'string',
      startsAt: 'string',
      endsAt: 'string',
    },
  },
];

describe('Feature: foundation-contracts, Property 3: Schemas reject malformed inputs without coercion', () => {
  test('Feature: foundation-contracts, Property 3: Schemas reject malformed inputs without coercion', () => {
    for (const { name, schema, arb, requiredFields } of rejectCases) {
      const fieldNames = Object.keys(requiredFields);
      // Every case here corrupts a required field, so there is always at least one.
      expect(fieldNames.length, `${name} declares no required fields to corrupt`).toBeGreaterThan(
        0,
      );

      // Pick which required field to corrupt, then pick a wrong-typed value appropriate
      // to that field's expected kind, both driven by fast-check in one chained
      // arbitrary so the run is fully seeded and deterministic.
      const corruption = fc
        .constantFrom(...fieldNames)
        .chain((field) =>
          wrongTypedValue(requiredFields[field]).map((wrong) => ({ field, wrong })),
        );

      fc.assert(
        fc.property(arb, corruption, (base, { field, wrong }) => {
          // Sanity: the untouched base is accepted, so any failure below is caused by
          // the single corrupted field and not by an invalid base.
          expect(schema.safeParse(base).success, `${name} rejected a valid base`).toBe(true);

          const corrupted = { ...base, [field]: wrong };
          const result = schema.safeParse(corrupted);
          // No coercion: a wrong-typed required field makes the parse fail.
          expect(result.success, `${name}.${field} was coerced or accepted a wrong type`).toBe(
            false,
          );
          return true;
        }),
        { numRuns: NUM_RUNS },
      );
    }
  });

  // --------------------------------------------------------------------------------
  // Part 1b: an optional field present with a wrong type still fails (no coercion). This
  // covers SessionTimeSchema, whose fields are all optional strings, so there is no
  // required field to corrupt but a present wrong-typed value must still be rejected.
  // --------------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 3: present optional fields with a wrong type are rejected', () => {
    const optionalStringField = fc.constantFrom('date', 'time', 'length', 'timezone');

    fc.assert(
      fc.property(
        sessionTimeArb(),
        optionalStringField,
        wrongTypedValue('string'),
        (base, field, wrong) => {
          expect(SessionTimeSchema.safeParse(base).success).toBe(true);

          // null for an optional field is a special case in zod: an optional string
          // accepts undefined but not null, so null must fail too. Any non-string, non
          // undefined value must fail.
          const corrupted = { ...base, [field]: wrong };
          const result = SessionTimeSchema.safeParse(corrupted);
          expect(result.success, `SessionTime.${field} accepted a wrong type`).toBe(false);
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // --------------------------------------------------------------------------------
  // Part 2: missing required field. Deleting a required key from an otherwise valid value
  // makes the parse fail. The brief calls out a wire Session missing sessionId and a wire
  // Session missing title specifically, plus a couple more representative cases.
  // --------------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 3: a missing required field is rejected', () => {
    // A wire Session missing sessionId is rejected.
    const validSession = {
      sessionId: 's1',
      title: 'A valid session',
      abbreviation: 'AIM101',
    };
    expect(SessionWireSchema.safeParse(validSession).success).toBe(true);

    {
      const { sessionId: _omitted, ...withoutSessionId } = validSession;
      expect(SessionWireSchema.safeParse(withoutSessionId).success).toBe(false);
    }

    // A wire Session missing title is rejected.
    {
      const { title: _omitted, ...withoutTitle } = validSession;
      expect(SessionWireSchema.safeParse(withoutTitle).success).toBe(false);
    }

    // Problem missing status is rejected.
    {
      const validProblem = { type: 'about:blank', title: 'Bad request', status: 400, code: 'bad' };
      expect(ProblemSchema.safeParse(validProblem).success).toBe(true);
      const { status: _omitted, ...withoutStatus } = validProblem;
      expect(ProblemSchema.safeParse(withoutStatus).success).toBe(false);
    }

    // NormalisedSession missing missingFields is rejected.
    {
      const validNormalised = {
        sessionId: 's1',
        code: 'AIM101',
        title: 'A session',
        isAllDay: false,
        isReservable: true,
        seatAvailability: 'available',
        missingFields: [],
      };
      expect(NormalisedSessionSchema.safeParse(validNormalised).success).toBe(true);
      const { missingFields: _omitted, ...withoutMissingFields } = validNormalised;
      expect(NormalisedSessionSchema.safeParse(withoutMissingFields).success).toBe(false);
    }

    // Property-drive the deletion across every required field of a wire Session: for each,
    // removing it makes the parse fail.
    const requiredSessionFields = ['sessionId', 'title'] as const;
    fc.assert(
      fc.property(fc.constantFrom(...requiredSessionFields), (fieldToDelete) => {
        const copy: Record<string, unknown> = { ...validSession };
        delete copy[fieldToDelete];
        expect(SessionWireSchema.safeParse(copy).success).toBe(false);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // --------------------------------------------------------------------------------
  // Part 2b: ProblemSchema status is an integer. Replacing it with a numeric-looking
  // STRING like '404' must FAIL with no coercion. This is called out explicitly by the
  // brief.
  // --------------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 3: Problem status is not coerced from a string', () => {
    const numericStrings = fc.constantFrom('404', '200', '0', '500', '3.14', '1e3');
    fc.assert(
      fc.property(numericStrings, (statusString) => {
        const corrupted = {
          type: 'about:blank',
          title: 'Not found',
          status: statusString,
          code: 'notFound',
        };
        const result = ProblemSchema.safeParse(corrupted);
        expect(result.success, 'Problem.status was coerced from a string').toBe(false);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );

    // A non-integer number is also rejected (status is z.number().int()).
    expect(
      ProblemSchema.safeParse({
        type: 'about:blank',
        title: 'x',
        status: 4.5,
        code: 'c',
      }).success,
    ).toBe(false);
  });

  // --------------------------------------------------------------------------------
  // Part 3: PassFields text rules. Malicious free text (URL-like, www-like, bare domain,
  // control character, bidirectional override) is rejected for every free-text field. The
  // malicious-text part is property-driven at NUM_RUNS iterations.
  // --------------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 3: PassFields rejects URL, domain, control and bidi text', () => {
    // A set of malicious strings that each individual free-text rule must reject.
    const maliciousText = fc.constantFrom(
      // URL-like, explicit scheme.
      'http://evil.example',
      'https://evil.example/path',
      'Visit https://evil.example now',
      // www-like.
      'www.evil.example',
      'see www.example for more',
      // bare domain.
      'evil.com',
      'contact support.example.io today',
      // control character (C0 and DEL).
      'bad\u0001value',
      'line\u0007break',
      'tail\u007F',
      // bidirectional override and related directional controls.
      'flip\u202Eexe',
      'embed\u202Atext',
      'isolate\u2066text',
      'mark\u200Etext',
    );

    // The free-text target fields on PassFields. venue and room allow length 0, title and
    // attendeeName require length 1, so the malicious strings (all non-empty) are valid by
    // length and fail only on the text-safety rule.
    const targetField = fc.constantFrom('title', 'venue', 'room', 'attendeeName');

    fc.assert(
      fc.property(passFieldsArb(), targetField, maliciousText, (base, field, text) => {
        // The clean base parses, isolating the malicious field as the only cause of
        // failure.
        expect(PassFieldsSchema.safeParse(base).success).toBe(true);
        const corrupted = { ...base, [field]: text };
        const result = PassFieldsSchema.safeParse(corrupted);
        expect(result.success, `PassFields.${field} accepted malicious text`).toBe(false);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // --------------------------------------------------------------------------------
  // Part 3b: PassFields out-of-rule boundary values are rejected. A handful of
  // deterministic assertions for the length and time-window rules.
  // --------------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 3: PassFields rejects out-of-rule boundary values', () => {
    // A valid base built from the fixed window, used as the starting point for each
    // boundary violation.
    const startMs = windowStartMs + 24 * 60 * 60 * 1000; // one day into the window
    const endMs = startMs + 60 * 60 * 1000; // one hour long
    const base = {
      sessionCode: 'AIM101',
      title: 'Valid title',
      venue: 'Venetian',
      room: 'Room 101',
      startsAt: isoWithOffset(startMs),
      endsAt: isoWithOffset(endMs),
    };
    expect(PassFieldsSchema.safeParse(base).success).toBe(true);

    // title length 0 fails (min 1).
    expect(PassFieldsSchema.safeParse({ ...base, title: '' }).success).toBe(false);

    // title length 81 fails (max 80).
    expect(PassFieldsSchema.safeParse({ ...base, title: 'A'.repeat(81) }).success).toBe(false);

    // venue length 41 fails (max 40).
    expect(PassFieldsSchema.safeParse({ ...base, venue: 'A'.repeat(41) }).success).toBe(false);

    // sessionCode lowercase fails the pattern.
    expect(PassFieldsSchema.safeParse({ ...base, sessionCode: 'aim101' }).success).toBe(false);

    // sessionCode too long (13 chars) fails the pattern.
    expect(PassFieldsSchema.safeParse({ ...base, sessionCode: 'A'.repeat(13) }).success).toBe(
      false,
    );

    // endsAt before startsAt fails.
    expect(
      PassFieldsSchema.safeParse({
        ...base,
        startsAt: isoWithOffset(endMs),
        endsAt: isoWithOffset(startMs),
      }).success,
    ).toBe(false);

    // endsAt more than 10 hours after startsAt fails.
    expect(
      PassFieldsSchema.safeParse({
        ...base,
        endsAt: isoWithOffset(startMs + (10 * 60 * 60 * 1000 + 60000)),
      }).success,
    ).toBe(false);

    // startsAt before the window start fails.
    expect(
      PassFieldsSchema.safeParse({
        ...base,
        startsAt: isoWithOffset(windowStartMs - 60 * 60 * 1000),
        endsAt: isoWithOffset(windowStartMs - 30 * 60 * 1000),
      }).success,
    ).toBe(false);

    // endsAt after the window end fails.
    expect(
      PassFieldsSchema.safeParse({
        ...base,
        startsAt: isoWithOffset(windowEndMs - 30 * 60 * 1000),
        endsAt: isoWithOffset(windowEndMs + 60 * 60 * 1000),
      }).success,
    ).toBe(false);
  });

  // --------------------------------------------------------------------------------
  // Part 4: wire enum wrong-type rejection. SeatAvailabilitySchema and
  // BulkFailureCodeSchema keep an unknown STRING (Property 4) but must reject a non-string
  // (number, boolean, object, null, array). Property-driven at NUM_RUNS iterations.
  // --------------------------------------------------------------------------------
  test('Feature: foundation-contracts, Property 3: wire enums reject a non-string type', () => {
    const nonString = fc.oneof(
      fc.integer(),
      fc.double({ noNaN: true }),
      fc.boolean(),
      fc.constant(null),
      fc.record({ value: fc.string({ maxLength: 4 }) }),
      fc.array(fc.string({ maxLength: 4 }), { maxLength: 3 }),
    );

    fc.assert(
      fc.property(nonString, (value) => {
        expect(
          SeatAvailabilitySchema.safeParse(value).success,
          'SeatAvailability coerced a non-string',
        ).toBe(false);
        expect(
          BulkFailureCodeSchema.safeParse(value).success,
          'BulkFailureCode coerced a non-string',
        ).toBe(false);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
