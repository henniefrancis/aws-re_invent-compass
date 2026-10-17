import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  createRetryPolicy,
  parseRetryAfter,
  MIN_RETRY_AFTER_SECONDS,
  MAX_RETRY_AFTER_SECONDS,
} from '../../src/api/retry.js';
import type { ClientRequest, HttpMethod, OperationName } from '../../src/api/transport.js';

// Property and unit tests for the retry policy and the Retry-After parser
// (events-client, S1, Component 3). Covers Property 16 (non-reserve 401 and 429
// retry at most once, Requirements 8.1 to 8.6) and Property 17 (ReserveSessions is
// never automatically re-sent for any status, Requirements 9.1 to 9.4). The policy
// is a pure decision layer; the operation path (task 8) applies each decision at
// most once.

const ALL_OPERATIONS: readonly OperationName[] = [
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

const NON_RESERVE_OPERATIONS = ALL_OPERATIONS.filter((op) => op !== 'ReserveSessions');

const methodArb = fc.constantFrom<HttpMethod>('GET', 'POST', 'DELETE', 'PATCH', 'PUT');

function requestFor(operation: OperationName, method: HttpMethod): ClientRequest {
  return { operation, method, path: `/${operation}` };
}

// Build a header set that returns the given Retry-After string, or no header.
function headersWith(retryAfter: string | undefined): Headers {
  const h = new Headers();
  if (retryAfter !== undefined) {
    h.set('retry-after', retryAfter);
  }
  return h;
}

describe('Feature: events-client, parseRetryAfter accepts only whole seconds in [0,120]', () => {
  test('a whole number of seconds in range parses to itself', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_RETRY_AFTER_SECONDS, max: MAX_RETRY_AFTER_SECONDS }),
        (seconds) => {
          expect(parseRetryAfter(headersWith(String(seconds)))).toBe(seconds);
        },
      ),
      { numRuns: 200 },
    );
  });

  test('an absent header, a decimal, a negative, an out-of-range value or an HTTP date is rejected', () => {
    const rejectedArb = fc.oneof(
      fc.constant(undefined),
      fc.constant('1.5'),
      fc.constant('-1'),
      fc.constant('121'),
      fc.integer({ min: 121, max: 100000 }).map(String),
      fc.constant('Wed, 21 Oct 2026 07:28:00 GMT'),
      fc.constant(''),
      fc.constant('   '),
      fc.constant('10s'),
      fc.constant('abc'),
    );
    fc.assert(
      fc.property(rejectedArb, (value) => {
        expect(parseRetryAfter(headersWith(value))).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });
});

describe('Feature: events-client, Property 16: Non-reserve 401 and 429 retry at most once', () => {
  const policy = createRetryPolicy();

  test('a non-reserve 401 decides refresh-and-retry-once', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NON_RESERVE_OPERATIONS), methodArb, (operation, method) => {
        expect(policy.onUnauthorized(requestFor(operation, method))).toBe('refresh-and-retry-once');
      }),
      { numRuns: 200 },
    );
  });

  test('a non-reserve 429 with a parseable Retry-After decides wait-and-retry-once', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_RESERVE_OPERATIONS),
        methodArb,
        fc.integer({ min: MIN_RETRY_AFTER_SECONDS, max: MAX_RETRY_AFTER_SECONDS }),
        (operation, method, retryAfter) => {
          expect(policy.onRateLimited(requestFor(operation, method), retryAfter)).toBe(
            'wait-and-retry-once',
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  test('a non-reserve 429 with no parseable Retry-After decides fail', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NON_RESERVE_OPERATIONS), methodArb, (operation, method) => {
        expect(policy.onRateLimited(requestFor(operation, method), undefined)).toBe('fail');
      }),
      { numRuns: 200 },
    );
  });
});

describe('Feature: events-client, Property 17: ReserveSessions is sent exactly once for any status', () => {
  const policy = createRetryPolicy();

  test('a ReserveSessions 401 decides refresh-then-fail, never a re-send', () => {
    fc.assert(
      fc.property(methodArb, (method) => {
        expect(policy.onUnauthorized(requestFor('ReserveSessions', method))).toBe(
          'refresh-then-fail',
        );
      }),
      { numRuns: 200 },
    );
  });

  test('a ReserveSessions 429 decides fail for any Retry-After, parseable or not', () => {
    fc.assert(
      fc.property(
        methodArb,
        fc.option(fc.integer({ min: MIN_RETRY_AFTER_SECONDS, max: MAX_RETRY_AFTER_SECONDS }), {
          nil: undefined,
        }),
        (method, retryAfter) => {
          expect(policy.onRateLimited(requestFor('ReserveSessions', method), retryAfter)).toBe(
            'fail',
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
