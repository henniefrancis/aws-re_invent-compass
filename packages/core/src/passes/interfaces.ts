// Injected interface contracts for the pass side (boarding-passes, S4).
//
// Every side effect S4 performs (network, filesystem, clock and sleep, the per-OS
// app-data folder, the ID token and the venue walk data) enters only through one of
// these interfaces, so the core logic stays pure and the tests reach full coverage
// without touching a real disk, network or wallet. The ID token provider and the
// connection provider are owned by other streams (S1 auth and S2 rules); they are
// mocked here until those streams merge, and S4 never imports their unmerged code.
//
// This file is type-only: it declares interfaces and the HTTP request and response
// shapes, with no runtime value, so it emits no JavaScript.

/**
 * Supplies the Builder ID ID token as a bearer credential. Owned by S1 (auth);
 * mocked until S1 merges. The token is returned fresh per call and never stored by
 * S4, never written to a file and never placed in a log line or error.
 */
export interface IdTokenProvider {
  getIdToken(): Promise<string>;
}

/**
 * Supplies the walk (Connection) between two venues in whole minutes. Owned by S2
 * (rules); mocked until S2 merges. Returns undefined when no walk data is known, so
 * the Pass_Builder omits the walk fields rather than invent a number.
 */
export interface ConnectionProvider {
  walkMinutes(fromVenue: string, toVenue: string): number | undefined;
}

/**
 * A clock seam so time-derived behaviour is deterministic in tests. now returns the
 * current instant; sleep waits the given number of milliseconds and is the seam the
 * Compass_Client uses for its single Retry-After wait, so tests drive the delay
 * without real time passing.
 */
export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

/**
 * Resolves the per-OS app-data folder (the absolute path to the reinvent-compass
 * folder). Injected so tests control the path without reading real environment
 * variables.
 */
export interface AppDataResolver {
  resolve(): string;
}

/**
 * A minimal filesystem seam. Create modes are explicit so the Pass_Store can request
 * mode 0600. readFile resolves to undefined when the file is absent rather than
 * throwing, so an absent record reads as an empty record.
 */
export interface FileSystem {
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, data: string, mode: number): Promise<void>;
  remove(path: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
}

/**
 * One HTTP request the Compass_Client sends through the transport seam. The shape is
 * deliberately free of any credential-bearing convenience field: the Authorization
 * header is set explicitly by the client per call. body is a JSON string when present.
 */
export interface HttpRequest {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * One HTTP response the transport seam returns. Header names are lower-cased, so the
 * client reads retry-after directly. body is the raw response body, parsed and
 * validated against its contract schema by the client.
 */
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * The HTTP seam the Compass_Client calls. Lets the tests run against an in-memory or
 * node:http mock server built from the Compass API OpenAPI document.
 */
export interface HttpTransport {
  request(req: HttpRequest): Promise<HttpResponse>;
}
