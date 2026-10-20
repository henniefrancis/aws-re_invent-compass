// The one door to GitHub (compass-power task 45.1, Requirement P2.9).
//
// Every GitHub request in the module goes through `sendGitHubRequest`, which first runs
// `assertAllowedUrl`: only https URLs on github.com, api.github.com and codeload.github.com,
// on the default port and with no user information, may ever be requested. A request that
// carries an Authorization header may go only to api.github.com, so the access token can never
// follow the archive redirect to codeload.github.com. The fetch is injected, so no test reaches
// the network. Nothing here logs, and no error carries a URL, a header or a body.

import {
  BodyTooLargeError,
  readBodyCapped,
  type BodyReaderLike,
  type CappableResponse,
} from '../api/capped-body.js';
import {
  GitHubNetworkError,
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  GitHubRequestError,
  GitHubUrlRefusedError,
  type GitHubError,
} from './errors.js';

/** The only hosts the module may ever request. */
export const ALLOWED_GITHUB_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'api.github.com',
  'codeload.github.com',
]);

/** The only host that may receive the access token in an Authorization header. */
export const TOKEN_HOST = 'api.github.com';

/** The User-Agent GitHub requires on every API call. */
export const USER_AGENT = 'reinvent-compass';

/** The REST API version every call pins. */
export const GITHUB_API_VERSION = '2026-03-10';

/** The time limit for a sign-in call or a listing page. */
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;

/** The init bag the injected fetch receives. Only what the GitHub calls set. */
export interface GitHubFetchInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  /** `error` everywhere, except `manual` for the archive request whose redirect is checked. */
  redirect: 'error' | 'manual';
  signal?: AbortSignal;
}

/** The part of a fetch Response the GitHub calls read. */
export interface GitHubResponseLike extends CappableResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): BodyReaderLike } | null;
}

/** The injected fetch shape. Tests pass a fake; production uses the global fetch. */
export type GitHubFetch = (url: string, init: GitHubFetchInit) => Promise<GitHubResponseLike>;

/** The real fetch, used only in production. Tests always inject a fake. */
export const defaultGitHubFetch: GitHubFetch = (url, init) => fetch(url, init);

/**
 * Parse `url` and refuse it unless it is https, on one of the allowed GitHub hosts, on the
 * default port and without user information. Returns the parsed URL.
 */
export function assertAllowedUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GitHubUrlRefusedError();
  }
  if (
    parsed.protocol !== 'https:' ||
    !ALLOWED_GITHUB_HOSTS.has(parsed.hostname) ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new GitHubUrlRefusedError();
  }
  return parsed;
}

/** True when the headers carry an Authorization header, in any letter case. */
function hasAuthorization(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');
}

/**
 * Send one request after the URL check. A token may only go to api.github.com. Any failure
 * of the fetch itself (connection, abort, time limit, refused redirect) becomes a
 * GitHubNetworkError with no cause.
 */
export async function sendGitHubRequest(
  doFetch: GitHubFetch,
  url: string,
  init: GitHubFetchInit,
): Promise<GitHubResponseLike> {
  const target = assertAllowedUrl(url);
  if (hasAuthorization(init.headers) && target.hostname !== TOKEN_HOST) {
    throw new GitHubUrlRefusedError();
  }
  try {
    return await doFetch(target.href, init);
  } catch {
    throw new GitHubNetworkError();
  }
}

/** Read a JSON body up to `maxBytes`. An unparseable body is undefined; never the text. */
export async function readJsonBody(
  response: GitHubResponseLike,
  maxBytes: number,
): Promise<unknown> {
  let text: string;
  try {
    text = await readBodyCapped(response, maxBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new GitHubRequestError(response.status);
    }
    throw new GitHubNetworkError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Best-effort cancel of a body the module does not read. */
export function discardBody(response: GitHubResponseLike): void {
  response.body
    ?.getReader()
    .cancel()
    .catch(() => undefined);
}

const SECONDS = /^\d{1,10}$/;

/** When a rate limit resets, in epoch milliseconds, from Retry-After or X-RateLimit-Reset. */
function resetTime(response: GitHubResponseLike, now: () => number): number | undefined {
  const retryAfter = response.headers.get('retry-after')?.trim();
  if (retryAfter !== undefined && SECONDS.test(retryAfter)) {
    return now() + Number(retryAfter) * 1000;
  }
  const reset = response.headers.get('x-ratelimit-reset')?.trim();
  if (reset !== undefined && SECONDS.test(reset)) {
    return Number(reset) * 1000;
  }
  return undefined;
}

/** True for a 403 or 429 that GitHub marks as a rate limit. */
function isRateLimited(response: GitHubResponseLike): boolean {
  if (response.status === 429) {
    return true;
  }
  return (
    response.status === 403 &&
    (response.headers.get('x-ratelimit-remaining')?.trim() === '0' ||
      response.headers.get('retry-after') !== null)
  );
}

/**
 * The error for a failing API answer: 401 is not connected, a rate-limited 403 or 429 carries
 * the reset time, anything else carries the status only.
 */
export function failureFor(response: GitHubResponseLike, now: () => number): GitHubError {
  if (response.status === 401) {
    return new GitHubNotConnectedError();
  }
  if (isRateLimited(response)) {
    return new GitHubRateLimitedError(resetTime(response, now));
  }
  return new GitHubRequestError(response.status);
}

/** The headers of a GitHub REST API call made with the access token. */
export function apiHeaders(accessToken: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': GITHUB_API_VERSION,
    authorization: `Bearer ${accessToken}`,
    'user-agent': USER_AGENT,
  };
}
