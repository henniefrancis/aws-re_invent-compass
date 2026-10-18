import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { ListSessionsSchema, GetSessionSchema, GetScheduleSchema } from '@compass/contracts';
import { validateBody, assertNoBody } from '../../src/api/validate.js';
import {
  ListEventsResultSchema,
  GetEventResultSchema,
  BulkWriteResultSchema,
} from '../../src/api/response-wrappers.js';
import { ValidationError } from '../../src/api/errors.js';
import type { OperationName } from '../../src/api/transport.js';

// Property and unit tests for response validation and wrappers (events-client, S1,
// Component 2). Covers Property 13 (valid 2xx bodies are returned parsed; invalid
// bodies yield a validation error, Requirements 6.3 to 6.6) and Property 14 (a 204
// no-body response is success without validation, Requirement 6.7). The invalid
// branch also asserts the no-leak guarantee: a ValidationError never echoes the raw
// body (part of Requirements 6.5, 7.7).

// The five no-body operations that return 204 with an empty body.
const NO_BODY_OPERATIONS: readonly OperationName[] = [
  'CancelReservation',
  'DisassociateFavorite',
  'CreatePersonalTime',
  'UpdatePersonalTime',
  'DeletePersonalTime',
];

// A minimal valid Event on the wire.
const eventArb = fc.record({
  eventId: fc.string({ minLength: 1, maxLength: 12 }),
  name: fc.string({ maxLength: 20 }),
  eventType: fc.string({ maxLength: 12 }),
  startDate: fc.constant('2026-11-30T00:00:00-08:00'),
  endDate: fc.constant('2026-12-04T00:00:00-08:00'),
  isOnline: fc.boolean(),
  authenticationRequired: fc.boolean(),
});

// A minimal valid Session on the wire (only the two required fields).
const sessionWireArb = fc.record({
  sessionId: fc.string({ minLength: 1, maxLength: 12 }),
  title: fc.string({ maxLength: 20 }),
});

// A minimal valid BulkResult.
const bulkResultArb = fc.record({
  successful: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 4 }),
  failed: fc.array(
    fc.record({
      sessionId: fc.string({ minLength: 1, maxLength: 8 }),
      code: fc.constantFrom('sessionFull', 'scheduleConflict', 'alreadyScheduled', 'other'),
    }),
    { maxLength: 4 },
  ),
});

// Each case pairs an operation, its schema, and an arbitrary that builds a valid body.
interface Case {
  operation: OperationName;
  schema: z.ZodType<unknown>;
  validArb: fc.Arbitrary<unknown>;
}

const cases: Case[] = [
  {
    operation: 'ListEvents',
    schema: ListEventsResultSchema,
    validArb: fc.record({ items: fc.array(eventArb, { maxLength: 3 }) }),
  },
  {
    operation: 'GetEvent',
    schema: GetEventResultSchema,
    validArb: fc.record({ event: eventArb }),
  },
  {
    operation: 'ListSessions',
    schema: ListSessionsSchema,
    validArb: fc.record({
      items: fc.array(sessionWireArb, { maxLength: 3 }),
      totalCount: fc.nat({ max: 2000 }),
    }),
  },
  {
    operation: 'GetSession',
    schema: GetSessionSchema,
    validArb: fc.record({ session: sessionWireArb }),
  },
  {
    operation: 'GetSchedule',
    schema: GetScheduleSchema,
    validArb: fc.record({
      schedule: fc.record({
        reserved: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 3 }),
        favorites: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 3 }),
        personalTime: fc.constant([]),
      }),
    }),
  },
  {
    operation: 'ReserveSessions',
    schema: BulkWriteResultSchema,
    validArb: fc.record({ result: bulkResultArb }),
  },
  {
    operation: 'AssociateFavorites',
    schema: BulkWriteResultSchema,
    validArb: fc.record({ result: bulkResultArb }),
  },
];

describe('Feature: events-client, Property 13: Valid 2xx bodies are returned parsed; invalid bodies yield a validation error', () => {
  test('a valid body validates and returns the parsed value for every operation', () => {
    for (const c of cases) {
      fc.assert(
        fc.property(c.validArb, (body) => {
          const parsed = validateBody(c.operation, c.schema, body);
          // The parsed value equals what the schema itself produces.
          expect(parsed).toEqual(c.schema.parse(body));
        }),
        { numRuns: 100 },
      );
    }
  });

  test('an invalid body throws a ValidationError that never echoes the raw body', () => {
    // A body missing required fields, carrying an embedded would-be secret so the
    // test can assert the error does not echo it.
    const secret = 'secret-email@example.com';
    const invalidArb = fc.constantFrom(
      { unexpected: secret },
      { items: 'not-an-array', note: secret },
      { event: { eventId: 123, leaked: secret } },
      null,
      secret,
      42,
    );
    for (const c of cases) {
      fc.assert(
        fc.property(invalidArb, (body) => {
          let thrown: unknown;
          try {
            validateBody(c.operation, c.schema, body);
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBeInstanceOf(ValidationError);
          const err = thrown as ValidationError;
          expect(err.operation).toBe(c.operation);
          expect(err.message).toBe(`${c.operation} response failed schema validation`);
          // The message and all fields never echo the raw body or its secret.
          expect(err.message).not.toContain(secret);
          expect(
            JSON.stringify({ name: err.name, message: err.message, operation: err.operation }),
          ).not.toContain(secret);
        }),
        { numRuns: 100 },
      );
    }
  });
});

describe('Feature: events-client, Property 14: A 204 for no-body operations is success without validation', () => {
  test('assertNoBody returns for an absent body on every no-body operation', () => {
    for (const operation of NO_BODY_OPERATIONS) {
      expect(() => {
        assertNoBody(operation, undefined);
      }).not.toThrow();
    }
  });

  test('assertNoBody rejects an unexpected present body without echoing it', () => {
    const secret = 'unexpected@body.example';
    const presentBodyArb = fc.constantFrom({}, { anything: secret }, [secret], secret, 0, false);
    for (const operation of NO_BODY_OPERATIONS) {
      fc.assert(
        fc.property(presentBodyArb, (body) => {
          let thrown: unknown;
          try {
            assertNoBody(operation, body);
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBeInstanceOf(ValidationError);
          const err = thrown as ValidationError;
          expect(err.operation).toBe(operation);
          expect(err.message).not.toContain(secret);
        }),
        { numRuns: 100 },
      );
    }
  });
});
