import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { PassFields } from '@compass/contracts';
import { CompassError, createCompassClient } from '../../src/passes/compass-client.js';
import type { CompassClient } from '../../src/passes/compass-client.js';
import { buildPass } from '../../src/passes/pass-builder.js';
import { PassError } from '../../src/passes/redaction.js';
import {
  createContractMock,
  jsonResponse,
  problem,
  type ContractMock,
  type MockResponse,
} from './openapi-mock.js';
import { NUM_RUNS, WINDOW, fakeClock, fakeConnections, makeSession } from './support.js';

// Tests for Compass_Client (boarding-passes, S4, Requirement 2). Every test runs against
// the in-memory mock built from contracts/compass-api.openapi.yaml (Requirement 9.4), and
// each helper checks that the mock saw no contract violation in what the client sent.

const BASE_URL = 'https://d111111abcdef8.cloudfront.net';
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRlbmRlZSJ9.c2lnbmF0dXJlX3ZhbHVl';
const SERIAL = '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';
const OTHER_SERIAL = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SENTINEL_EMAIL = 'first.timer@example.com';
const SENTINEL_TITLE = 'Quietly Confidential Session Title';

const FIELDS: PassFields = buildPass(
  { session: makeSession({ title: SENTINEL_TITLE }), eventWindow: WINDOW },
  { connections: fakeConnections() },
).fields;

interface Rig {
  mock: ContractMock;
  clock: ReturnType<typeof fakeClock>;
  client: CompassClient;
}

function rig(
  token: string | (() => Promise<string>) = TOKEN,
  baseUrl = BASE_URL,
  basePath = '',
): Rig {
  const mock = createContractMock(basePath);
  const clock = fakeClock();
  const client = createCompassClient({
    baseUrl,
    transport: mock,
    clock,
    idToken: { getIdToken: typeof token === 'string' ? () => Promise.resolve(token) : token },
  });
  return { mock, clock, client };
}

/** Every request the client sent must conform to the contract. */
function expectConforming(mock: ContractMock): void {
  for (const request of mock.requests) {
    expect(request.violations).toEqual([]);
  }
}

/** Run a promise and return the PassError it rejects with, failing if it resolves. */
async function failureOf(promise: Promise<unknown>): Promise<CompassError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CompassError);
    return error as CompassError;
  }
  throw new Error('expected the call to fail');
}

const ISSUE_REQUEST = {
  platforms: ['apple', 'google'] as ('apple' | 'google')[],
  passes: [FIELDS],
};
const HANDOFF_REQUEST = {
  serialNumbers: [SERIAL, OTHER_SERIAL],
  include: { apple: true, google: false, calendar: true },
};

type Call = (client: CompassClient) => Promise<unknown>;
const CALLS: Record<string, Call> = {
  issuePasses: (c) => c.issuePasses(ISSUE_REQUEST),
  getApplePass: (c) => c.getApplePass(SERIAL),
  updatePass: (c) => c.updatePass(SERIAL, FIELDS),
  voidPass: (c) => c.voidPass(SERIAL),
  createHandoff: (c) => c.createHandoff(HANDOFF_REQUEST),
  forgetMe: (c) => c.forgetMe(),
};

