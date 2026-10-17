import { describe, expect, test, vi } from 'vitest';
import {
  API_REQUEST_TIMEOUT_MS,
  buildRequestUrl,
  createHttpTransport,
  type FetchInit,
  type FetchResponseLike,
} from '../../src/api/http-transport.js';
import {
  NetworkError,
  TimeoutError,
  ValidationError,
  isTimeoutLike,
} from '../../src/api/errors.js';
import { AudienceError } from '../../src/auth/errors.js';
import type { ClientRequest, EventsApiCredential } from '../../src/api/transport.js';

// Unit tests for the live HTTP transport (events-client, S1, task 2.1). They prove
// the transport attaches the Events API access token as the bearer credential and
// never attaches an ID token (Requirements 6.2, 4.1, 4.4), builds the absolute URL
// with query parameters against the fixed live base, and parses JSON, empty and
// non-JSON bodies without judging success. No live network is used: fetch is
// injected.

const ACCESS_TOKEN = 'access-token-value-123';
const ID_TOKEN = 'id-token-value-should-never-be-sent';
const BASE = 'https://api.awsevents.com/v1';

// A credential that hands out only the access token; the ID token is held here only
// so a test can assert it never appears in a request.
function credential(): EventsApiCredential {
  return {
    getAccessTokenForEventsApi: () => Promise.resolve(ACCESS_TOKEN),
    forceRefresh: () => Promise.resolve(),
  };
}

// Capture every call the transport makes to fetch.
interface Captured {
  url: string;
  init: FetchInit;
}

function fetchStub(
  response: FetchResponseLike,
  captured: Captured[],
): (url: string, init: FetchInit) => Promise<FetchResponseLike> {
  return (url, init) => {
    captured.push({ url, init });
    return Promise.resolve(response);
  };
}

function jsonResponse(status: number, value: unknown): FetchResponseLike {
  return {
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(value)),
  };
}

