import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  BadRequestError,
  ConflictError,
  createClientContext,
  createRedactingLogger,
  errorForStatus,
  EventsApiError,
  EventWindowError,
  NetworkError,
  QuotaExceededError,
  ResponseTooLargeError,
  TimeoutError,
  ValidationError,
} from '@compass/core/api';
import type { ClientContext, RawResponse } from '@compass/core/api';
import {
  AudienceError,
  CallbackError,
  NoLoopbackPortError,
  NotSignedInError,
  OAuthNetworkError,
  OAuthTimeoutError,
  RefreshFailedError,
  SignInFailedError,
  SignInRequiredError,
  SignInTimeoutError,
  StateMismatchError,
} from '@compass/core/auth';
import { CacheWriteError, CatalogIncompleteError, realFs } from '@compass/core/catalog';
import { createEventsAdapter, mapEventsError } from '../../src/adapters/events-adapter.js';
import type { AuthPort } from '../../src/adapters/events-adapter.js';
import { toWireInstant } from '../../src/adapters/events-adapter.js';
import type { CompassError } from '../../src/ports/errors.js';
import type { EventsPort } from '../../src/ports/events-port.js';
import { readVenues } from '../../src/runtime/create-runtime.js';
import { repoRoot } from '../support/fake-catalog.js';
import { TRIPLE } from '../support/triple.js';

const NOW = Date.parse('2026-11-29T18:00:00-08:00');

interface Arranged {
  events: EventsPort;
  ctx: ClientContext;
  requests: string[];
  auth: {
    signedIn: boolean;
    expires: boolean;
    signInResult: () => Promise<{ memoryOnlyNotice?: string }>;
    outs: number;
  };
  failNext: { schedule: boolean; listEvents: boolean };
  rewrite: { current: ((operation: string, response: RawResponse) => RawResponse) | undefined };
}

const codeOf = (error: unknown): unknown => (error as CompassError).code;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'compass-events-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function arrange(eventId = 'reinvent2026'): Promise<Arranged> {
  const base = createClientContext(
    { COMPASS_MODE: 'simulated' },
    {
      eventId,
      logger: createRedactingLogger({
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      }),
      now: () => NOW,
      sleep: () => Promise.resolve(),
      simulated: { now: () => NOW },
    },
  );
  const requests: string[] = [];
  const failNext = { schedule: false, listEvents: false };
  const rewrite: Arranged['rewrite'] = { current: undefined };
  const ctx: ClientContext = {
    ...base,
    transport: {
      ...base.transport,
      send: (request): Promise<RawResponse> => {
        requests.push(`${request.method} ${request.operation}`);
        if (request.operation === 'GetSchedule' && failNext.schedule) {
          failNext.schedule = false;
          return Promise.reject(new NetworkError('GetSchedule'));
        }
        if (request.operation === 'ListEvents' && failNext.listEvents) {
          failNext.listEvents = false;
          return Promise.reject(new NetworkError('ListEvents'));
        }
        return base.transport
          .send(request)
          .then((response) => rewrite.current?.(request.operation, response) ?? response);
      },
    },
  };
  const auth = {
    signedIn: true,
    expires: true,
    signInResult: (): Promise<{ memoryOnlyNotice?: string }> => Promise.resolve({}),
    outs: 0,
  };
  const port: AuthPort = {
    isSignedIn: () => auth.signedIn,
    expiresAt: () => (auth.signedIn && auth.expires ? '2026-11-29T20:00:00.000Z' : undefined),
    signIn: () => auth.signInResult(),
    signOut: () => {
      auth.outs += 1;
      return Promise.resolve({ signOutUrl: 'https://idp.awsevents.com/oidc/logout' });
    },
  };
  const venues = await readVenues(join(repoRoot(), 'data', 'venues.json'));
  const events = createEventsAdapter({
    ctx,
    auth: port,
    catalogDir: dir,
    catalogFs: realFs,
    venues: venues.list,
    now: () => NOW,
  });
  return { events, ctx, requests, auth, failNext, rewrite };
}

