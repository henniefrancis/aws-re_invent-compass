// The production HttpTransport over `fetch` (task 12.4, integrator note). It allows https
// only, applies a timeout, never follows a redirect (`redirect: 'error'`, so a token cannot be
// forwarded to another host) and returns the body as text, or as raw bytes when the request asks
// for a binary body, so a `.pkpass` is not corrupted.
// Failures become a fixed CompassError; no URL, header or body is ever put in an error.

import { CompassError } from '../ports/errors.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../ports/http-transport.js';

/** The default request timeout. */
export const DEFAULT_TIMEOUT_MS = 20000;

/** The largest response body accepted. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

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
      let text = '';
      let bytes: Uint8Array | undefined;
      try {
        response = await options.fetch(url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          redirect: 'error',
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (request.binary === true) {
          bytes = new Uint8Array(await response.arrayBuffer());
        } else {
          text = await response.text();
        }
      } catch {
        throw new CompassError('Network');
      }
      if ((bytes?.length ?? text.length) > MAX_RESPONSE_BYTES) {
        throw new CompassError('UnexpectedResponse');
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: text,
        ...(bytes === undefined ? {} : { bytes }),
      };
    },
  };
}
