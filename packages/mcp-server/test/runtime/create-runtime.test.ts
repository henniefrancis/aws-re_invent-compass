import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTokenStore } from '@compass/core/auth';
import type { LoopbackServer } from '@compass/core/auth';
import type { HttpRequest } from '@compass/core/passes';
import { READ_ONLY_NOTICE, createRuntime } from '../../src/runtime/create-runtime.js';
import { SIMULATED_LABEL } from '../../src/server/results.js';
import { connect, textOf } from '../support/connect.js';
import { installNetworkGuard } from '../support/network-guard.js';
import type { NetworkGuard } from '../support/network-guard.js';
import { TRIPLE } from '../support/triple.js';
import { fakeIdToken } from '../support/simulated-stack.js';
import { memoryKeyring, testEnvironment } from '../support/runtime-env.js';

let guard: NetworkGuard;
beforeEach(() => {
  guard = installNetworkGuard();
});
afterEach(() => {
  guard.restore();
});

describe('simulated composition', () => {
  test('serves the synthetic catalog and a signed-in attendee with no network and a label on every result', async () => {
    const env = await testEnvironment();
    const runtime = await createRuntime(env.environment, { COMPASS_MODE: 'simulated' });
    expect(runtime.mode).toBe('simulated');
    expect(runtime.version).toBe('1.2.3');
    expect(runtime.cwd).toBe(env.workspace);
    expect(runtime.clock.now().toISOString()).toBe('2026-11-30T02:00:00.000Z');
    const conn = await connect(runtime);
    const signedIn = await conn.call('sign_in');
    expect(textOf(signedIn).startsWith(SIMULATED_LABEL)).toBe(true);
    expect((await conn.call('refresh_catalog')).isError).not.toBe(true);
    const found = await conn.call('find_sessions', { query: `${TRIPLE.codes.a}` });
    expect(textOf(found)).toContain(`${TRIPLE.codes.a}`);
    expect(textOf(found).startsWith(SIMULATED_LABEL)).toBe(true);
    const failed = await conn.call('cancel_reservation', { sessionId: 'syn-none' });
    expect(textOf(failed)).not.toContain(SIMULATED_LABEL);
    await conn.close();
    expect(guard.attempts).toEqual([]);
    expect(env.launched).toEqual([]);
    expect(existsSync(join(env.home, '.local', 'share', 'reinvent-compass', 'simulated'))).toBe(
      true,
    );
  });

  test('the cwd option replaces the environment cwd', async () => {
    const env = await testEnvironment();
    const runtime = await createRuntime(
      env.environment,
      { COMPASS_MODE: 'simulated' },
      { cwd: '/elsewhere' },
    );
    expect(runtime.cwd).toBe('/elsewhere');
  });

  test('the override warning names only the override host', async () => {
    const env = await testEnvironment();
    await createRuntime(env.environment, {
      COMPASS_MODE: 'simulated',
      COMPASS_API_URL: 'https://compass.example.test/api',
      COMPASS_ALLOW_API_OVERRIDE: '1',
    });
    expect(env.stderr.join('')).toContain('compass.example.test');
  });
});

describe('simulated passes and sign-in', () => {
  test('sign-in and sign-out never leave the machine; passes are issued through the in-process service', async () => {
    const env = await testEnvironment();
    const runtime = await createRuntime(env.environment, { COMPASS_MODE: 'simulated' });
    expect(await runtime.events.signIn(true)).toEqual({ signedIn: true });
    expect((await runtime.events.signOut()).signOutUrl).toBe(
      'https://idp.awsevents.com/oidc/logout',
    );
    const conn = await connect(runtime, { elicit: 'accept' });
    await conn.call('refresh_catalog');
    const catalog = await runtime.events.catalog();
    // Two reservable sessions on the same day, in the same venue, at least 30 minutes
    // apart: S4 treats them as neighbours (within 12 hours) and asks the runtime for
    // the walk between them, and the guardrail lets both through.
    const sessions = [...catalog.byId.values()]
      .map((entry) => entry.session)
      .filter((s) => s.isReservable && s.seatAvailability !== 'unavailable' && s.venue);
    const pair = sessions
      .flatMap((a) => sessions.map((b) => [a, b] as const))
      .find(
        ([a, b]) =>
          a.venue === b.venue &&
          a.startsAt?.slice(0, 10) === b.startsAt?.slice(0, 10) &&
          Date.parse(b.startsAt ?? '') >= Date.parse(a.endsAt ?? '') + 30 * 60_000 &&
          Date.parse(b.startsAt ?? '') <= Date.parse(a.endsAt ?? '') + 3 * 3_600_000,
      );
    expect(pair).toBeDefined();
    const ids = (pair ?? []).map((s) => s.sessionId);
    const reserved = await conn.call('reserve_with_guardrails', { sessionIds: ids });
    expect(JSON.stringify(reserved)).toContain('2 of 2');
    const issued = await conn.call('issue_boarding_passes', { sessionIds: ids });
    expect(issued.isError).not.toBe(true);
    expect(await runtime.passes.forgetMe()).toBeDefined();
    await conn.close();
    expect(guard.attempts).toEqual([]);
  });
});