describe('catalog and window', () => {
  test('the catalog is missing until refreshed, then served from the cache without a request', async () => {
    const { events, requests } = await arrange();
    await expect(events.catalog()).rejects.toMatchObject({ code: 'CatalogMissing' });
    const refreshed = await events.refreshCatalog();
    expect(refreshed.sessionCount).toBe(120);
    expect(refreshed.refreshedAt).toBe(new Date(NOW).toISOString());
    const before = requests.length;
    const view = await events.catalog();
    expect(requests.length).toBe(before);
    expect(view.byId.size).toBe(120);
    expect(view.byId.get(TRIPLE.a)?.session.code).toBe(`${TRIPLE.codes.a}`);
    expect(view.labels.length).toBeGreaterThan(0);
    expect(view.labels).toEqual([...view.labels].sort());
  });

  test('a cache for another event is not used', async () => {
    const first = await arrange();
    await first.events.refreshCatalog();
    const other = await arrange('other-event');
    await expect(other.events.catalog()).rejects.toMatchObject({ code: 'CatalogMissing' });
  });

  test('filter applies the S1 criteria and the services filter over the wire services', async () => {
    const { events } = await arrange();
    await events.refreshCatalog();
    const view = await events.catalog();
    expect(view.filter({})).toHaveLength(120);
    const label = view.labels[0] ?? '';
    const some = view.filter({ services: [label.toUpperCase()] });
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(120);
    for (const session of some) {
      const services = view.byId.get(session.sessionId)?.services ?? [];
      expect(services.map((s) => s.toLowerCase())).toContain(label.toLowerCase());
    }
    expect(view.filter({ services: ['no-such-service'] })).toEqual([]);
    expect(view.filter({ text: `${TRIPLE.codes.a}` }).map((s) => s.sessionId)).toContain(TRIPLE.a);
  });

  test('the event window is read once and kept; a failure is not kept', async () => {
    const { events, requests, failNext } = await arrange();
    failNext.listEvents = true;
    await expect(events.eventWindow()).rejects.toMatchObject({ code: 'Network' });
    const window = await events.eventWindow();
    expect(window.timezone).toBe('America/Los_Angeles');
    const count = requests.length;
    expect(await events.eventWindow()).toBe(window);
    expect(requests.length).toBe(count);
  });
});

describe('sign in and out', () => {
  test('already signed in answers without signing in; force signs in again', async () => {
    const { events, auth } = await arrange();
    expect(await events.isSignedIn()).toBe(true);
    expect(await events.signIn(false)).toEqual({
      signedIn: true,
      expiresAt: '2026-11-29T20:00:00.000Z',
    });
    auth.signInResult = () => Promise.resolve({ memoryOnlyNotice: 'memory only' });
    expect(await events.signIn(true)).toEqual({
      signedIn: true,
      expiresAt: '2026-11-29T20:00:00.000Z',
      memoryOnlyNotice: 'memory only',
    });
  });

  test('sign-in completes without an expiry when none is known', async () => {
    const { events, auth } = await arrange();
    auth.signedIn = false;
    expect(await events.signIn(false)).toEqual({ signedIn: true });
    auth.signedIn = true;
    expect(await events.signIn(false)).toMatchObject({ signedIn: true });
  });

  test('a sign-in that does not finish is not signed in; other failures are mapped', async () => {
    const { events, auth } = await arrange();
    auth.signedIn = false;
    for (const error of [
      new SignInTimeoutError(),
      new CallbackError('access_denied'),
      new StateMismatchError(),
      new SignInFailedError(),
      new NoLoopbackPortError(),
    ]) {
      auth.signInResult = () => Promise.reject(error);
      expect(await events.signIn(false)).toEqual({ signedIn: false });
    }
    auth.signInResult = () => Promise.reject(new OAuthNetworkError());
    await expect(events.signIn(false)).rejects.toMatchObject({ code: 'Network' });
  });

  test('sign out returns the sign-out address', async () => {
    const { events, auth } = await arrange();
    expect(await events.signOut()).toEqual({ signOutUrl: 'https://idp.awsevents.com/oidc/logout' });
    expect(auth.outs).toBe(1);
  });
});

