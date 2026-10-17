import { afterEach, describe, expect, test, vi } from 'vitest';
import { defaultEventsFetch } from '../../src/adapters/default-fetch.js';
import { preWriteGuardrail } from '../../src/hooks/pre-write-guardrail.js';
import { createBrowserOpener } from '../../src/runtime/browser-opener.js';
import type { ExecFileLike } from '../../src/runtime/browser-opener.js';
import { createRuntime } from '../../src/runtime/create-runtime.js';
import { createHookDeps } from '../../src/runtime/hook-deps.js';
import {
  findPackageRoot,
  findResource,
  SAMPLE_REPO_LOCATION,
  VENUES_LOCATION,
} from '../../src/runtime/resources.js';
import { realBind } from '../../src/runtime/real-bind.js';
import { sleep } from '../../src/runtime/sleep.js';
import { expiryOf } from '../../src/runtime/token-expiry.js';
import { simulatedIdToken } from '../../src/simulated/simulated-id-token.js';
import { connect } from '../support/connect.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { testEnvironment } from '../support/runtime-env.js';
import { TRIPLE } from '../support/triple.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser opener', () => {
  function arrange(platform: string, exec?: ExecFileLike) {
    const lines: string[] = [];
    const launched: { file: string; args: string[] }[] = [];
    const open = createBrowserOpener({
      platform,
      execFile:
        exec ??
        ((file, args, callback) => {
          launched.push({ file, args });
          callback(null);
        }),
      notify: (line) => lines.push(line),
    });
    return { open, lines, launched };
  }

  test('uses the platform command with the address as one argument', () => {
    const url = 'https://oauth.awsevents.com/oauth2/authorize?a=1&b=2';
    for (const [platform, file] of [
      ['win32', 'rundll32'],
      ['darwin', 'open'],
      ['linux', 'xdg-open'],
    ] as const) {
      const { open, launched, lines } = arrange(platform);
      open(url);
      expect(launched).toHaveLength(1);
      expect(launched[0]?.file).toBe(file);
      expect(launched[0]?.args.at(-1)).toBe(url);
      expect(lines).toEqual([]);
    }
  });

  test('a non-https address is never launched, only shown', () => {
    const { open, launched, lines } = arrange('linux');
    open('http://example.test/x');
    open('file:///etc/passwd');
    expect(launched).toEqual([]);
    expect(lines).toHaveLength(2);
  });

  test('a failed or throwing launcher falls back to showing the address', () => {
    const failing = arrange('linux', (_file, _args, callback) => callback(new Error('no browser')));
    failing.open('https://oauth.awsevents.com/x');
    expect(failing.lines).toEqual([
      'Open this address in your browser to finish signing in: https://oauth.awsevents.com/x',
    ]);
    const throwing = arrange('linux', () => {
      throw new Error('no launcher');
    });
    throwing.open('https://oauth.awsevents.com/y');
    expect(throwing.lines[0]).toContain('https://oauth.awsevents.com/y');
  });
});

describe('resources', () => {
  test('prefers the bundled copy and falls back to the repository copy', async () => {
    const base = new URL('file:///pkg/');
    const bundled = await findResource(base, VENUES_LOCATION, () => Promise.resolve(true));
    expect(bundled.href).toBe('file:///pkg/dist/data/venues.json');
    const repo = await findResource(base, SAMPLE_REPO_LOCATION, (url) =>
      Promise.resolve(url.href.includes('fixtures')),
    );
    expect(repo.href).toBe('file:///fixtures/sample-repo');
  });

  test('a missing resource is an internal error', async () => {
    await expect(
      findResource(new URL('file:///pkg/'), VENUES_LOCATION, () => Promise.resolve(false)),
    ).rejects.toMatchObject({ code: 'Internal' });
  });
});