describe('live composition', () => {
  const tokens = () => ({
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    idToken: fakeIdToken(),
    accessTokenExpiresAt: Date.now() + 3_600_000,
  });

  test('read-only live mode refuses every Events write and says so once (task 37)', async () => {
    const store = createTokenStore(memoryKeyring());
    const env = await testEnvironment({ store });
    const runtime = await createRuntime(env.environment, { COMPASS_READ_ONLY: '1' });
    expect(runtime.mode).toBe('live');
    expect(runtime.readOnly).toBe(true);
    await expect(runtime.events.reserve(['x'])).rejects.toMatchObject({ code: 'ReadOnly' });
    expect(env.stderr.join('')).toContain(READ_ONLY_NOTICE);
    expect(guard.attempts).toEqual([]);
    const writable = await createRuntime(env.environment, {});
    expect(writable.readOnly).toBeUndefined();
  });

  test('read-only works in simulated mode too', async () => {
    const env = await testEnvironment();
    const runtime = await createRuntime(env.environment, {
      COMPASS_MODE: 'simulated',
      COMPASS_READ_ONLY: '1',
    });
    expect(runtime.readOnly).toBe(true);
    await expect(runtime.events.cancel('x')).rejects.toMatchObject({ code: 'ReadOnly' });
  });

  test('builds without a network call and reports sign-in from the token store', async () => {
    const store = createTokenStore(memoryKeyring());
    const env = await testEnvironment({ store });
    const runtime = await createRuntime(env.environment, {});
    expect(runtime.mode).toBe('live');
    expect(await runtime.events.isSignedIn()).toBe(false);
    expect(guard.attempts).toEqual([]);
  });

  test('sign-in opens the browser through the injected launcher, stores tokens and reports the expiry', async () => {
    const store = createTokenStore(memoryKeyring());
    let state = '';
    const bind = (expectedState: string): Promise<LoopbackServer> => {
      state = expectedState;
      return Promise.resolve({
        port: 8484,
        awaitCallback: () => Promise.resolve({ code: 'one-time-code', state }),
        close: () => undefined,
      });
    };
    const oauthFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'access-token-value',
            refresh_token: 'refresh-token-value',
            id_token: fakeIdToken(),
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 },
        ),
      );
    const env = await testEnvironment({ store, bind, oauthFetch, platform: 'win32' });
    const runtime = await createRuntime(env.environment, {});
    const result = await runtime.events.signIn(false);
    expect(result.signedIn).toBe(true);
    expect(result.expiresAt).toBeDefined();
    expect(await runtime.events.isSignedIn()).toBe(true);
    expect(env.launched).toHaveLength(1);
    expect(env.launched[0]?.file).toBe('rundll32');
    expect(env.launched[0]?.args[1]).toMatch(/^https:\/\/oauth\.awsevents\.com\//);
    expect(env.stderr.join('')).not.toContain('access-token-value');
  });

  test('sign-out revokes through the injected fetch and clears the store', async () => {
    const store = createTokenStore(memoryKeyring());
    store.save(tokens());
    const urls: string[] = [];
    const oauthFetch = (url: string) => {
      urls.push(url);
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    const env = await testEnvironment({ store, oauthFetch });
    const runtime = await createRuntime(env.environment, {});
    expect(await runtime.events.isSignedIn()).toBe(true);
    expect((await runtime.events.signOut()).signOutUrl).toBe(
      'https://idp.awsevents.com/oidc/logout',
    );
    expect(urls).toEqual(['https://oauth.awsevents.com/oauth2/revoke']);
    expect(await runtime.events.isSignedIn()).toBe(false);
  });

  test('the ID token goes only to the Compass API host, through the injected pass transport', async () => {
    const store = createTokenStore(memoryKeyring());
    store.save(tokens());
    const requests: HttpRequest[] = [];
    const env = await testEnvironment({
      store,
      compassTransport: {
        request: (request) => {
          requests.push(request);
          return Promise.resolve({ status: 404, headers: {}, body: '' });
        },
      },
      fetch: () => Promise.reject(new Error('the Events API must not be called')),
    });
    const runtime = await createRuntime(env.environment, {});
    await runtime.passes.forgetMe();
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]?.url ?? '').host).toBe('compass.invalid');
    expect(JSON.stringify(requests[0]?.headers)).toContain('Bearer');
    await expect(runtime.events.getSchedule()).rejects.toBeDefined();
  });

  test('the Events API gets the access token and never the ID token', async () => {
    const store = createTokenStore(memoryKeyring());
    const held = tokens();
    store.save(held);
    const seen: { url: string; authorization: string }[] = [];
    const env = await testEnvironment({
      store,
      fetch: (url, init) => {
        seen.push({ url, authorization: init.headers.authorization ?? '' });
        return Promise.resolve(
          new Response(
            JSON.stringify({ schedule: { reserved: [], favorites: [], personalTime: [] } }),
            {
              status: 200,
            },
          ),
        );
      },
    });
    const runtime = await createRuntime(env.environment, {});
    await runtime.events.getSchedule();
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0]?.url ?? '').host).toBe('api.awsevents.com');
    expect(seen[0]?.authorization).toBe(`Bearer ${held.accessToken}`);
    expect(JSON.stringify(seen)).not.toContain(held.idToken);
  });

  test('when the browser cannot be launched the sign-in address is shown on stderr', async () => {
    const store = createTokenStore(memoryKeyring());
    const bind = (state: string): Promise<LoopbackServer> =>
      Promise.resolve({
        port: 8484,
        awaitCallback: () => Promise.resolve({ code: 'c', state }),
        close: () => undefined,
      });
    const oauthFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'a',
            refresh_token: 'r',
            id_token: fakeIdToken(),
            expires_in: 60,
            token_type: 'Bearer',
          }),
          { status: 200 },
        ),
      );
    const env = await testEnvironment({
      store,
      bind,
      oauthFetch,
      execFile: (_file, _args, callback) => callback(new Error('no launcher')),
    });
    const runtime = await createRuntime(env.environment, {});
    await runtime.events.signIn(false);
    expect(env.stderr.join('')).toContain('Open this address in your browser');
  });
});
