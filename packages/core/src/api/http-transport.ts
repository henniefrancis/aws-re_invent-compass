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
// function and the base URL are injected through deps. The default factory binds
// the real global fetch.

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
}

/** The injected fetch function shape (a subset of the global fetch). */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

/** Dependencies for the HTTP transport, injected for testability. */
export interface HttpTransportDeps {
  /** The fetch implementation. Defaults to the global fetch. */
  fetch: FetchLike;
  /** The access-token provider; only the Events API access token is attached. */
  credential: EventsApiCredential;
  /** The base URL. Defaults to the live Events API base. */
  baseUrl?: string;
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

/**
 * Build the absolute URL for a request, appending any query parameters. Uses the
 * runtime URL global (present in Node 24) through a narrow cast so the build needs
 * no DOM lib types.
 */
function buildUrl(baseUrl: string, req: ClientRequest): string {
  const UrlCtor = (
    globalThis as unknown as {
      URL: new (input: string) => {
        pathname: string;
        searchParams: { set(k: string, v: string): void };
        toString(): string;
      };
    }
  ).URL;
  const url = new UrlCtor(`${baseUrl}${req.path}`);
  // The final path must be exactly the base path plus the request path, inside the
  // /events tree. URL parsing collapses "." and ".." segments and treats "?" and "#"
  // as delimiters, so any difference means the path was altered or is unsafe, and the
  // request is refused before anything is sent (finding H1).
  const insideEvents =
    (req.path === '/events' || req.path.startsWith('/events/')) &&
    !req.path.slice(1).split('/').includes('');
  if (!insideEvents || url.pathname !== `${new UrlCtor(baseUrl).pathname}${req.path}`) {
    throw new ValidationError(
      req.operation,
      `${req.operation} has a request path that is not valid`,
    );
  }
  if (req.query !== undefined) {
    for (const [key, value] of Object.entries(req.query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Create the live HTTP transport. Each send resolves the current access token from
 * the credential provider (which refreshes it if near expiry), attaches it as the
 * bearer credential, issues the request through the injected fetch and returns the
 * raw { status, headers, body }. The ID token is never read or attached here.
 */
export function createHttpTransport(deps: HttpTransportDeps): Transport {
  const baseUrl = deps.baseUrl ?? EVENTS_API_BASE_URL;
  return {
    async send(req: ClientRequest): Promise<RawResponse> {
      const accessToken = await deps.credential.getAccessTokenForEventsApi();
      const headers: Record<string, string> = {
        authorization: `Bearer ${accessToken}`,
      };
      const init: FetchInit = { method: req.method, headers };
      if (req.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(req.body);
      }
      const res = await deps.fetch(buildUrl(baseUrl, req), init);
      const body = await parseBody(res);
      return { status: res.status, headers: res.headers, body };
    },
  };
}
