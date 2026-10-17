// Live HTTP transport for the Events API client (events-client, S1).
//
// Implements the Transport seam over the global fetch, targeting the live Events
// API base URL. It attaches the Events API Access_Token as the bearer credential
// and never attaches the ID token (Requirements 6.2, 4.1, 4.4). It performs no
// retry, no validation and no quota accounting: those sit above the transport in
// the operation path, so live and simulated mode share one code path.
//
// fetch, URL and Headers are Node 24 runtime globals. To keep the package building
// under the project's minimal lib set (ES2024, no DOM, no @types/node in the build)
// and to keep the transport unit-testable without a live network, the fetch
// function is injected through deps; the base URL is fixed (see createHttpTransport).

import { assertAudience } from '../auth/credential-provider.js';
import { ValidationError } from './errors.js';
import {
  EVENTS_API_BASE_URL,
  type ClientRequest,
  type EventsApiCredential,
  type RawResponse,
  type ResponseHeaders,
  type Transport,
} from './transport.js';

/**
 * The minimal shape of a fetch Response this transport reads: the status, the
 * headers (read-only accessor) and a text() for the body. Typed structurally so no
 * DOM/undici lib type is needed in the build.
 */
export interface FetchResponseLike {
  status: number;
  headers: ResponseHeaders;
  text(): Promise<string>;
}

/** The init bag passed to the injected fetch. Only the fields this transport sets. */
export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Never follow a redirect: it could carry the bearer token to another host. */
  redirect: 'error';
  /** Aborts the request after the API time limit. */
  signal: AbortSignal;
}

/** The injected fetch function shape (a subset of the global fetch). */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

/** Dependencies for the HTTP transport, injected for testability. */
export interface HttpTransportDeps {
  /** The fetch implementation. Defaults to the global fetch. */
  fetch: FetchLike;
  /** The access-token provider; only the Events API access token is attached. */
  credential: EventsApiCredential;
}

/**
 * Parse a response body as JSON when there is a body, else return undefined. An
 * empty body (for example a 204) yields undefined so the operation layer can treat
 * it as a no-body success. A non-JSON body is returned as the raw string so the
 * validation layer above can reject it as a validation error; this transport makes
 * no success/failure judgement of its own.
 */
async function parseBody(res: FetchResponseLike): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** The fixed time limit for one Events API request. */
export const API_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Build the absolute URL for a request, appending any query parameters, and check it
 * before anything is sent.
 *
 * Path (finding H1): the final path must be exactly the base path plus the request
 * path, inside the /events tree. URL parsing collapses "." and ".." segments and
 * treats "?" and "#" as delimiters, so any difference means the path was altered or
 * is unsafe.
 *
 * Egress (finding M3): the bearer token may only go to https on the Events API host,
 * with no credentials in the URL and no custom port. The host is checked on the URL
 * as finally parsed, through the audience guard, so no base URL or path trick can
 * send the token anywhere else.
 */
export function buildRequestUrl(baseUrl: string, req: ClientRequest): string {
  const url = new URL(`${baseUrl}${req.path}`);
  const insideEvents =
    (req.path === '/events' || req.path.startsWith('/events/')) &&
    !req.path.slice(1).split('/').includes('');
  if (!insideEvents || url.pathname !== `${new URL(baseUrl).pathname}${req.path}`) {
    throw new ValidationError(
      req.operation,
      `${req.operation} has a request path that is not valid`,
    );
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    throw new ValidationError(
      req.operation,
      `${req.operation} must be sent over plain https to the Events API`,
    );
  }
  assertAudience('access-token', url.hostname);
  if (req.query !== undefined) {
    for (const [key, value] of Object.entries(req.query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Create the live HTTP transport. Each send builds and checks the URL, then resolves
 * the current access token from the credential provider (which refreshes it if near
 * expiry), attaches it as the bearer credential, issues the request through the
 * injected fetch and returns the raw { status, headers, body }. The ID token is never
 * read or attached here. The base URL is the fixed live one: it cannot be injected,
 * so a token can only be sent to the Events API. Redirects are an error (a redirect
 * could carry the token elsewhere) and every request has a 30 second limit.
 */
export function createHttpTransport(deps: HttpTransportDeps): Transport {
  return {
    async send(req: ClientRequest): Promise<RawResponse> {
      const target = buildRequestUrl(EVENTS_API_BASE_URL, req);
      const accessToken = await deps.credential.getAccessTokenForEventsApi();
      const headers: Record<string, string> = {
        authorization: `Bearer ${accessToken}`,
      };
      const init: FetchInit = {
        method: req.method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      };
      if (req.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(req.body);
      }
      const res = await deps.fetch(target, init);
      const body = await parseBody(res);
      return { status: res.status, headers: res.headers, body };
    },
  };
}
