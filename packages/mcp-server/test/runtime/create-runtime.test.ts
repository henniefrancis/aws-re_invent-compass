import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTokenStore } from '@compass/core/auth';
import { createGitHubTokenStore } from '@compass/core/github';
import type { GitHubFetch } from '@compass/core/github';
import type { LoopbackServer } from '@compass/core/auth';
import type { HttpRequest } from '@compass/core/passes';
import {
  GITHUB_OVERRIDE_NOTICE,
  WRITES_ON_NOTICE,
  createRuntime,
} from '../../src/runtime/create-runtime.js';
import { COMPASS_API_BASE_URL } from '../../src/config/compass-api.js';
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

/** An SVG in the shape the QR library makes. */
const QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><path d="M4 4.5h1"/></svg>';

/** An expiry ten minutes after the runtime clock, as a hand-off would have. */
function soon(runtime: { clock: { now(): Date } }): string {
  return new Date(runtime.clock.now().getTime() + 600_000).toISOString();
}

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
    const issued = await conn.call('issue_all_boarding_passes');
    expect(issued.isError).not.toBe(true);
    expect(await runtime.passes.forgetMe()).toBeDefined();
    await conn.close();
    expect(guard.attempts).toEqual([]);
  });

  // Feature: compass-power, task 48: the QR page is wired in, written to the temp folder, opened
  // without a shell and removed by forget_me and on exit.
  test('send_to_phone with qr opens a private page from the temp folder; forget_me and exit remove it', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'compass-qr-runtime-'));
    const exits: (() => void)[] = [];
    const env = await testEnvironment({ tempRoot, onExit: (fn) => exits.push(fn) });
    const runtime = await createRuntime(env.environment, { COMPASS_MODE: 'simulated' });
    expect(runtime.qrPage).toBeDefined();
    const conn = await connect(runtime, { elicit: 'accept' });
    await conn.call('refresh_catalog');
    const catalog = await runtime.events.catalog();
    const session = [...catalog.byId.values()]
      .map((entry) => entry.session)
      .find((s) => s.isReservable && s.seatAvailability !== 'unavailable' && s.venue);
    const id = session?.sessionId ?? '';
    await conn.call('reserve_with_guardrails', { sessionIds: [id] });
    await conn.call('issue_boarding_pass', { sessionId: id });

    const phone = await conn.call('send_to_phone', { show: 'qr' });
    expect(phone.isError).not.toBe(true);
    expect(textOf(phone)).toContain('Scan the QR code in your browser');
    expect(textOf(phone)).not.toContain('/board#h=');
    const launch = env.launched.at(-1);
    expect(launch?.file).toBe('xdg-open');
    const folders = await readdir(tempRoot);
    expect(folders).toHaveLength(1);
    expect(folders[0]?.startsWith('compass-qr-')).toBe(true);
    const page = join(tempRoot, folders[0] ?? '', 'board-qr.html');
    expect(launch?.args).toEqual([pathToFileURL(page).href]);
    expect(await readFile(page, 'utf8')).toContain('<svg');
    expect(env.stderr.join('')).not.toContain('board');

    await conn.call('forget_me', { confirm: true });
    expect(await readdir(tempRoot)).toEqual([]);

    // A page shown again is removed when the process exits.
    await runtime.qrPage?.show({ svg: QR_SVG, expiresAt: soon(runtime) });
    expect(await readdir(tempRoot)).toHaveLength(1);
    expect(exits).toHaveLength(1);
    exits[0]?.();
    expect(await readdir(tempRoot)).toEqual([]);
    await conn.close();
    await rm(tempRoot, { recursive: true, force: true });
    expect(guard.attempts).toEqual([]);
  });

  test('without an exit seam the page registers one exit and one listener per stop signal, once', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'compass-qr-exit-'));
    // A page folder another server is still using: the sweep reads it and keeps it (too new).
    await mkdir(join(tempRoot, 'compass-qr-leftover'));
    const env = await testEnvironment({ tempRoot });
    const runtime = await createRuntime(env.environment, { COMPASS_MODE: 'simulated' });
    const events = ['exit', 'SIGTERM', 'SIGINT', 'SIGHUP'] as const;
    const before = events.map((event) => process.listeners(event).length);
    await runtime.qrPage?.show({ svg: QR_SVG, expiresAt: soon(runtime) });
    await runtime.qrPage?.show({ svg: QR_SVG, expiresAt: soon(runtime) });
    for (const [index, event] of events.entries()) {
      const added = process.listeners(event).slice(before[index]);
      expect(added).toHaveLength(1);
      // Leave the test worker as it was.
      for (const listener of added) process.removeListener(event, listener);
    }
    await runtime.qrPage?.clear();
    expect(await readdir(tempRoot)).toEqual(['compass-qr-leftover']);
    await rm(tempRoot, { recursive: true, force: true });
  });
});

