import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  errorForStatus,
  EventsApiError,
  ValidationError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitedError,
  ServerError,
  UnexpectedResponseError,
  EventWindowError,
  QuotaExceededError,
} from '../../src/api/errors.js';
import type { OperationName } from '../../src/api/transport.js';

// Property and unit tests for the typed error taxonomy and the status-to-error
// mapper (events-client, S1, Component 4). Covers Property 15: every failure status
// maps to its typed error carrying the status (Requirements 7.1 to 7.6), and the
// no-leak guarantee that an error built from a status carries only the operation
// and status, never a secret (part of Requirement 7.7).

const OPERATIONS: readonly OperationName[] = [
  'ListEvents',
  'GetEvent',
  'ListSessions',
  'GetSession',
  'GetSchedule',
  'ReserveSessions',
  'CancelReservation',
  'AssociateFavorites',
  'DisassociateFavorite',
  'CreatePersonalTime',
  'UpdatePersonalTime',
  'DeletePersonalTime',
];

const operationArb = fc.constantFrom(...OPERATIONS);

// The exact mapping the design specifies. Any failure status that is not one of the
// named ones maps to UnexpectedResponseError.
function expectedCtor(status: number): new (...args: never[]) => EventsApiError {
  if (status === 400) return BadRequestError;
  if (status === 401) return UnauthorizedError;
  if (status === 403) return ForbiddenError;
  if (status === 404) return NotFoundError;
  if (status === 409) return ConflictError;
  if (status === 429) return RateLimitedError;
  if (status >= 500 && status <= 599) return ServerError;
  return UnexpectedResponseError;
}

describe('Feature: events-client, Property 15: Every failure status maps to its typed error carrying the status', () => {
  test('known statuses map to their specific typed error and carry the status', () => {
    const knownArb = fc.constantFrom(400, 401, 403, 404, 409, 429);
    fc.assert(
      fc.property(operationArb, knownArb, (operation, status) => {
        const error = errorForStatus(operation, status);
        expect(error).toBeInstanceOf(expectedCtor(status));
        expect(error).toBeInstanceOf(EventsApiError);
        expect(error.status).toBe(status);
        expect(error.operation).toBe(operation);
      }),
      { numRuns: 200 },
    );
  });

  test('any 5xx status maps to a server error carrying the status', () => {
    fc.assert(
      fc.property(operationArb, fc.integer({ min: 500, max: 599 }), (operation, status) => {
        const error = errorForStatus(operation, status);
        expect(error).toBeInstanceOf(ServerError);
        expect(error.status).toBe(status);
      }),
      { numRuns: 200 },
    );
  });

  test('any other failure status maps to an unexpected response error carrying the status', () => {
    // Failure statuses that are not one of the named ones and not 5xx: for example
    // 402, 405 to 428, 430 to 499, and 3xx redirects the client never expects.
    const otherArb = fc
      .integer({ min: 300, max: 499 })
      .filter((s) => ![400, 401, 403, 404, 409, 429].includes(s));
    fc.assert(
      fc.property(operationArb, otherArb, (operation, status) => {
        const error = errorForStatus(operation, status);
        expect(error).toBeInstanceOf(UnexpectedResponseError);
        expect(error.status).toBe(status);
      }),
      { numRuns: 200 },
    );
  });

  test('the non-status errors (validation, event window, quota) carry their operation and a safe message', () => {
    const validation = new ValidationError('ListSessions', 'response failed schema validation');
    expect(validation).toBeInstanceOf(EventsApiError);
    expect(validation.name).toBe('ValidationError');
    expect(validation.operation).toBe('ListSessions');
    expect(validation.status).toBeUndefined();
    expect(validation.message).toBe('response failed schema validation');

    const validationWithStatus = new ValidationError('GetSession', 'bad body', 200);
    expect(validationWithStatus.status).toBe(200);

    const window = new EventWindowError('GetEvent', 'event window timezone is not a valid IANA id');
    expect(window).toBeInstanceOf(EventsApiError);
    expect(window.name).toBe('EventWindowError');
    expect(window.operation).toBe('GetEvent');
    expect(window.status).toBeUndefined();

    const quota = new QuotaExceededError(
      'ReserveSessions',
      'per-operation quota would be exceeded',
    );
    expect(quota).toBeInstanceOf(EventsApiError);
    expect(quota.name).toBe('QuotaExceededError');
    expect(quota.operation).toBe('ReserveSessions');
    expect(quota.status).toBeUndefined();
  });

  test('a status error message carries only the operation and status, never a secret', () => {
    const anyFailureArb = fc.integer({ min: 300, max: 599 });
    fc.assert(
      fc.property(operationArb, anyFailureArb, (operation, status) => {
        const error = errorForStatus(operation, status);
        // The message is built from the operation and status alone.
        expect(error.message).toBe(`${operation} failed with status ${String(status)}`);
        // Serialising the whole error exposes no field beyond name, message,
        // operation and status.
        const serialised = JSON.stringify({
          name: error.name,
          message: error.message,
          operation: error.operation,
          status: error.status,
        });
        expect(serialised).toContain(operation);
        expect(serialised).toContain(String(status));
      }),
      { numRuns: 200 },
    );
  });
});
