// Retry policy and Retry-After parser for the Events API client (events-client, S1).
//
// Component 3 in the design. The retry policy is a pure decision layer: it decides
// what to do on a 401 or a 429 for a given request, and the operation path applies
// that decision (performing at most one refresh plus one retry, or one wait plus one
// retry, then mapping a repeated failure to its typed error). Keeping the decision
// pure makes the one-retry rule easy to test and identical in live and simulated
// mode.
//
// ReserveSessions is the single exception (Requirement 9): it is never automatically
// re-sent for any status. On a 401 it still refreshes once (so the next manual
// attempt has a fresh token) but then fails without re-sending; on a 429 or 5xx it
// fails without re-sending. This protects the attendee from a reservation being
// replayed behind their back.
//
//   Non-ReserveSessions 401 -> refresh then retry once (Requirement 8.1 to 8.3)
//   Non-ReserveSessions 429 with Retry-After in [0,120] -> wait then retry once
//                                                           (Requirement 8.4 to 8.6)
//   Non-ReserveSessions 429 without a parseable Retry-After -> fail (Requirement 8.5)
//   ReserveSessions 401 -> refresh then fail, never re-send (Requirement 9.1, 9.2)
//   ReserveSessions 429 or 5xx -> fail, never re-send (Requirement 9.3, 9.4)

import type { ClientRequest, OperationName, ResponseHeaders } from './transport.js';

/** The lower and upper bounds (inclusive, whole seconds) for an accepted Retry-After. */
export const MIN_RETRY_AFTER_SECONDS = 0;
export const MAX_RETRY_AFTER_SECONDS = 120;

/** The decision for a 401 response. */
export type UnauthorizedDecision = 'refresh-and-retry-once' | 'refresh-then-fail' | 'fail';

/** The decision for a 429 response. */
export type RateLimitedDecision = 'wait-and-retry-once' | 'fail';

/**
 * The pure retry decision layer. The operation path calls onUnauthorized when a
 * request returns 401 and onRateLimited when it returns 429, then acts on the result
 * at most once.
 */
export interface RetryPolicy {
  onUnauthorized(req: ClientRequest): UnauthorizedDecision;
  onRateLimited(req: ClientRequest, retryAfter?: number): RateLimitedDecision;
}

/** The one operation excluded from any automatic re-send. */
const RESERVE_SESSIONS: OperationName = 'ReserveSessions';

/**
 * Parse the Retry-After header into a whole number of seconds in [0, 120]. The
 * Events API uses whole seconds (RFC 9110 allows seconds or an HTTP date; this
 * client accepts only the integer-seconds form within the bounded range). Anything
 * else, an absent header, a non-integer, a decimal, a negative value, an
 * out-of-range value or an HTTP date, returns undefined so the caller treats the 429
 * as non-retryable.
 */
export function parseRetryAfter(headers: ResponseHeaders): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null) {
    return undefined;
  }
  const trimmed = raw.trim();
  // Only a run of ASCII digits is an integer number of seconds; this rejects
  // decimals, signs, whitespace-embedded values and HTTP-date strings. A digits-only
  // string is always a non-negative integer, so the range check below is the only
  // remaining gate (an over-large value is rejected as out of range).
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const seconds = Number(trimmed);
  if (seconds < MIN_RETRY_AFTER_SECONDS || seconds > MAX_RETRY_AFTER_SECONDS) {
    return undefined;
  }
  return seconds;
}

/**
 * The retry policy. Stateless, so one instance is shared by the whole client.
 */
export function createRetryPolicy(): RetryPolicy {
  return {
    onUnauthorized(req) {
      if (req.operation === RESERVE_SESSIONS) {
        // Refresh once so a later manual attempt has a fresh token, but never
        // re-send the reservation automatically.
        return 'refresh-then-fail';
      }
      return 'refresh-and-retry-once';
    },
    onRateLimited(req, retryAfter) {
      if (req.operation === RESERVE_SESSIONS) {
        return 'fail';
      }
      // Retry once only when the wait is a parseable, bounded duration.
      if (retryAfter === undefined) {
        return 'fail';
      }
      return 'wait-and-retry-once';
    },
  };
}
