// @compass/core/api entry point (events-client, S1).
//
// One file per Events API operation plus the shared machinery (transport seam,
// redacting logger, typed errors, retry policy, quota tracker, bulk guard,
// confirmed-write helper). This barrel is filled incrementally as each task lands
// and is finalised in task 16.1 to expose exactly the twelve operation functions
// plus the confirmed-write helper and the transport selector.

// Redacting logger (Component 8): the single logging mechanism for the stream.
export {
  createRedactingLogger,
  consoleSink,
  type RedactingLogger,
  type LogSink,
} from './redacting-logger.js';

// Transport seam and client context (Component 1 seam + ClientContext).
export {
  selectTransport,
  EVENTS_API_BASE_URL,
  SIMULATED_MODE,
  type OperationName,
  type HttpMethod,
  type ClientRequest,
  type RawResponse,
  type ResponseHeaders,
  type Transport,
  type TransportDeps,
  type EnvLike,
  type EventsApiCredential,
  type QuotaTracker,
  type ClientContext,
} from './transport.js';

// Live HTTP transport (Component 1, live path).
export {
  createHttpTransport,
  type FetchLike,
  type FetchInit,
  type FetchResponseLike,
  type HttpTransportDeps,
} from './http-transport.js';

// Client-side quota tracker (Component 7).
export { createQuotaTracker, type QuotaDecision } from './quota-tracker.js';

// Bulk input guard and failure classification (Component 5).
export { assertBulkInput, MIN_BULK_IDS, MAX_BULK_IDS } from './bulk-input.js';
export {
  KNOWN_BULK_FAILURE_CODES,
  classifyFailure,
  annotateBulkResult,
  type AnnotatedBulkFailure,
  type AnnotatedBulkWriteResult,
  type KnownBulkFailureCode,
  type FailureClassification,
} from './bulk-failure-codes.js';

// Confirmed-write helper (Component 6).
export {
  confirmedWrite,
  type Confirmed,
  type Unconfirmed,
  type ConfirmedWriteResult,
} from './confirmed-write.js';

// Capped body reads (finding L3): the size limits and the typed oversize error.
export { MAX_API_BODY_BYTES, MAX_OAUTH_BODY_BYTES, BodyTooLargeError } from './capped-body.js';

// Shared operation executor (Component 2, operation path).
export { executeOperation, type ResponseHandler, type QuotaSpec } from './execute-operation.js';

// The twelve Events API operation functions (Component 2), one file each.
export { listEvents, type ListEventsParams } from './list-events.js';
export { getEvent } from './get-event.js';
export { listSessions, type ListSessionsParams } from './list-sessions.js';
export { getSession, type GetSessionParams } from './get-session.js';
export { getSchedule } from './get-schedule.js';
export { reserveSessions } from './reserve-sessions.js';
export { associateFavorites } from './associate-favorites.js';
export { cancelReservation } from './cancel-reservation.js';
export { disassociateFavorite } from './disassociate-favorite.js';
export { createPersonalTime } from './create-personal-time.js';
export { updatePersonalTime } from './update-personal-time.js';
export { deletePersonalTime } from './delete-personal-time.js';

// Retry policy and Retry-After parser (Component 3).
export {
  createRetryPolicy,
  parseRetryAfter,
  MIN_RETRY_AFTER_SECONDS,
  MAX_RETRY_AFTER_SECONDS,
  type RetryPolicy,
  type UnauthorizedDecision,
  type RateLimitedDecision,
} from './retry.js';

// Response validation and the no-body assertion (Component 2, validation).
export { validateBody, assertNoBody } from './validate.js';

// Response wrappers built from contract schemas (Component 2, wrappers).
export {
  ListEventsResultSchema,
  GetEventResultSchema,
  BulkWriteResultSchema,
  type ListEventsResult,
  type GetEventResult,
  type BulkWriteResult,
} from './response-wrappers.js';

// Typed error taxonomy (Component 4) and the status-to-error mapper.
export {
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
  ResponseTooLargeError,
  errorForStatus,
} from './errors.js';

// Text sanitising for strings that came from the Events API (finding N1).
export {
  sanitiseText,
  MAX_TITLE_CODE_POINTS,
  MAX_ABSTRACT_CODE_POINTS,
  type SanitiseOptions,
} from './sanitise-text.js';

// Composition root: live or simulated client context, and the simulated markers (N2).
export {
  createClientContext,
  ClientConfigError,
  SimulatedModeRefusedError,
  SimulatedFixturesMissingError,
  LiveClientNotConfiguredError,
  SIMULATED_MODE_WARNING,
  type ClientContextDeps,
} from './client-context.js';
export { isSimulatedResult } from './execute-operation.js';
