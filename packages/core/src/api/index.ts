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
  errorForStatus,
} from './errors.js';
