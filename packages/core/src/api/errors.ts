// Typed error taxonomy for the Events API client (events-client, S1).
//
// Component 4 in the design. One error class per failure condition, all extending
// the abstract EventsApiError base, each carrying the response status where one
// applies. Errors are built through a factory that accepts ONLY the operation name
// and the status (plus a fixed, safe detail string), so no token, refresh token,
// ID token, email or Authorization header value can ever be carried into an error
// message or field. This is the error half of Requirements 7 and 20: a typed error
// per status that never leaks a secret.
//
// The status-to-error mapper turns any failure status into its typed error:
//   400 -> BadRequestError
//   401 -> UnauthorizedError (returned after the retry policy gives up)
//   403 -> ForbiddenError
//   404 -> NotFoundError
//   409 -> ConflictError
//   429 -> RateLimitedError (returned after the retry policy gives up)
//   500..599 -> ServerError
//   any other failure status -> UnexpectedResponseError
//
// ValidationError, EventWindowError and QuotaExceededError are raised by other
// parts of the client (validation, event-window resolution, quota tracker) rather
// than by the status mapper, but share the same base so callers can catch one type.

import type { OperationName } from './transport.js';

/**
 * The base for every error this stream throws. Carries the operation that failed
 * and, where a response status applies, that status. The message is always built
 * from safe inputs only (operation, status, a fixed detail), never from a token,
 * email, header or raw response body.
 */
export abstract class EventsApiError extends Error {
  /** The operation that produced the error. */
  readonly operation: OperationName;
  /** The HTTP status that produced the error, where one applies. */
  readonly status?: number;

  protected constructor(name: string, operation: OperationName, message: string, status?: number) {
    super(message);
    this.name = name;
    this.operation = operation;
    this.status = status;
  }
}

/** A response body (or input) failed schema validation. Never carries the body. */
export class ValidationError extends EventsApiError {
  constructor(operation: OperationName, message: string, status?: number) {
    super('ValidationError', operation, message, status);
  }
}

/** HTTP 400. */
export class BadRequestError extends EventsApiError {
  constructor(operation: OperationName, message: string, status: number) {
    super('BadRequestError', operation, message, status);
  }
}

/** HTTP 401, after the retry policy has given up. */
export class UnauthorizedError extends EventsApiError {
  constructor(operation: OperationName, message: string, status: number) {
    super('UnauthorizedError', operation, message, status);
  }
}

/** HTTP 403. */
export class ForbiddenError extends EventsApiError {
  constructor(operation: OperationName, message: string, status: number) {
    super('ForbiddenError', operation, message, status);
  }
}

/** HTTP 404. */
export class NotFoundError extends EventsApiError {
  constructor(operation: OperationName, message: string, status: number) {
    super('NotFoundError', operation, message, status);
  }
}

/** HTTP 409. */
export class ConflictError extends EventsApiError {
  constructor(operation: OperationName, message: string, status: number) {
    super('ConflictError', operation, message, status);
  }
}

/** HTTP 429, after the retry policy has given up. */
export class RateLimitedError extends EventsApiError {
  constructor(operation: OperationName, message: string, status: number) {
    super('RateLimitedError', operation, message, status);
  }
}

/** HTTP 500 to 599. */
export class ServerError extends EventsApiError {
  constructor(operation: OperationName, message: string, status: number) {
    super('ServerError', operation, message, status);
  }
}

/** Any other failure status not in the known set. */
export class UnexpectedResponseError extends EventsApiError {
  constructor(operation: OperationName, message: string, status: number) {
    super('UnexpectedResponseError', operation, message, status);
  }
}

/** The event window or its timezone was missing or invalid; never substituted. */
export class EventWindowError extends EventsApiError {
  constructor(operation: OperationName, message: string) {
    super('EventWindowError', operation, message);
  }
}

/** A response body was larger than the allowed limit. Never carries the body. */
export class ResponseTooLargeError extends EventsApiError {
  constructor(operation: OperationName, status?: number) {
    super(
      'ResponseTooLargeError',
      operation,
      `${operation} received a response larger than the allowed limit`,
      status,
    );
  }
}

/** A client-side per-operation quota would be exceeded; raised before any send. */
export class QuotaExceededError extends EventsApiError {
  constructor(operation: OperationName, message: string) {
    super('QuotaExceededError', operation, message);
  }
}

/**
 * Build a safe, fixed error message from the operation and status only. No caller
 * input beyond these two safe values reaches the message, so a token, email or
 * header can never be embedded. Kept as the single place a status error message is
 * constructed.
 */
function statusMessage(operation: OperationName, status: number): string {
  return `${operation} failed with status ${String(status)}`;
}

/**
 * Map any failure status to its typed error, carrying the status. The factory takes
 * only the operation and the status, so the resulting error cannot carry a secret.
 * 401 and 429 are mapped here too: the operation path calls this after its retry
 * policy has given up on those statuses.
 */
export function errorForStatus(operation: OperationName, status: number): EventsApiError {
  const message = statusMessage(operation, status);
  if (status === 400) {
    return new BadRequestError(operation, message, status);
  }
  if (status === 401) {
    return new UnauthorizedError(operation, message, status);
  }
  if (status === 403) {
    return new ForbiddenError(operation, message, status);
  }
  if (status === 404) {
    return new NotFoundError(operation, message, status);
  }
  if (status === 409) {
    return new ConflictError(operation, message, status);
  }
  if (status === 429) {
    return new RateLimitedError(operation, message, status);
  }
  if (status >= 500 && status <= 599) {
    return new ServerError(operation, message, status);
  }
  return new UnexpectedResponseError(operation, message, status);
}
