// Transport seam and client context for @compass/core (events-client, S1).
//
// The Transport seam sits between the twelve operation functions and the network.
// Every operation calls transport.send(request) and receives a raw
// { status, headers, body } result. Two implementations exist behind this seam:
//
//   - HttpTransport (task 2.1): the live path over global fetch against
//     https://api.awsevents.com/v1, attaching the bearer access token through the
//     EventsApiCredential provider on the ClientContext, never the ID token.
//   - SimulatedTransport (task 14): selected when COMPASS_MODE=simulated, serving
//     fixtures from fixtures/api/** with an in-memory schedule.
//
// The retry policy, quota tracker, validation and error mapping all sit ABOVE the
// transport, so they behave identically in live and simulated mode. The transport
// only decides status, headers and body; it never decides retries or validation.
//
// selectTransport reads COMPASS_MODE once and returns the simulated transport when
// it is "simulated", else the HTTP transport. Both concrete implementations are
// injected through TransportDeps so this seam has no import-time dependency on the
// not-yet-written implementations and stays unit-testable in isolation. The live
// path is never taken under COMPASS_MODE=simulated, which satisfies the no-live-
// request rule for simulated mode and owner-gated tests.

import type { RedactingLogger } from './redacting-logger.js';

/**
 * The twelve Events API operations, used as a stable key for quota accounting,
 * retry decisions, fixture lookup and error construction. Kept here (rather than in
 * contracts) because it names this stream's operation functions, not a wire shape.
 */
export type OperationName =
  | 'ListEvents'
  | 'GetEvent'
  | 'ListSessions'
  | 'GetSession'
  | 'GetSchedule'
  | 'ReserveSessions'
  | 'CancelReservation'
  | 'AssociateFavorites'
  | 'DisassociateFavorite'
  | 'CreatePersonalTime'
  | 'UpdatePersonalTime'
  | 'DeletePersonalTime';

/** The HTTP methods the Events API operations use. */
export type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';

/**
 * A request as the operation layer describes it, independent of transport. The
 * transport turns this into an HTTP call (live) or a fixture lookup (simulated).
 */
export interface ClientRequest {
  operation: OperationName;
  method: HttpMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

/**
 * The subset of the Fetch Headers interface this stream reads. Typed structurally
 * rather than against the DOM/undici `Headers` lib type so the package builds under
 * the project's minimal lib set (ES2024, no DOM, no @types/node in the build). The
 * live transport passes a real runtime `Headers`, the simulated transport passes an
 * equivalent, and both satisfy this read-only shape.
 */
export interface ResponseHeaders {
  get(name: string): string | null;
}

/**
 * The raw result a transport returns: the status, the response headers and the
 * parsed body (or undefined for an empty 204). Validation and error mapping run on
 * this above the transport.
 */
export interface RawResponse {
  status: number;
  headers: ResponseHeaders;
  body: unknown;
}

/** The seam every operation function calls. */
export interface Transport {
  /**
   * Present and true only on the simulated transport. It marks everything served as
   * not real, so a caller (the MCP layer, a UI) can say so, and the operation path
   * tags each object result with simulated: true (security finding N2).
   */
  readonly simulated?: true;
  send(req: ClientRequest): Promise<RawResponse>;
}

/**
 * Supplies the Events API access token to the api layer only. Defined here as the
 * shape ClientContext depends on; the concrete provider (with refresh and audience
 * separation) is built in auth (task 9.6). The ID token is never exposed here.
 */
export interface EventsApiCredential {
  /**
   * Resolve the current access token for api.awsevents.com, refreshing it first if
   * it is within the refresh window. Only ever an Events API access token.
   */
  getAccessTokenForEventsApi(): Promise<string>;
  /**
   * Force a token refresh now, independently of the expiry window, and resolve when
   * it completes. Called by the operation path on a 401 before the single retry
   * (Requirement 8.1) and once by ReserveSessions on a 401 before it fails without
   * re-sending (Requirement 9.1). Rejects if the refresh fails, which the operation
   * path maps to a typed unauthorized error. Single-flight is the provider's concern.
   */
  forceRefresh(): Promise<void>;
}

/**
 * The client-side quota tracker shape (Component 7, built in task 5.1). Declared
 * here so ClientContext can carry it without a forward import cycle.
 */
export interface QuotaTracker {
  check(op: OperationName, units: number, now: number): 'allow' | 'blocked-until-reset';
  record(op: OperationName, units: number, now: number): void;
  note429(op: OperationName, retryAfterSeconds: number, now: number): void;
}

/**
 * Everything an operation function needs: the transport, the access-token
 * provider, the quota tracker, the redacting logger and injected now/sleep clocks.
 * The ID token is deliberately absent; it is reached only through the separate
 * IdTokenProvider used by the passes module.
 */
export interface ClientContext {
  /**
   * The event every event-scoped operation targets (for example "reinvent2026"). It
   * fills the {eventId} segment of the official Events API paths and is URL-encoded
   * when the path is built.
   */
  eventId: string;
  transport: Transport;
  accessToken: EventsApiCredential;
  quota: QuotaTracker;
  logger: RedactingLogger;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** The base URL for the live Events API (tech steering, checked 15 October 2026). */
export const EVENTS_API_BASE_URL = 'https://api.awsevents.com/v1';

/** The environment value of COMPASS_MODE that selects the simulated transport. */
export const SIMULATED_MODE = 'simulated';

/**
 * The environment shape selectTransport reads. A structural type (rather than
 * NodeJS.ProcessEnv) so the build needs no @types/node; process.env satisfies it.
 */
export type EnvLike = Record<string, string | undefined>;

/**
 * Factories for the two concrete transports, injected so selectTransport has no
 * import-time dependency on either implementation. The api layer wires the real
 * factories (HttpTransport in task 2.1, SimulatedTransport in task 14); tests pass
 * spies to assert which branch selectTransport takes.
 */
export interface TransportDeps {
  createHttpTransport: () => Transport;
  createSimulatedTransport: () => Transport;
}

/**
 * Select the transport once from the environment. Returns the simulated transport
 * when COMPASS_MODE is exactly "simulated", otherwise the HTTP transport. The live
 * factory is not even called in simulated mode, so no live path can be taken.
 */
export function selectTransport(env: EnvLike, deps: TransportDeps): Transport {
  if (env.COMPASS_MODE === SIMULATED_MODE) {
    return deps.createSimulatedTransport();
  }
  return deps.createHttpTransport();
}
