// Capped response body reads (events-client, S1, finding L3).
//
// A response body is read only up to a fixed byte limit, so a hostile or broken
// server cannot make the client buffer an unbounded amount of memory. A declared
// Content-Length above the limit is refused without reading anything; a streamed body
// is read chunk by chunk and cancelled the moment it passes the limit; a response with
// only a text() reader is checked after the read. Callers map the error to their own
// typed error. The error carries no body text and no size.

/** The limit for an Events API response body: 5 MB. */
export const MAX_API_BODY_BYTES = 5 * 1024 * 1024;
/** The limit for an OAuth endpoint response body: 64 KB. */
export const MAX_OAUTH_BODY_BYTES = 64 * 1024;

/** A response body was larger than the allowed limit. */
export class BodyTooLargeError extends Error {
  constructor() {
    super('The response body was larger than the allowed limit');
    this.name = 'BodyTooLargeError';
  }
}

/** The part of a ReadableStream reader this module uses. */
export interface BodyReaderLike {
  read(): Promise<{ done: false; value: Uint8Array } | { done: true; value?: undefined }>;
  cancel(): Promise<void>;
}

/** The part of a fetch response this module reads. */
export interface CappableResponse {
  headers?: { get(name: string): string | null };
  body?: { getReader(): BodyReaderLike } | null;
  text(): Promise<string>;
}

/** Read the whole body as UTF-8 text, throwing BodyTooLargeError past `maxBytes`. */
export async function readBodyCapped(res: CappableResponse, maxBytes: number): Promise<string> {
  const declared = Number(res.headers?.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError();
  }
  if (res.body === undefined || res.body === null) {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new BodyTooLargeError();
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      return Buffer.concat(chunks).toString('utf8');
    }
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(chunk.value);
  }
}