describe('Feature: boarding-passes, Property 8: ID token attached as Bearer on every attendee route', () => {
  const tokenArb = fc.stringMatching(/^[A-Za-z0-9_-]{8,40}(\.[A-Za-z0-9_-]{8,40}){2}$/);

  test('every route carries Authorization equal to Bearer plus the provider token', async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, async (token) => {
        const { mock, client } = rig(token);
        for (const call of Object.values(CALLS)) {
          await call(client);
        }
        expect(mock.requests).toHaveLength(Object.keys(CALLS).length);
        for (const request of mock.requests) {
          expect(request.headers.authorization).toBe(`Bearer ${token}`);
        }
        expectConforming(mock);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('the token is fetched fresh for every request', async () => {
    let calls = 0;
    const { client } = rig(() => {
      calls += 1;
      return Promise.resolve(TOKEN);
    });
    await client.forgetMe();
    await client.forgetMe();
    expect(calls).toBe(2);
  });
});

describe('Feature: boarding-passes, Property 10: Problem bodies parse and surface without request input', () => {
  const problemArb = fc.record({
    type: fc.string({ maxLength: 40 }),
    title: fc.string({ minLength: 1, maxLength: 40 }),
    status: fc.integer({ min: 400, max: 599 }).filter((status) => status !== 429),
    code: fc.stringMatching(/^[a-z_]{3,20}$/),
  });

  test('the surfaced error matches the Problem and carries no request input', async () => {
    await fc.assert(
      fc.asyncProperty(problemArb, async (body) => {
        const { mock, client } = rig();
        mock.enqueue('issuePasses', {
          status: body.status,
          headers: { 'content-type': 'application/problem+json; charset=utf-8' },
          body: JSON.stringify(body),
        });
        const error = await failureOf(
          client.issuePasses({
            platforms: ['apple'],
            passes: [{ ...FIELDS, attendeeName: SENTINEL_EMAIL }],
          }),
        );
        expect(error.code).toBe('compass.problem');
        expect(error.status).toBe(body.status);
        expect(error.problem).toEqual(body);
        const surfaced = `${error.message}|${error.summary}|${JSON.stringify(error)}`;
        expect(surfaced).not.toContain(SENTINEL_TITLE);
        expect(surfaced).not.toContain(SENTINEL_EMAIL);
        expect(surfaced).not.toContain(TOKEN);
        expectConforming(mock);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Feature: boarding-passes, Property 11: single retry only on 429 with a usable Retry-After', () => {
  const NOW_MS = Date.parse('2026-12-01T08:00:00.000Z');

  test('delta-seconds: one retry after the wait, capped at 60 seconds', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 100_000 }), async (seconds) => {
        const { mock, clock, client } = rig();
        mock.enqueue('forgetMe', {
          status: 429,
          headers: { 'retry-after': String(seconds), 'content-type': 'application/problem+json' },
          body: JSON.stringify({ type: 'x', title: 'Slow down', status: 429, code: 'rate' }),
        });
        const result = await client.forgetMe();
        expect(result.status).toBe(202);
        expect(mock.requests).toHaveLength(2);
        expect(clock.sleeps).toEqual([Math.min(seconds, 60) * 1000]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('HTTP-date: one retry after the time until that date, capped at 60 seconds', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -3600, max: 7200 }), async (offsetSeconds) => {
        const { mock, clock, client } = rig();
        const date = new Date(NOW_MS + offsetSeconds * 1000).toUTCString();
        mock.enqueue('voidPass', { status: 429, headers: { 'retry-after': date }, body: '' });
        const result = await client.voidPass(SERIAL);
        expect(result.outcome).toBe('voided');
        expect(mock.requests).toHaveLength(2);
        expect(clock.sleeps).toEqual([Math.min(Math.max(offsetSeconds, 0), 60) * 1000]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('an absent or unusable Retry-After surfaces the 429 with no retry', async () => {
    const unusable = fc.oneof(
      fc.constant(undefined),
      fc.constantFrom(
        '',
        'soon',
        '-3',
        '1.5',
        '10 seconds',
        'Tomorrow',
        '1e3',
        'Sun, 99 Foo 2026 99:99:99 GMT',
      ),
      fc.stringMatching(/^[a-z ]{0,12}$/),
    );
    await fc.assert(
      fc.asyncProperty(unusable, async (header) => {
        const { mock, clock, client } = rig();
        mock.enqueue('createHandoff', {
          status: 429,
          headers: header === undefined ? {} : { 'retry-after': header },
          body: '',
        });
        const error = await failureOf(client.createHandoff(HANDOFF_REQUEST));
        expect(error.code).toBe('compass.rate_limited');
        expect(error.status).toBe(429);
        expect(mock.requests).toHaveLength(1);
        expect(clock.sleeps).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('a date that has the HTTP-date shape but is not a real date is unusable', async () => {
    const { mock, clock, client } = rig();
    mock.enqueue('forgetMe', {
      status: 429,
      headers: { 'retry-after': 'Sun, 99 Foo 2026 99:99:99 GMT' },
      body: '',
    });
    expect((await failureOf(client.forgetMe())).code).toBe('compass.rate_limited');
    expect(mock.requests).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  test('a second 429 is surfaced and never retried again', async () => {
    const { mock, clock, client } = rig();
    const slow: MockResponse = { status: 429, headers: { 'retry-after': '2' }, body: '' };
    mock.enqueue('issuePasses', slow, slow);
    const error = await failureOf(client.issuePasses(ISSUE_REQUEST));
    expect(error.code).toBe('compass.rate_limited');
    expect(mock.requests).toHaveLength(2);
    expect(clock.sleeps).toEqual([2000]);
  });

  test('a write that fails with a non-retryable status is attempted exactly once', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(400, 401, 403, 409, 500, 502, 503), async (status) => {
        const { mock, clock, client } = rig();
        mock.enqueue('issuePasses', { status, headers: { 'retry-after': '1' }, body: '' });
        const error = await failureOf(client.issuePasses(ISSUE_REQUEST));
        expect(error.status).toBe(status);
        expect(mock.requests).toHaveLength(1);
        expect(clock.sleeps).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Feature: boarding-passes, Property 12: response validation gate', () => {
  const uuid = fc.uuid();
  const instant = fc
    .integer({ min: Date.parse('2000-01-01T00:00:00Z'), max: Date.parse('2100-01-01T00:00:00Z') })
    .map((ms) => new Date(ms).toISOString());

  interface Endpoint {
    name: string;
    operationId: string;
    status: number;
    valid: fc.Arbitrary<Record<string, unknown>>;
    run: Call;
    expected: (body: Record<string, unknown>) => unknown;
  }

  const endpoints: Endpoint[] = [
    {
      name: 'issuePasses',
      operationId: 'issuePasses',
      status: 201,
      valid: fc.record({
        passes: fc.array(
          fc.record({
            serialNumber: uuid,
            sessionCode: fc.string({ maxLength: 12 }),
            platforms: fc.subarray(['apple', 'google'] as const),
          }),
          { maxLength: 4 },
        ),
      }),
      run: CALLS.issuePasses,
      expected: (body) => body,
    },
    {
      name: 'updatePass',
      operationId: 'updatePass',
      status: 200,
      valid: fc.record({ serialNumber: uuid, version: fc.nat() }),
      run: CALLS.updatePass,
      expected: (body) => ({ outcome: 'updated', response: body }),
    },
    {
      name: 'voidPass',
      operationId: 'voidPass',
      status: 200,
      valid: fc.record({ serialNumber: uuid, status: fc.constant('voided') }),
      run: CALLS.voidPass,
      expected: (body) => ({ outcome: 'voided', response: body }),
    },
    {
      name: 'createHandoff',
      operationId: 'createHandoff',
      status: 201,
      valid: fc.record({ handoffId: fc.string(), boardUrl: fc.string(), expiresAt: instant }),
      run: CALLS.createHandoff,
      expected: (body) => body,
    },
    {
      name: 'forgetMe',
      operationId: 'forgetMe',
      status: 202,
      valid: fc.record({ voided: fc.nat(), deleted: fc.nat() }),
      run: CALLS.forgetMe,
      expected: (body) => ({ status: 202, response: body }),
    },
  ];

  /** Break a valid body in one of four ways, each of which the contract forbids. */
  const mutation = fc.oneof(
    fc.constant('drop' as const),
    fc.constant('extra' as const),
    fc.constant('retype' as const),
    fc.constant('empty' as const),
  );
  function mutate(
    body: Record<string, unknown>,
    kind: 'drop' | 'extra' | 'retype' | 'empty',
    pick: number,
  ): unknown {
    const keys = Object.keys(body);
    const key = keys[pick % keys.length];
    if (kind === 'drop') {
      return Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));
    }
    if (kind === 'extra') {
      return { ...body, unexpectedField: 'x' };
    }
    if (kind === 'retype') {
      return { ...body, [key]: { retyped: true } };
    }
    return {};
  }

  for (const endpoint of endpoints) {
    test(`${endpoint.name}: a conforming body is returned and a broken one is refused`, async () => {
      await fc.assert(
        fc.asyncProperty(endpoint.valid, mutation, fc.nat(), async (body, kind, pick) => {
          const good = rig();
          good.mock.enqueue(endpoint.operationId, jsonResponse(endpoint.status, body));
          expect(await endpoint.run(good.client)).toEqual(endpoint.expected(body));

          const bad = rig();
          const broken = mutate(body, kind, pick);
          bad.mock.enqueue(endpoint.operationId, jsonResponse(endpoint.status, broken));
          const error = await failureOf(endpoint.run(bad.client));
          expect(error.code).toBe('compass.validation_failed');
          expect(error.message).not.toContain('retyped');
          expectConforming(bad.mock);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    test(`${endpoint.name}: a body that is not JSON, or not an object, is refused`, async () => {
      for (const raw of ['', 'not json', 'null', '[]', '"text"', '42']) {
        const { mock, client } = rig();
        mock.enqueue(endpoint.operationId, {
          status: endpoint.status,
          headers: { 'content-type': 'application/json' },
          body: raw,
        });
        const error = await failureOf(endpoint.run(client));
        expect(error.code).toBe('compass.validation_failed');
      }
    });
  }
});

describe('Feature: boarding-passes, Compass_Client example tests', () => {
  test('getApplePass returns the pass bytes unchanged', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x7f]);
    const { mock, client } = rig();
    mock.enqueue('getApplePass', {
      status: 200,
      headers: { 'content-type': 'application/vnd.apple.pkpass' },
      body: '',
      bytes,
    });
    const result = await client.getApplePass(SERIAL);
    expect(Array.from(result)).toEqual(Array.from(bytes));
    expect(mock.requests[0]?.binary).toBe(true);
    expect(mock.requests[0]?.url).toBe(`${BASE_URL}/api/v1/passes/${SERIAL}/apple`);
    expectConforming(mock);
  });

  test('getApplePass refuses a success without bytes and surfaces an error status', async () => {
    for (const response of [
      { status: 200, headers: {}, body: 'text' },
      { status: 200, headers: {}, body: '', bytes: new Uint8Array() },
    ]) {
      const { mock, client } = rig();
      mock.enqueue('getApplePass', response);
      expect((await failureOf(client.getApplePass(SERIAL))).code).toBe('compass.validation_failed');
    }
    const { mock, client } = rig();
    mock.enqueue('getApplePass', problem(404, 'not_found'));
    const error = await failureOf(client.getApplePass(SERIAL));
    expect(error.code).toBe('compass.problem');
    expect(error.status).toBe(404);
  });

  test('voiding a serial twice reports the completed state and no error both times', async () => {
    const { mock, client } = rig();
    const first = await client.voidPass(SERIAL);
    const second = await client.voidPass(SERIAL);
    expect(first.outcome).toBe('voided');
    expect(first).toMatchObject({ response: { status: 'voided' } });
    expect(second).toEqual(first);
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[0]?.url).toBe(`${BASE_URL}/api/v1/passes/${SERIAL}/void`);
    expectConforming(mock);
  });

  test('a 404 on update or void signals that the serial is already gone', async () => {
    for (const body of [problem(404, 'not_found'), { status: 404, headers: {}, body: '' }]) {
      const { mock, client } = rig();
      mock.enqueue('updatePass', body);
      mock.enqueue('voidPass', body);
      expect(await client.updatePass(SERIAL, FIELDS)).toEqual({ outcome: 'gone' });
      expect(await client.voidPass(SERIAL)).toEqual({ outcome: 'gone' });
    }
  });

  test('update sends PUT with the pass fields, issue and handoff send POST with the contract body', async () => {
    const { mock, client } = rig();
    await client.updatePass(SERIAL, FIELDS);
    await client.issuePasses(ISSUE_REQUEST);
    await client.createHandoff(HANDOFF_REQUEST);
    await client.forgetMe();
    expect(mock.requests.map((r) => `${r.method} ${r.url.slice(BASE_URL.length)}`)).toEqual([
      `PUT /api/v1/passes/${SERIAL}`,
      'POST /api/v1/passes',
      'POST /api/v1/handoffs',
      'DELETE /api/v1/me',
    ]);
    expect(mock.requests[0]?.body).toEqual(FIELDS);
    expect(mock.requests[1]?.body).toEqual(ISSUE_REQUEST);
    expect(mock.requests[2]?.body).toEqual(HANDOFF_REQUEST);
    expectConforming(mock);
  });

  test('forgetMe returns the status with the validated body, and a 401 is an error', async () => {
    const { mock, client } = rig();
    mock.enqueue('forgetMe', jsonResponse(202, { voided: 3, deleted: 5 }));
    expect(await client.forgetMe()).toEqual({ status: 202, response: { voided: 3, deleted: 5 } });
    mock.enqueue('forgetMe', problem(401, 'unauthorized'));
    const error = await failureOf(client.forgetMe());
    expect(error.code).toBe('compass.problem');
    expect(error.status).toBe(401);
  });

  test('a problem body that is not a valid Problem is a validation failure', async () => {
    for (const body of ['not json', JSON.stringify({ title: 'only a title' })]) {
      const { mock, client } = rig();
      mock.enqueue('issuePasses', {
        status: 400,
        headers: { 'content-type': 'application/problem+json' },
        body,
      });
      const error = await failureOf(client.issuePasses(ISSUE_REQUEST));
      expect(error.code).toBe('compass.validation_failed');
      expect(error.status).toBe(400);
      expect(error.problem).toBeUndefined();
    }
  });

  test('a non-problem error status is an http_error and its body is never echoed', async () => {
    const { mock, client } = rig();
    mock.enqueue('issuePasses', {
      status: 502,
      headers: {},
      body: `upstream said ${SENTINEL_EMAIL}`,
    });
    const error = await failureOf(client.issuePasses(ISSUE_REQUEST));
    expect(error.code).toBe('compass.http_error');
    expect(error.message).toBe('The Compass API answered 502 for POST /api/v1/passes.');
  });

  test('a 429 problem body is kept on the rate_limited error', async () => {
    const { mock, client } = rig();
    mock.enqueue('issuePasses', problem(429, 'rate_limited'));
    const error = await failureOf(client.issuePasses(ISSUE_REQUEST));
    expect(error.code).toBe('compass.rate_limited');
    expect(error.problem?.code).toBe('rate_limited');
  });

  test('a transport failure names only the route and never the thrown message', async () => {
    const { mock, client } = rig();
    mock.failNext(new Error(`connect failed for ${BASE_URL}/api/v1/me with ${TOKEN}`));
    const error = await failureOf(client.forgetMe());
    expect(error.code).toBe('compass.transport_failed');
    expect(error.message).toBe('The Compass API request DELETE /api/v1/me failed.');
  });

  test('a missing or unusable ID token stops the call before anything is sent', async () => {
    const providers: (() => Promise<string>)[] = [
      () => Promise.reject(new Error(`keychain says ${TOKEN}`)),
      () => Promise.resolve(''),
      () => Promise.resolve('has a space'),
      () => Promise.resolve('line\r\nbreak'),
      () => Promise.resolve('a'.repeat(9000)),
    ];
    for (const provider of providers) {
      const { mock, client } = rig(provider);
      const error = await failureOf(client.forgetMe());
      expect(error.code).toBe('compass.no_id_token');
      expect(error.message).toBe('No ID token is available. Sign in again.');
      expect(mock.requests).toHaveLength(0);
    }
  });

  test('a serial number that is not a UUID is refused before any URL is built', async () => {
    const { mock, client } = rig();
    for (const bad of ['../../me', `${SERIAL}/void`, '', 'not-a-uuid']) {
      for (const call of [
        () => client.getApplePass(bad),
        () => client.updatePass(bad, FIELDS),
        () => client.voidPass(bad),
      ]) {
        const error = await failureOf(call());
        expect(error.code).toBe('compass.invalid_input');
        expect(error.message).toBe('The serial number is not valid.');
      }
    }
    expect(mock.requests).toHaveLength(0);
  });

  test('request lists and flags outside the contract limits are refused without echo', async () => {
    const { mock, client } = rig();
    const tooManyPasses = Array.from({ length: 26 }, () => FIELDS);
    const tooManySerials = Array.from({ length: 81 }, () => SERIAL);
    const cases: [Promise<unknown>, string][] = [
      [client.issuePasses({ platforms: [], passes: [FIELDS] }), 'platform list'],
      [
        client.issuePasses({ platforms: ['apple', 'google', 'apple'], passes: [FIELDS] }),
        'platform list',
      ],
      [client.issuePasses({ platforms: ['apple'], passes: [] }), 'pass list'],
      [client.issuePasses({ platforms: ['apple'], passes: tooManyPasses }), 'pass list'],
      [client.issuePasses({ platforms: ['apple'], passes: ['text' as never] }), 'pass list'],
      [client.createHandoff({ ...HANDOFF_REQUEST, serialNumbers: [] }), 'serial number list'],
      [
        client.createHandoff({ ...HANDOFF_REQUEST, serialNumbers: tooManySerials }),
        'serial number list',
      ],
      [client.createHandoff({ ...HANDOFF_REQUEST, serialNumbers: ['nope'] }), 'serial number list'],
      [
        client.createHandoff({ ...HANDOFF_REQUEST, include: { apple: true } as never }),
        'include flags',
      ],
    ];
    for (const [promise, what] of cases) {
      const error = await failureOf(promise);
      expect(error.code).toBe('compass.invalid_input');
      expect(error.message).toBe(`The ${what} is not valid.`);
    }
    expect(mock.requests).toHaveLength(0);
  });

  test('the base URL must be an https URL without credentials, and a trailing slash is trimmed', async () => {
    for (const bad of [
      'not a url',
      'http://d111111abcdef8.cloudfront.net',
      'https://user:pw@host.test',
    ]) {
      expect(() => rig(TOKEN, bad)).toThrow(PassError);
      try {
        rig(TOKEN, bad);
      } catch (error) {
        expect((error as PassError).code).toBe('compass.invalid_config');
        expect((error as PassError).message).not.toContain('user:pw');
      }
    }
    const { mock, client } = rig(TOKEN, `${BASE_URL}/prefix/`, '/prefix');
    await client.forgetMe();
    expect(mock.requests[0]?.url).toBe(`${BASE_URL}/prefix/api/v1/me`);
  });

  test('a request the contract does not allow is answered with a problem by the mock', async () => {
    const mock = createContractMock();
    const response = await mock.request({
      method: 'POST',
      url: `${BASE_URL}/api/v1/handoffs`,
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ serialNumbers: [], include: {} }),
    });
    expect(response.status).toBe(400);
    expect(mock.requests[0]?.violations.length).toBeGreaterThan(0);
    const unknown = await mock.request({ method: 'GET', url: `${BASE_URL}/nowhere`, headers: {} });
    expect(unknown.status).toBe(404);
    const unauthorised = await mock.request({
      method: 'DELETE',
      url: `${BASE_URL}/api/v1/me`,
      headers: {},
    });
    expect(unauthorised.status).toBe(401);
  });
});