describe('schedule reads and writes', () => {
  test('reserve, clash, favorite, personal time and cancel against the simulated service', async () => {
    const { events } = await arrange();
    expect(await events.getSchedule()).toMatchObject({ reserved: [] });
    const session = await events.getSession(TRIPLE.a);
    expect(session.code).toBe(`${TRIPLE.codes.a}`);
    expect(session.startsAt).toBe('2026-12-01T13:00:00-08:00');

    const reserved = await events.reserve([TRIPLE.a]);
    expect(reserved).toMatchObject({
      kind: 'confirmed',
      result: { successful: [TRIPLE.a], failed: [] },
    });
    if (reserved.kind === 'confirmed') {
      expect(reserved.schedule.reserved).toContain(TRIPLE.a);
    }
    const clash = await events.reserve([TRIPLE.b]);
    expect(clash).toMatchObject({ kind: 'confirmed', result: { successful: [] } });
    if (clash.kind === 'confirmed') {
      expect(clash.result.failed[0]).toMatchObject({
        sessionId: TRIPLE.b,
        code: 'scheduleConflict',
      });
      expect(clash.result.failed[0]).not.toHaveProperty('refusal');
    }
    expect(await events.favorite([TRIPLE.b])).toMatchObject({
      kind: 'confirmed',
      result: { successful: [TRIPLE.b] },
    });
    expect(await events.unfavorite(TRIPLE.b)).toMatchObject({ kind: 'confirmed', result: null });
    const layover = await events.createPersonalTime({
      title: 'Lunch',
      description: 'Away from the venue',
      startDateTime: '2026-12-02T12:00:00-08:00',
      endDateTime: '2026-12-02T13:00:00-08:00',
    });
    expect(layover.kind).toBe('confirmed');
    if (layover.kind === 'confirmed') {
      expect(layover.schedule.personalTime[0]).toMatchObject({
        startDateTime: '2026-12-02T20:00:00Z',
        endDateTime: '2026-12-02T21:00:00Z',
      });
    }
    expect((await events.getSchedule()).personalTime[0]?.startDateTime).toBe(
      '2026-12-02T20:00:00Z',
    );
    expect(await events.cancel(TRIPLE.a)).toMatchObject({ kind: 'confirmed', result: null });
  });

  test('a write whose confirming read fails is unconfirmed and is sent once', async () => {
    const { events, failNext, requests } = await arrange();
    failNext.schedule = true;
    expect((await events.reserve([TRIPLE.a])).kind).toBe('unconfirmed');
    expect(requests.filter((r) => r === 'POST ReserveSessions')).toHaveLength(1);
    failNext.schedule = true;
    expect((await events.cancel(TRIPLE.a)).kind).toBe('unconfirmed');
  });

  test('a throttled or expired reserve is retried at most once and never resent beyond that (CTO review M2)', async () => {
    for (const [scenario, config] of [
      ['429', { throttleOps: ['ReserveSessions' as const] }],
      ['401', { expiredTokenOps: ['ReserveSessions' as const] }],
    ] as const) {
      const base = createClientContext(
        { COMPASS_MODE: 'simulated' },
        {
          eventId: 'reinvent2026',
          logger: createRedactingLogger({
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          }),
          now: () => NOW,
          sleep: () => Promise.resolve(),
          simulated: { now: () => NOW, ...config, scenarioRepeats: 5 },
        },
      );
      const sent: string[] = [];
      const ctx: ClientContext = {
        ...base,
        transport: {
          ...base.transport,
          send: (request) => {
            sent.push(request.operation);
            return base.transport.send(request);
          },
        },
      };
      const venues = await readVenues(join(repoRoot(), 'data', 'venues.json'));
      const events = createEventsAdapter({
        ctx,
        auth: {
          isSignedIn: () => true,
          expiresAt: () => undefined,
          signIn: () => Promise.resolve({}),
          signOut: () => Promise.resolve({ signOutUrl: 'x' }),
        },
        catalogDir: dir,
        catalogFs: realFs,
        venues: venues.list,
        now: () => NOW,
      });
      await expect(events.reserve([TRIPLE.a]), scenario).rejects.toBeDefined();
      expect(sent.filter((op) => op === 'ReserveSessions').length, scenario).toBeLessThanOrEqual(2);
      expect(
        sent.filter((op) => op === 'GetSchedule'),
        scenario,
      ).toEqual([]);
    }
  });

  test('a bad id is refused before any request', async () => {
    const { events, requests } = await arrange();
    const count = requests.length;
    const calls: (() => Promise<unknown>)[] = [
      () => events.getSession('a/b'),
      () => events.reserve(['..']),
      () => events.cancel(''),
      () => events.favorite(['x\u0000y']),
      () => events.unfavorite('a\\b'),
    ];
    for (const call of calls) {
      await expect(Promise.resolve().then(call)).rejects.toMatchObject({
        code: 'IdentifierRejected',
      });
    }
    expect(requests.length).toBe(count);
  });

  test('an invalid event id is refused when the adapter is built', async () => {
    await expect(arrange('a/b')).rejects.toMatchObject({ code: 'IdentifierRejected' });
  });

  test('S1 errors become fixed codes on every path', async () => {
    const { events, ctx } = await arrange();
    ctx.transport.send = () => Promise.reject(new TimeoutError('GetSchedule'));
    await expect(events.getSchedule()).rejects.toMatchObject({ code: 'Network' });
    await expect(events.getSession(TRIPLE.a)).rejects.toMatchObject({ code: 'Network' });
    await expect(events.refreshCatalog()).rejects.toMatchObject({ code: 'Network' });
  });
});