describe('Feature: events-client, the HTTP transport attaches the access token and never the ID token', () => {
  test('a GET request carries the bearer access token and no ID token anywhere', async () => {
    const captured: Captured[] = [];
    const transport = createHttpTransport({
      fetch: fetchStub(jsonResponse(200, { ok: true }), captured),
      credential: credential(),
    });
    const req: ClientRequest = {
      operation: 'GetSchedule',
      method: 'GET',
      path: '/events/E1/schedule',
    };
    const res = await transport.send(req);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call?.init.headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    const serialisedCall = JSON.stringify(call);
    expect(serialisedCall).toContain(ACCESS_TOKEN);
    expect(serialisedCall).not.toContain(ID_TOKEN);
  });

  test('query parameters are appended to the absolute URL built from the base and path', async () => {
    const captured: Captured[] = [];
    const transport = createHttpTransport({
      fetch: fetchStub(jsonResponse(200, { items: [] }), captured),
      credential: credential(),
    });
    const req: ClientRequest = {
      operation: 'ListSessions',
      method: 'GET',
      path: '/events/E1/sessions',
      query: { includeAbstracts: 'false', nextToken: 'abc' },
    };
    await transport.send(req);

    const url = captured[0]?.url ?? '';
    expect(url.startsWith(`${BASE}/events/E1/sessions?`)).toBe(true);
    expect(url).toContain('includeAbstracts=false');
    expect(url).toContain('nextToken=abc');
  });

  test('a POST request serialises the body as JSON and sets content-type', async () => {
    const captured: Captured[] = [];
    const transport = createHttpTransport({
      fetch: fetchStub(jsonResponse(200, { result: { successful: [], failed: [] } }), captured),
      credential: credential(),
    });
    const req: ClientRequest = {
      operation: 'ReserveSessions',
      method: 'POST',
      path: '/events/E1/reservations',
      body: { sessionIds: ['s1', 's2'] },
    };
    await transport.send(req);

    const call = captured[0];
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers['content-type']).toBe('application/json');
    expect(call?.init.body).toBe(JSON.stringify({ sessionIds: ['s1', 's2'] }));
  });

  test('an empty body (for example a 204) is returned as undefined', async () => {
    const captured: Captured[] = [];
    const emptyResponse: FetchResponseLike = {
      status: 204,
      headers: new Headers(),
      text: () => Promise.resolve(''),
    };
    const transport = createHttpTransport({
      fetch: fetchStub(emptyResponse, captured),
      credential: credential(),
    });
    const res = await transport.send({
      operation: 'CancelReservation',
      method: 'DELETE',
      path: '/events/E1/reservations/s1',
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  test('a non-JSON body is returned as the raw string for the layer above to reject', async () => {
    const captured: Captured[] = [];
    const nonJson: FetchResponseLike = {
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve('not json at all'),
    };
    const transport = createHttpTransport({
      fetch: fetchStub(nonJson, captured),
      credential: credential(),
    });
    const res = await transport.send({ operation: 'GetEvent', method: 'GET', path: '/events/E1' });
    expect(res.body).toBe('not json at all');
  });

  test('the default base URL is the live Events API base when none is injected', async () => {
    const captured: Captured[] = [];
    const transport = createHttpTransport({
      fetch: fetchStub(jsonResponse(200, { items: [] }), captured),
      credential: credential(),
    });
    await transport.send({ operation: 'ListEvents', method: 'GET', path: '/events' });
    expect(captured[0]?.url).toBe('https://api.awsevents.com/v1/events');
  });
});

describe('events-client, M3: the bearer token can only go to the Events API', () => {
  const req: ClientRequest = {
    operation: 'GetSchedule',
    method: 'GET',
    path: '/events/E1/schedule',
  };

  test('every request refuses redirects and carries a 30 second timeout signal', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    try {
      const captured: Captured[] = [];
      const transport = createHttpTransport({
        fetch: fetchStub(jsonResponse(200, {}), captured),
        credential: credential(),
      });
      await transport.send(req);
      expect(captured[0]?.init.redirect).toBe('error');
      expect(captured[0]?.init.signal).toBeInstanceOf(AbortSignal);
      expect(spy).toHaveBeenCalledWith(30_000);
      expect(API_REQUEST_TIMEOUT_MS).toBe(30_000);
    } finally {
      spy.mockRestore();
    }
  });

  test('the base URL cannot be injected: an extra baseUrl is ignored and the live host is used', async () => {
    const captured: Captured[] = [];
    const transport = createHttpTransport({
      fetch: fetchStub(jsonResponse(200, {}), captured),
      credential: credential(),
      // @ts-expect-error baseUrl is not an accepted dependency any more
      baseUrl: 'https://evil.example/v1',
    });
    await transport.send(req);
    expect(captured[0]?.url).toBe('https://api.awsevents.com/v1/events/E1/schedule');
  });

  test('buildRequestUrl refuses a non-https scheme, credentials, a custom port and any other host', () => {
    for (const base of [
      'http://api.awsevents.com/v1',
      'https://user:pw@api.awsevents.com/v1',
      'https://api.awsevents.com:8443/v1',
    ]) {
      expect(() => buildRequestUrl(base, req)).toThrow(ValidationError);
    }
    for (const base of [
      'https://api.awsevents.com.evil.example/v1',
      'https://evil.example/v1',
      'https://oauth.awsevents.com/v1',
    ]) {
      expect(() => buildRequestUrl(base, req)).toThrow(AudienceError);
    }
    expect(buildRequestUrl('https://API.AWSEVENTS.COM/v1', req)).toBe(
      'https://api.awsevents.com/v1/events/E1/schedule',
    );
  });

  test('the token is not even fetched when the URL is refused', async () => {
    let asked = false;
    const transport = createHttpTransport({
      fetch: fetchStub(jsonResponse(200, {}), []),
      credential: {
        getAccessTokenForEventsApi: () => {
          asked = true;
          return Promise.resolve(ACCESS_TOKEN);
        },
        forceRefresh: () => Promise.resolve(),
      },
    });
    await expect(
      transport.send({ operation: 'GetSchedule', method: 'GET', path: '/elsewhere' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(asked).toBe(false);
  });
});

describe('events-client, N7: network, abort and redirect failures are typed, fixed and cause-free', () => {
  const req: ClientRequest = {
    operation: 'GetSchedule',
    method: 'GET',
    path: '/events/E1/schedule',
  };
  const transportFailing = (error: Error): ReturnType<typeof createHttpTransport> =>
    createHttpTransport({ credential: credential(), fetch: () => Promise.reject(error) });

  test('a connection error, a refused redirect and any other fetch failure become NetworkError', async () => {
    for (const error of [
      new TypeError('fetch failed: https://api.awsevents.com/?token=SECRET', {
        cause: new Error('ECONNRESET authorization: Bearer SECRET'),
      }),
      new TypeError('redirect mode is set to error'),
      new Error('plain failure'),
    ]) {
      const failure = await transportFailing(error)
        .send(req)
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(NetworkError);
      expect((failure as Error).message).toBe(
        'GetSchedule could not be completed over the network',
      );
      expect((failure as Error).cause).toBeUndefined();
      expect(JSON.stringify(failure)).not.toContain('SECRET');
    }
  });

  test('a timeout or an abort becomes TimeoutError', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const error = new Error('The operation was aborted due to timeout');
      error.name = name;
      const failure = await transportFailing(error)
        .send(req)
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(TimeoutError);
      expect((failure as Error).message).toBe('GetSchedule timed out');
      expect((failure as Error).cause).toBeUndefined();
    }
  });

  test('isTimeoutLike recognises only those two names', () => {
    expect(isTimeoutLike({ name: 'TimeoutError' })).toBe(true);
    expect(isTimeoutLike({ name: 'AbortError' })).toBe(true);
    for (const other of [{ name: 'TypeError' }, {}, 'TimeoutError', null, undefined, 7]) {
      expect(isTimeoutLike(other)).toBe(false);
    }
  });
});
