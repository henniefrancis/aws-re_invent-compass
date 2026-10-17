// Hand-off client (showcase-site, Component 11).
//
// One same-origin GET to the hand-off route, with the id only in the path. The function calls
// fetch exactly once, never retries, and always settles: a 10 second timer aborts the request
// and wins the race when fetch never answers. The body of a response is read only for a 200
// whose content type is application/json,
// and error bodies are never read at all, so no server text can reach the page.

import type { HandoffId } from './fragment';

export const HANDOFF_TIMEOUT_MS = 10_000;

/** The media type of the answer must be application/json, with or without parameters. */
const JSON_TYPE = /^\s*application\/json\s*(?:;|$)/i;

export interface ResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<ResponseLike>;
export type TimerHandle = unknown;
export type SetTimer = (callback: () => void, ms: number) => TimerHandle;
export type ClearTimer = (handle: TimerHandle) => void;

export type HandoffOutcome =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'notJson' }
  | { readonly kind: 'network' }
  | { readonly kind: 'timeout' };

export interface HandoffRequest {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * The request for one hand-off. The URL is relative, so it can only go to the site origin.
 * Credentials are omitted, caching and redirects are off, and no header holds the id.
 */
export function buildHandoffRequest(id: HandoffId, signal?: AbortSignal): HandoffRequest {
  const init: RequestInit = {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json' },
  };
  return {
    url: `/api/v1/handoffs/${id}`,
    init: signal === undefined ? init : { ...init, signal },
  };
}

export interface FetchDeps {
  readonly fetch: FetchLike;
  readonly timeoutMs: number;
  readonly setTimer: SetTimer;
  readonly clearTimer: ClearTimer;
}

async function attempt(request: HandoffRequest, fetchFn: FetchLike): Promise<HandoffOutcome> {
  try {
    const response = await fetchFn(request.url, request.init);
    if (response.status !== 200) {
      return { kind: 'status', status: response.status };
    }
    // Only a JSON answer is parsed. Anything else (a proxy error page, say) is not.
    if (!JSON_TYPE.test(response.headers.get('content-type') ?? '')) {
      return { kind: 'notJson' };
    }
    const text = await response.text();
    try {
      return { kind: 'ok', body: JSON.parse(text) as unknown };
    } catch {
      return { kind: 'notJson' };
    }
  } catch {
    return { kind: 'network' };
  }
}

/** Fetch one hand-off. Calls deps.fetch exactly once and settles by the timeout at the latest. */
export async function fetchHandoff(id: HandoffId, deps: FetchDeps): Promise<HandoffOutcome> {
  const controller = new AbortController();
  let handle: TimerHandle;
  const timeout = new Promise<HandoffOutcome>((resolve) => {
    handle = deps.setTimer(() => {
      controller.abort();
      resolve({ kind: 'timeout' });
    }, deps.timeoutMs);
  });
  try {
    return await Promise.race([
      attempt(buildHandoffRequest(id, controller.signal), deps.fetch),
      timeout,
    ]);
  } finally {
    deps.clearTimer(handle);
  }
}
