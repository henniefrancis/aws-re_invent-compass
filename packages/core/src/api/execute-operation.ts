// Shared operation executor for the Events API client (events-client, S1).
//
// Component 2 (operation path). Every one of the twelve operation functions runs
// through executeOperation, which is the single place the design's layering is
// applied ABOVE the transport (design, Transport seam): quota accounting, then the
// send, then the 401 and 429 retry policy, then status-to-error mapping, then
// response validation. The transport only decides status, headers and body, so live
// and simulated mode share this exact path.
//
// The retry rules (Requirements 8 and 9) are delegated to the pure RetryPolicy:
//   - non-ReserveSessions 401: forceRefresh once, then one retry; a second 401 (or a
//     failed refresh) maps to UnauthorizedError.
//   - ReserveSessions 401: forceRefresh once, then fail without re-sending.
//   - non-ReserveSessions 429 with a parseable Retry-After: sleep once, then one
//     retry; a second 429 maps to RateLimitedError.
//   - ReserveSessions 429 or 5xx, and any un-retryable status: map to the typed error.
// A reservation is therefore sent at most once, never automatically re-sent.
//
// Quota is applied before any send (Requirement 12): check then record. ListEvents
// and GetEvent are unmetered, so they pass units 0 and the tracker leaves them
// alone. A blocked call raises QuotaExceededError before the request leaves.

import { createRetryPolicy, parseRetryAfter, type RetryPolicy } from './retry.js';
import { errorForStatus, QuotaExceededError } from './errors.js';
import type { ClientContext, ClientRequest, RawResponse } from './transport.js';

/** One shared, stateless retry policy for the whole client. */
const retryPolicy: RetryPolicy = createRetryPolicy();

/**
 * How an operation turns a successful RawResponse (status 2xx) into its typed
 * result. Called only for a 2xx response; it performs the schema validation or the
 * no-body assertion for that operation and returns the parsed value.
 */
export type ResponseHandler<T> = (response: RawResponse) => T;

/** The quota units an operation consumes, and whether it is metered at all. */
export interface QuotaSpec {
  /** The units to check and record. Session-count for the two bulk ops, else 1. */
  units: number;
}

/** True for a 2xx status. */
function isSuccess(status: number): boolean {
  return status >= 200 && status <= 299;
}

/**
 * Execute one Events API operation end to end: quota, send, retry, error mapping and
 * response handling. `handle` runs only on a 2xx response.
 */
export async function executeOperation<T>(
  ctx: ClientContext,
  request: ClientRequest,
  quota: QuotaSpec,
  handle: ResponseHandler<T>,
): Promise<T> {
  const { operation } = request;

  // Quota gate before any send. Metered operations pass units > 0; unmetered ones
  // (ListEvents, GetEvent) pass 0 and are never blocked by the tracker.
  if (quota.units > 0) {
    if (ctx.quota.check(operation, quota.units, ctx.now()) === 'blocked-until-reset') {
      throw new QuotaExceededError(
        operation,
        `${operation} would exceed its client-side per-minute quota`,
      );
    }
    ctx.quota.record(operation, quota.units, ctx.now());
  }

  // First attempt.
  let response = await ctx.transport.send(request);

  if (response.status === 401) {
    const decision = retryPolicy.onUnauthorized(request);
    // Both retry and fail decisions refresh once first (Requirement 8.1, 9.1). A
    // failed refresh maps to unauthorized without any retry.
    try {
      await ctx.accessToken.forceRefresh();
    } catch {
      throw errorForStatus(operation, 401);
    }
    if (decision === 'refresh-and-retry-once') {
      response = await ctx.transport.send(request);
    } else {
      // refresh-then-fail (ReserveSessions): never re-send.
      throw errorForStatus(operation, 401);
    }
  } else if (response.status === 429) {
    const retryAfter = parseRetryAfter(response.headers);
    const decision = retryPolicy.onRateLimited(request, retryAfter);
    if (decision === 'wait-and-retry-once' && retryAfter !== undefined) {
      ctx.quota.note429(operation, retryAfter, ctx.now());
      await ctx.sleep(retryAfter * 1000);
      response = await ctx.transport.send(request);
    } else {
      throw errorForStatus(operation, 429);
    }
  }

  // Map any remaining failure status (including a repeated 401 or 429 after the
  // single retry) to its typed error.
  if (!isSuccess(response.status)) {
    throw errorForStatus(operation, response.status);
  }

  return handle(response);
}
