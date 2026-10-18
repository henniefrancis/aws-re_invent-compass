// The production HttpTransport over `fetch` (task 12.4, integrator note). It allows https
// only, applies a timeout, never follows a redirect (`redirect: 'error'`, so a token cannot be
// forwarded to another host) and returns the body as text, or as raw bytes when the request asks
// for a binary body, so a `.pkpass` is not corrupted. The body is read as a stream and the request is
// aborted as soon as it passes the byte cap (a declared length over the cap is refused before any
// byte is read), so an oversize or endless body never fills memory (security L5).
// Failures become a fixed CompassError; no URL, header or body is ever put in an error.

import { CompassError } from '../ports/errors.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../ports/http-transport.js';

/** The default request timeout. */
export const DEFAULT_TIMEOUT_MS = 20000;

/** The largest response body accepted. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** The body went past the cap. Never reaches a caller: it becomes a fixed CompassError. */
class TooLarge extends Error {}

/** Reads the whole body, stopping and aborting the request once it passes the cap. */
async function readCapped(response: Response, abort: AbortController): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    abort.abort();
    throw new TooLarge();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  for (;;) {
    const part = await reader?.read();
    if (part === undefined || part.done) {
      break;
    }
    const value = part.value as Uint8Array;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) {
      abort.abort();
      await reader?.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Options, injectable for tests. */
export interface FetchTransportOptions {
  fetch: typeof fetch;
  timeoutMs: number;
}

/** Creates the transport. */
export function createFetchTransport(
  options: FetchTransportOptions = { fetch: globalThis.fetch, timeoutMs: DEFAULT_TIMEOUT_MS },
): HttpTransport {
  return {
    request: async (request: HttpRequest): Promise<HttpResponse> => {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        throw new CompassError('BadRequest');
      }
      if (url.protocol !== 'https:') {
        throw new CompassError('BadRequest');
      }
      let response: Response;
      let body: Uint8Array;
      const abort = new AbortController();
      try {
        response = await options.fetch(url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          redirect: 'error',
          signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs), abort.signal]),
        });
        body = await readCapped(response, abort);
      } catch (error) {
        throw new CompassError(error instanceof TooLarge ? 'UnexpectedResponse' : 'Network');
      }
      const binary = request.binary === true;
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: binary ? '' : new TextDecoder('utf-8').decode(body),
        ...(binary ? { bytes: body } : {}),
      };
    },
  };
}