describe('live composition', () => {
  const tokens = () => ({
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    idToken: fakeIdToken(),
    accessTokenExpiresAt: Date.now() + 3_600_000,
  });

  test('live mode is read-only by default: every Events write is refused (task 37)', async () => {
    const store = createTokenStore(memoryKeyring());
    const env = await testEnvironment({ store });
    const runtime = await createRuntime(env.environment, {});
    expect(runtime.mode).toBe('live');
    expect(runtime.readOnly).toBe(true);
    await expect(runtime.events.reserve(['x'])).rejects.toMatchObject({ code: 'ReadOnly' });
    await expect(runtime.events.cancel('x')).rejects.toMatchObject({ code: 'ReadOnly' });
    expect(env.stderr.join('')).not.toContain(WRITES_ON_NOTICE);
    expect(guard.attempts).toEqual([]);
  });

  test('live mode has a GitHub port that reads through the core module, in this thread or the worker (task 45)', async () => {
    const githubStore = createGitHubTokenStore({ keyring: memoryKeyring() });
    githubStore.save({ accessToken: 'ghu_test' });
    const requested: string[] = [];
    const githubFetch: GitHubFetch = (url) => {
      requested.push(url);
      return Promise.resolve({
        status: 404,
        headers: { get: () => null },
        body: null,
        text: () => Promise.resolve('{}'),
      });
    };
    const repo = { id: 1, fullName: 'me/api', owner: 'me', fork: false, archived: false };
    const env = await testEnvironment({ store: createTokenStore(memoryKeyring()) });
    const config = {
      COMPASS_GITHUB_CLIENT_ID: 'Iv23liTest',
      COMPASS_GITHUB_APP_SLUG: 'compass-test',
    };
    const runtime = await createRuntime({ ...env.environment, githubStore, githubFetch }, config);
    expect(runtime.github?.status()).toEqual({ state: 'connected' });
    expect(runtime.github?.installUrl).toBe(
      'https://github.com/apps/compass-test/installations/new',
    );
    // No bundled worker means no budget, so nothing is read at all (security review M1).
    await expect(runtime.github?.scanRepository(repo)).rejects.toMatchObject({ code: 'Network' });
    expect(requested).toEqual([]);
    expect(env.stderr.join('')).toContain(GITHUB_OVERRIDE_NOTICE);
    const workerEnv = {
      ...env.environment,
      githubStore,
      githubFetch,
      githubWorkerPath: join(env.home, 'missing-worker.js'),
    };
    const withWorker = await createRuntime(workerEnv, config);
    await expect(withWorker.github?.scanRepository(repo)).rejects.toMatchObject({
      code: 'Network',
    });
    const simulated = await createRuntime(env.environment, { COMPASS_MODE: 'simulated' });
    expect(simulated.github).toBeUndefined();
    const plain = await testEnvironment({ store: createTokenStore(memoryKeyring()), githubStore });
    const built = await createRuntime(plain.environment, {});
    expect(built.github?.status()).toEqual({ state: 'connected' });
    expect(built.github?.installUrl).toBe(
      'https://github.com/apps/re-invent-compass-unofficial/installations/new',
    );
    const unset = await createRuntime(plain.environment, { COMPASS_GITHUB_CLIENT_ID: '' });
    expect(unset.github?.status()).toEqual({ state: 'notConfigured' });
    expect(plain.stderr.join('')).not.toContain(GITHUB_OVERRIDE_NOTICE);
    expect(guard.attempts).toEqual([]);
  });

  test('COMPASS_ALLOW_WRITES=1 turns writes on in live mode and says so once', async () => {
    const store = createTokenStore(memoryKeyring());
    const env = await testEnvironment({ store });
    const runtime = await createRuntime(env.environment, { COMPASS_ALLOW_WRITES: '1' });
    expect(runtime.readOnly).toBeUndefined();
    expect(env.stderr.join('')).toContain(WRITES_ON_NOTICE);
  });

  test('simulated mode keeps its made-up bookings: never read-only, no notice', async () => {
    const env = await testEnvironment();
    const runtime = await createRuntime(env.environment, { COMPASS_MODE: 'simulated' });
    expect(runtime.readOnly).toBeUndefined();
    expect(env.stderr.join('')).not.toContain(WRITES_ON_NOTICE);
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

  test('a held sign-in with an expired access token is renewed before sign_in reports it', async () => {
    const store = createTokenStore(memoryKeyring());
    store.save({ ...tokens(), accessTokenExpiresAt: Date.now() - 86_400_000 });
    const urls: string[] = [];
    const oauthFetch = (url: string) => {
      urls.push(url);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'renewed-access-token',
            id_token: fakeIdToken(),
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 },
        ),
      );
    };
    const env = await testEnvironment({ store, oauthFetch });
    const runtime = await createRuntime(env.environment, {});
    const result = await runtime.events.signIn(false);
    expect(result.signedIn).toBe(true);
    expect(Date.parse(String(result.expiresAt))).toBeGreaterThan(Date.now());
    expect(urls).toEqual(['https://oauth.awsevents.com/oauth2/token']);
    expect(env.launched).toHaveLength(0);
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
    expect(new URL(requests[0]?.url ?? '').host).toBe(new URL(COMPASS_API_BASE_URL).host);
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