describe('sleep, token expiry and the real loopback bind', () => {
  test('sleep resolves after the delay', async () => {
    vi.useFakeTimers();
    let done = false;
    const waiting = sleep(1000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
    vi.useRealTimers();
  });

  test('expiryOf reports the held expiry or nothing', () => {
    expect(expiryOf({ load: () => undefined })).toBeUndefined();
    expect(
      expiryOf({
        load: () => ({
          accessToken: 'a',
          refreshToken: 'r',
          idToken: 'i',
          accessTokenExpiresAt: Date.parse('2026-11-30T00:00:00Z'),
        }),
      }),
    ).toBe('2026-11-30T00:00:00.000Z');
  });

  test('realBind binds a loopback port and can be closed', async () => {
    const server = await realBind('state-value', 1000);
    expect(server.port).toBeGreaterThanOrEqual(8484);
    expect(server.port).toBeLessThanOrEqual(8489);
    server.close();
  });
});

describe('the package root', () => {
  test('is the nearest folder with a package.json above the module, or the module folder when there is none', async () => {
    const has =
      (...folders: string[]) =>
      (url: URL) =>
        Promise.resolve(folders.some((f) => url.href === `file://${f}package.json`));
    expect((await findPackageRoot('file:///pkg/dist/cli/main.js', has('/pkg/'))).href).toBe(
      'file:///pkg/',
    );
    expect(
      (await findPackageRoot('file:///pkg/dist/cli/main.js', has('/pkg/dist/', '/pkg/'))).href,
    ).toBe('file:///pkg/dist/');
    expect((await findPackageRoot('file:///pkg/dist/cli/main.js', has())).href).toBe(
      'file:///pkg/dist/cli/',
    );
  });
});

describe('small pieces', () => {
  test('the default Events fetch passes the request straight to the global fetch', async () => {
    const calls: unknown[][] = [];
    vi.stubGlobal('fetch', (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const init = {
      method: 'GET',
      headers: {},
      redirect: 'error' as const,
      signal: new AbortController().signal,
    };
    const response = await defaultEventsFetch('https://api.awsevents.com/v1/events', init);
    expect(response.status).toBe(200);
    expect(calls).toEqual([['https://api.awsevents.com/v1/events', init]]);
  });

  test('the simulated ID token is jwt shaped, unsigned and marked as an ID token', () => {
    const [header, payload, signature] = simulatedIdToken().split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({ alg: 'none' });
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())).toMatchObject({
      token_use: 'id',
    });
    expect(signature).toBe('c2ln');
  });
});

describe('hook dependencies', () => {
  test('simulated: blocks a clash from the snapshot and the cached catalog with no network', async () => {
    const env = await testEnvironment();
    const simulatedEnv = { COMPASS_MODE: 'simulated' };
    const runtime = await createRuntime(env.environment, simulatedEnv);
    const conn = await connect(runtime);
    await conn.call('refresh_catalog');
    await conn.call('reserve_with_guardrails', { sessionIds: [TRIPLE.a] });
    await conn.close();

    const deps = await createHookDeps(env.environment, simulatedEnv);
    const input = JSON.stringify({
      tool_name: 'mcp_power-reinvent-compass-compass_reserve_with_guardrails',
      tool_input: { sessionIds: [TRIPLE.b] },
    });
    const decision = await preWriteGuardrail(input, deps);
    expect(decision.exitCode).toBe(2);
    expect(decision.stderr).toContain('Compass blocks this booking');
  });

  test('a rule check with no snapshot cannot read the event window and fails closed', async () => {
    const env = await testEnvironment();
    const deps = await createHookDeps(env.environment, { COMPASS_MODE: 'simulated' });
    const catalog = syntheticCatalogView();
    const session = catalog.byId.get(TRIPLE.a)?.session;
    if (session === undefined) {
      throw new Error('the pinned session is missing');
    }
    expect((await deps.rules.checkReservation(session, [], catalog)).decision).toBe('block');
  });

  test('live: a real clock, and no cached catalog is reported as missing', async () => {
    const env = await testEnvironment();
    const deps = await createHookDeps(env.environment, {});
    expect(Math.abs(deps.clock.now().getTime() - Date.now())).toBeLessThan(5000);
    await expect(deps.catalog()).rejects.toMatchObject({ code: 'CatalogMissing' });
    expect(await deps.snapshot.read()).toBeUndefined();
  });
});

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOptionalResource, SCAN_WORKER_LOCATION } from '../../src/runtime/resources.js';
import { repoRoot } from '../support/fake-catalog.js';
import { textOf } from '../support/connect.js';

describe('the scan worker in the runtime', () => {
  test('an optional resource is found when it exists and is undefined when it does not', async () => {
    const base = new URL('file:///pkg/');
    expect(
      (await findOptionalResource(base, SCAN_WORKER_LOCATION, () => Promise.resolve(true)))?.href,
    ).toBe('file:///pkg/dist/scan-worker.js');
    expect(
      await findOptionalResource(base, SCAN_WORKER_LOCATION, () => Promise.resolve(false)),
    ).toBeUndefined();
  });

  test('with a worker path the scan tool runs the scan in a worker thread, in both runtimes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'compass-scanworker-'));
    try {
      const scanWorkerPath = join(dir, 'scan-worker.mjs');
      await build({
        entryPoints: [join(repoRoot(), 'packages', 'core', 'src', 'scanner', 'scan-worker.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: scanWorkerPath,
        logLevel: 'silent',
      });
      for (const env of [{ COMPASS_MODE: 'simulated' }, {}]) {
        const t = await testEnvironment({ scanWorkerPath });
        const runtime = await createRuntime(t.environment, env);
        expect(runtime.scanRunner).toBeDefined();
        const conn = await connect(runtime);
        const result = await conn.call('scan_repo', {
          path: join(repoRoot(), 'fixtures', 'sample-repo'),
        });
        expect(textOf(result)).toContain('Amazon SNS');
        const missing = await conn.call('scan_repo', { path: join(dir, 'missing') });
        expect(textOf(missing)).toBe('That folder could not be found.');
        await conn.close();
      }
      const plain = await createRuntime((await testEnvironment()).environment, {
        COMPASS_MODE: 'simulated',
      });
      expect(plain.scanRunner).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
