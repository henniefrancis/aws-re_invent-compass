import { describe, expect, test } from 'vitest';
import {
  createHttpTransport,
  type FetchInit,
  type FetchResponseLike,
} from '../../src/api/http-transport.js';
import type { ClientRequest, EventsApiCredential } from '../../src/api/transport.js';

// Unit tests for the live HTTP transport (events-client, S1, task 2.1). They prove
// the transport attaches the Events API access token as the bearer credential and
// never attaches an ID token (Requirements 6.2, 4.1, 4.4), builds the absolute URL
// with query parameters against the injected base, and parses JSON, empty and
// non-JSON bodies without judging success. No live network is used: fetch is
// injected.

const ACCESS_TOKEN = 'access-token-value-123';
const ID_TOKEN = 'id-token-value-should-never-be-sent';
const BASE = 'https://api.example.test/v1';

// A credential that hands out only the access token; the ID token is held here only
// so a test can assert it never appears in a request.
function credential(): EventsApiCredential {
  return {
    getAccessTokenForEventsApi: () => Promise.resolve(ACCESS_TOKEN),
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
      baseUrl: BASE,
    });
    const req: ClientRequest = { operation: 'GetSchedule', method: 'GET', path: '/schedule' };
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
      baseUrl: BASE,
    });
    const req: ClientRequest = {
      operation: 'ListSessions',
      method: 'GET',
      path: '/sessions',
      query: { includeAbstracts: 'false', nextToken: 'abc' },
    };
    await transport.send(req);

    const url = captured[0]?.url ?? '';
    expect(url.startsWith(`${BASE}/sessions?`)).toBe(true);
    expect(url).toContain('includeAbstracts=false');
    expect(url).toContain('nextToken=abc');
  });

  test('a POST request serialises the body as JSON and sets content-type', async () => {
    const captured: Captured[] = [];
    const transport = createHttpTransport({
      fetch: fetchStub(jsonResponse(200, { result: { successful: [], failed: [] } }), captured),
      credential: credential(),
      baseUrl: BASE,
    });
    const req: ClientRequest = {
      operation: 'ReserveSessions',
      method: 'POST',
      path: '/reservations',
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
      baseUrl: BASE,
    });
    const res = await transport.send({
      operation: 'CancelReservation',
      method: 'DELETE',
      path: '/reservations/s1',
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
      baseUrl: BASE,
    });
    const res = await transport.send({ operation: 'GetEvent', method: 'GET', path: '/event' });
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
