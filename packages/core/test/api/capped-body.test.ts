import { describe, expect, test, vi } from 'vitest';
import fc from 'fast-check';
import {
  BodyTooLargeError,
  MAX_API_BODY_BYTES,
  MAX_OAUTH_BODY_BYTES,
  readBodyCapped,
  type BodyReaderLike,
  type CappableResponse,
} from '../../src/api/capped-body.js';
import { createHttpTransport, type FetchResponseLike } from '../../src/api/http-transport.js';
import { NetworkError, ResponseTooLargeError } from '../../src/api/errors.js';
import { headers } from './operation-harness.js';

// Tests for capped response body reads (events-client, S1, finding L3).

/** A stream of the given chunks that records whether it was cancelled. */
function stream(chunks: Uint8Array[]): {
  body: { getReader(): BodyReaderLike };
  cancelled: () => boolean;
} {
  let cancelled = false;
  return {
    cancelled: () => cancelled,
    body: {
      getReader(): BodyReaderLike {
        let i = 0;
        return {
          read: () => {
            const value = chunks[i];
            i += 1;
            return Promise.resolve(
              value === undefined ? { done: true as const } : { done: false as const, value },
            );
          },
          cancel: () => {
            cancelled = true;
            return Promise.resolve();
          },
        };
      },
    },
  };
}

describe('events-client, L3: readBodyCapped', () => {
  test('the limits are 5 MB for the API and 64 KB for OAuth', () => {
    expect(MAX_API_BODY_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_OAUTH_BODY_BYTES).toBe(64 * 1024);
  });

  test('a declared Content-Length over the limit is refused without reading the body', async () => {
    const text = vi.fn(() => Promise.resolve('x'));
    const res: CappableResponse = { headers: headers({ 'content-length': '101' }), text };
    await expect(readBodyCapped(res, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(text).not.toHaveBeenCalled();
  });

  test('a missing, malformed or in-limit Content-Length does not refuse by itself', async () => {
    for (const value of [undefined, 'abc', '', '100', '5']) {
      const res: CappableResponse = {
        headers: headers(value === undefined ? {} : { 'content-length': value }),
        text: () => Promise.resolve('ok'),
      };
      await expect(readBodyCapped(res, 100)).resolves.toBe('ok');
    }
    await expect(readBodyCapped({ text: () => Promise.resolve('ok') }, 100)).resolves.toBe('ok');
  });

  test('a text-only response is checked in bytes after the read', async () => {
    const exact = 'é'.repeat(50); // 100 bytes in UTF-8
    await expect(readBodyCapped({ text: () => Promise.resolve(exact) }, 100)).resolves.toBe(exact);
    await expect(
      readBodyCapped({ text: () => Promise.resolve(`${exact}a`) }, 100),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  test('a streamed body is read to the end when within the limit, even across chunk splits', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 40 }),
        fc.integer({ min: 1, max: 8 }),
        async (text, size) => {
          const bytes = Buffer.from(text, 'utf8');
          const chunks: Uint8Array[] = [];
          for (let i = 0; i < bytes.length; i += size) {
            chunks.push(bytes.subarray(i, i + size));
          }
          const s = stream(chunks);
          const res: CappableResponse = {
            body: s.body,
            text: () => Promise.reject(new Error('must not use text()')),
          };
          await expect(readBodyCapped(res, 1000)).resolves.toBe(text);
          expect(s.cancelled()).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('a streamed body is cancelled as soon as it passes the limit', async () => {
    const s = stream([new Uint8Array(60), new Uint8Array(60), new Uint8Array(60)]);
    await expect(
      readBodyCapped({ body: s.body, text: () => Promise.resolve('') }, 100),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(s.cancelled()).toBe(true);
  });

  test('a null body falls back to text()', async () => {
    await expect(
      readBodyCapped({ body: null, text: () => Promise.resolve('t') }, 10),
    ).resolves.toBe('t');
  });
});

describe('events-client, L3: the Events API transport maps an oversize body to a typed error', () => {
  const credential = {
    getAccessTokenForEventsApi: () => Promise.resolve('tok'),
    forceRefresh: () => Promise.resolve(),
  };

  test('an oversize response becomes a ResponseTooLargeError carrying the status, not the body', async () => {
    const big: FetchResponseLike = {
      status: 200,
      headers: headers({ 'content-length': String(MAX_API_BODY_BYTES + 1) }),
      text: () => Promise.resolve('SECRET-BODY'),
    };
    const transport = createHttpTransport({ credential, fetch: () => Promise.resolve(big) });
    const failure = await transport
      .send({ operation: 'GetSchedule', method: 'GET', path: '/events/E1/schedule' })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ResponseTooLargeError);
    expect((failure as ResponseTooLargeError).status).toBe(200);
    expect((failure as Error).message).not.toContain('SECRET');
  });

  test('a body that grows past the limit while streaming is also refused', async () => {
    const s = stream([new Uint8Array(MAX_API_BODY_BYTES), new Uint8Array(1)]);
    const res: FetchResponseLike = {
      status: 200,
      headers: headers(),
      body: s.body,
      text: () => Promise.resolve(''),
    };
    const transport = createHttpTransport({ credential, fetch: () => Promise.resolve(res) });
    await expect(
      transport.send({ operation: 'GetSchedule', method: 'GET', path: '/events/E1/schedule' }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  test('another read failure becomes a typed network error, not a size error, and keeps no cause', async () => {
    const res: FetchResponseLike = {
      status: 200,
      headers: headers(),
      text: () => Promise.reject(new Error('socket closed')),
    };
    const transport = createHttpTransport({ credential, fetch: () => Promise.resolve(res) });
    const failure = await transport
      .send({ operation: 'GetSchedule', method: 'GET', path: '/events/E1/schedule' })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(NetworkError);
    expect((failure as Error).message).not.toContain('socket closed');
    expect((failure as Error).cause).toBeUndefined();
  });
});
