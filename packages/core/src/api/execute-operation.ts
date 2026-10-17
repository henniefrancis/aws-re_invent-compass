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
import type { ClientContext, ClientRequest, OperationName, RawResponse } from './transport.js';

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
 * Check then record quota units for one send, throwing QuotaExceededError before the
 * request leaves when the tracker blocks it. Used for the first send and again for
 * the single 401 or 429 retry, because every send counts against the limit.
 */
function reserveQuota(ctx: ClientContext, operation: OperationName, units: number): void {
  // Unmetered operations (ListEvents, GetEvent) pass 0 units: they have no per-minute
  // limit, but a 429 still blocks them until its Retry-After has elapsed (12.9).
  if (ctx.quota.check(operation, units, ctx.now()) === 'blocked-until-reset') {
    throw new QuotaExceededError(
      operation,
      `${operation} would exceed its client-side per-minute quota`,
    );
  }
  ctx.quota.record(operation, units, ctx.now());
}

/** How long to block an operation after a 429 that carries no usable Retry-After. */
export const DEFAULT_RATE_LIMIT_BLOCK_SECONDS = 30;

/**
 * Record a 429 with the quota tracker (Requirement 12.9): the next call of the
 * operation is blocked until the Retry-After has elapsed, or for a safe default when
 * the header is missing or invalid. Done for EVERY 429, whether the call is then
 * retried or fails, and for ReserveSessions too.
 */
function noteRateLimit(ctx: ClientContext, operation: OperationName, response: RawResponse): void {
  ctx.quota.note429(
    operation,
    parseRetryAfter(response.headers) ?? DEFAULT_RATE_LIMIT_BLOCK_SECONDS,
    ctx.now(),
  );
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
  reserveQuota(ctx, operation, quota.units);

  // First attempt.
  let response = await ctx.transport.send(request);
  let retried = false;

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
      // The retry is a second send, so its units are checked and recorded again.
      reserveQuota(ctx, operation, quota.units);
      retried = true;
      response = await ctx.transport.send(request);
    } else {
      // refresh-then-fail (ReserveSessions): never re-send.
      throw errorForStatus(operation, 401);
    }
  } else if (response.status === 429) {
    noteRateLimit(ctx, operation, response);
    const retryAfter = parseRetryAfter(response.headers);
    const decision = retryPolicy.onRateLimited(request, retryAfter);
    if (decision === 'wait-and-retry-once' && retryAfter !== undefined) {
      await ctx.sleep(retryAfter * 1000);
      // The retry is a second send, so it is checked and recorded again. note429 and
      // the elapsed wait may leave the operation blocked, which stops the retry.
      reserveQuota(ctx, operation, quota.units);
      retried = true;
      response = await ctx.transport.send(request);
    } else {
      throw errorForStatus(operation, 429);
    }
  }

  // A 429 answering the single retry blocks the operation too.
  if (retried && response.status === 429) {
    noteRateLimit(ctx, operation, response);
  }

  // Map any remaining failure status (including a repeated 401 or 429 after the
  // single retry) to its typed error.
  if (!isSuccess(response.status)) {
    throw errorForStatus(operation, response.status);
  }

  return handle(response);
}