describe('wire quirks', () => {
  test('sessions without services still load and filter', async () => {
    const { events, rewrite } = await arrange();
    rewrite.current = (operation, response) => {
      if (operation !== 'ListSessions') {
        return response;
      }
      const body = response.body as { items: { services?: string[] }[] };
      delete body.items[0]?.services;
      return response;
    };
    await events.refreshCatalog();
    const view = await events.catalog();
    expect(view.filter({ services: ['no-such-service'] })).toEqual([]);
    expect(view.filter({})).toHaveLength(120);
  });

  test('personal time that already carries a zone is left as it is', async () => {
    const { events, rewrite } = await arrange();
    await events.createPersonalTime({
      title: 'Lunch',
      description: 'Away',
      startDateTime: '2026-12-02T12:00:00-08:00',
      endDateTime: '2026-12-02T13:00:00-08:00',
    });
    rewrite.current = (operation, response) => {
      if (operation !== 'GetSchedule') {
        return response;
      }
      const body = response.body as {
        schedule: { personalTime: { startDateTime: string; endDateTime: string }[] };
      };
      for (const entry of body.schedule.personalTime) {
        entry.startDateTime = '2026-12-02T12:00:00-08:00';
        entry.endDateTime = '2026-12-02T13:00:00-08:00';
      }
      return response;
    };
    expect((await events.getSchedule()).personalTime[0]?.startDateTime).toBe(
      '2026-12-02T12:00:00-08:00',
    );
  });

  test('an unrecognised S1 error type is an internal error', () => {
    class Odd extends EventsApiError {
      constructor() {
        super('OddError', 'GetSchedule', 'odd');
      }
    }
    expect(codeOf(mapEventsError(new Odd()))).toBe('Internal');
  });

  test('a reserve failure without conflicts carries no conflictsWith, with conflicts it does', async () => {
    const { events } = await arrange();
    const unknown = await events.reserve(['syn-no-such']);
    expect(unknown).toMatchObject({ kind: 'confirmed', result: { successful: [] } });
    if (unknown.kind === 'confirmed') {
      expect(unknown.result.failed[0]).not.toHaveProperty('conflictsWith');
    }
    await events.reserve([TRIPLE.a]);
    const clash = await events.reserve([TRIPLE.b]);
    if (clash.kind === 'confirmed') {
      expect(clash.result.failed[0]?.conflictsWith).toEqual([TRIPLE.a]);
    }
  });

  test('a signed-in attendee with no known expiry gets no expiresAt', async () => {
    const { events, auth } = await arrange();
    auth.expires = false;
    expect(await events.signIn(false)).toEqual({ signedIn: true });
  });
});

describe('toWireInstant', () => {
  test('converts an instant with an offset to UTC without a zone suffix and refuses a bad one', () => {
    expect(toWireInstant('2026-12-02T12:00:00-08:00')).toBe('2026-12-02T20:00:00');
    expect(toWireInstant('2026-12-02T20:00:00Z')).toBe('2026-12-02T20:00:00');
    expect(() => toWireInstant('nope')).toThrow(
      expect.objectContaining({ code: 'LayoverInvalid' }),
    );
  });
});

describe('mapEventsError', () => {
  test('maps every S1 error class to its fixed code', () => {
    const cases: [unknown, string][] = [
      [errorForStatus('GetSchedule', 429), 'RateLimited'],
      [new QuotaExceededError('GetSchedule', 'quota'), 'RateLimited'],
      [errorForStatus('GetSchedule', 401), 'Unauthorized'],
      [errorForStatus('GetSchedule', 403), 'Forbidden'],
      [errorForStatus('GetSchedule', 404), 'NotFound'],
      [new ConflictError('GetSchedule', 'c', 409), 'Conflict'],
      [new BadRequestError('GetSchedule', 'b', 400), 'BadRequest'],
      [new ValidationError('GetSchedule', 'v'), 'Validation'],
      [errorForStatus('GetSchedule', 503), 'Server'],
      [errorForStatus('GetSchedule', 302), 'UnexpectedResponse'],
      [new ResponseTooLargeError('GetSchedule'), 'UnexpectedResponse'],
      [new EventWindowError('GetEvent', 'w'), 'EventWindow'],
      [new NetworkError('GetSchedule'), 'Network'],
      [new TimeoutError('GetSchedule'), 'Network'],
      [new CatalogIncompleteError(1, 'page-limit'), 'Network'],
      [new CacheWriteError(), 'Internal'],
      [new NotSignedInError(), 'NotSignedIn'],
      [new SignInRequiredError(), 'Unauthorized'],
      [new RefreshFailedError(), 'Network'],
      [new OAuthNetworkError(), 'Network'],
      [new OAuthTimeoutError(), 'Network'],
      [new AudienceError(), 'Internal'],
      [new SignInFailedError(), 'Internal'],
    ];
    for (const [error, expected] of cases) {
      const name = (error as Error).name;
      expect([name, codeOf(mapEventsError(error))]).toEqual([name, expected]);
    }
  });

  test('an unrecognised error passes through and no upstream message is kept', () => {
    const other = new Error('boom');
    expect(mapEventsError(other)).toBe(other);
    const mapped = mapEventsError(new ConflictError('GetSchedule', 'secret text', 409));
    expect((mapped as Error).message).toBe('Conflict');
  });
});
