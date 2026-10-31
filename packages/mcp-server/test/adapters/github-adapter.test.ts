import { describe, expect, test } from 'vitest';
import {
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  GitHubRequestError,
} from '@compass/core/github';
import type {
  GitHubFetch,
  GitHubFetchInit,
  GitHubResponseLike,
  GitHubTokenStore,
  GitHubTokens,
} from '@compass/core/github';
import { createGitHubAdapter, toCompassError } from '../../src/adapters/github-adapter.js';
import { CompassError } from '../../src/ports/errors.js';
import { abortableSleep } from '../../src/runtime/sleep.js';
import { repoScan } from '../support/fake-github.js';

const CONFIG = {
  clientId: 'Iv23liTest',
  installUrl: 'https://github.com/apps/compass-test/installations/new',
};
const DEVICE = {
  device_code: 'd'.repeat(40),
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};
const TOKEN = { access_token: 'ghu_secret', token_type: 'bearer', scope: '' };

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): GitHubResponseLike {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (name) => lower.get(name.toLowerCase()) ?? null },
    body: null,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

class MemoryStore implements GitHubTokenStore {
  readonly kind = 'memory' as const;
  tokens: GitHubTokens | undefined;
  cleared = 0;
  load(): GitHubTokens | undefined {
    return this.tokens;
  }
  save(tokens: GitHubTokens): 'memory' {
    this.tokens = tokens;
    return 'memory';
  }
  clear(): void {
    this.tokens = undefined;
    this.cleared += 1;
  }
}

function arrange(
  answer: (url: string, init: GitHubFetchInit) => GitHubResponseLike,
  options: {
    config?: typeof CONFIG | undefined;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
) {
  const calls: string[] = [];
  const fetch: GitHubFetch = (url, init) => {
    calls.push(url);
    return Promise.resolve(answer(url, init));
  };
  const store = new MemoryStore();
  const opened: string[] = [];
  const scans: { fullName: string; token: string }[] = [];
  let scanOutcome: () => Promise<ReturnType<typeof repoScan>> = () => Promise.resolve(repoScan());
  const adapter = createGitHubAdapter({
    config: 'config' in options ? options.config : CONFIG,
    store,
    fetch,
    openBrowser: (url) => {
      opened.push(url);
    },
    now: () => Date.parse('2026-10-20T10:00:00.000Z'),
    sleep: options.sleep ?? (() => Promise.resolve()),
    scanRepository: (fullName, token) => {
      scans.push({ fullName, token });
      return scanOutcome();
    },
  });
  return {
    adapter,
    store,
    calls,
    opened,
    scans,
    setScan: (outcome: () => Promise<ReturnType<typeof repoScan>>) => {
      scanOutcome = outcome;
    },
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

describe('the GitHub adapter', () => {
  test('without a GitHub App it sends nothing and is not configured', async () => {
    const { adapter, calls } = arrange(() => json(500, {}), { config: undefined });
    expect(adapter.installUrl).toBeUndefined();
    expect(adapter.status()).toEqual({ state: 'notConfigured' });
    expect(await adapter.connect()).toEqual({ state: 'notConfigured' });
    await expect(adapter.listRepositories()).rejects.toEqual(
      new CompassError('GitHubNotConnected'),
    );
    await expect(
      adapter.scanRepository({
        id: 1,
        fullName: 'me/a',
        owner: 'me',
        fork: false,
        archived: false,
      }),
    ).rejects.toEqual(new CompassError('GitHubNotConnected'));
    expect(calls).toEqual([]);
  });

  test('connect shows the code, opens the page, polls in the background and saves the token', async () => {
    let polls = 0;
    const { adapter, store, opened, calls } = arrange((url) => {
      if (url.endsWith('/login/device/code')) return json(200, DEVICE);
      polls += 1;
      return polls === 1 ? json(200, { error: 'authorization_pending' }) : json(200, TOKEN);
    });
    expect(adapter.status()).toEqual({ state: 'disconnected' });
    const waiting = await adapter.connect();
    expect(waiting).toEqual({
      state: 'waiting',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresAt: '2026-10-20T10:15:00.000Z',
    });
    expect(opened).toEqual(['https://github.com/login/device']);
    expect(await adapter.connect()).toEqual(waiting);
    await settle();
    expect(adapter.status()).toEqual({ state: 'connected' });
    expect(store.tokens?.accessToken).toBe('ghu_secret');
    expect(await adapter.connect()).toEqual({ state: 'connected' });
    expect(calls.filter((url) => url.endsWith('/login/device/code'))).toHaveLength(1);
  });

  test.each([
    ['access_denied', 'denied'],
    ['expired_token', 'expired'],
    ['incorrect_device_code', 'error'],
  ] as const)('a poll ending in %s fails as %s and can start again', async (error, reason) => {
    const { adapter } = arrange((url) =>
      url.endsWith('/login/device/code') ? json(200, DEVICE) : json(200, { error }),
    );
    await adapter.connect();
    await settle();
    expect(adapter.status()).toEqual({ state: 'failed', reason });
    expect((await adapter.connect()).state).toBe('waiting');
  });

  test('two connects at once share one device code (security review L2)', async () => {
    const { adapter, calls } = arrange(
      (url) =>
        url.endsWith('/login/device/code')
          ? json(200, DEVICE)
          : json(200, { error: 'authorization_pending' }),
      { sleep: () => new Promise<void>(() => undefined) },
    );
    const [first, second] = await Promise.all([adapter.connect(), adapter.connect()]);
    expect(second).toEqual(first);
    expect(calls.filter((url) => url.endsWith('/login/device/code'))).toHaveLength(1);
  });

  test('a device code request that fails is reported as a failed sign-in', async () => {
    const { adapter } = arrange(() => json(500, {}));
    expect(await adapter.connect()).toEqual({ state: 'failed', reason: 'error' });
  });

  test('a wait that throws ends as a failed sign-in', async () => {
    const { adapter } = arrange(
      (url) =>
        url.endsWith('/login/device/code')
          ? json(200, DEVICE)
          : json(200, { error: 'authorization_pending' }),
      { sleep: () => Promise.reject(new Error('timer broke')) },
    );
    await adapter.connect();
    await settle();
    expect(adapter.status()).toEqual({ state: 'failed', reason: 'error' });
  });

  test('disconnect stops a waiting sign-in, ignores its late result and clears the tokens', async () => {
    let release: () => void = () => undefined;
    const { adapter, store } = arrange(
      (url) => (url.endsWith('/login/device/code') ? json(200, DEVICE) : json(200, TOKEN)),
      {
        sleep: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    );
    await adapter.connect();
    adapter.disconnect();
    release();
    await settle();
    expect(adapter.status()).toEqual({ state: 'disconnected' });
    expect(store.tokens).toBeUndefined();
    expect(store.cleared).toBe(1);
  });

  test('lists repositories as plain references', async () => {
    const { adapter, store } = arrange((url) =>
      url.includes('/user/installations?')
        ? json(200, { total_count: 1, installations: [{ id: 3 }] })
        : json(200, {
            total_count: 1,
            repositories: [
              {
                id: 7,
                full_name: 'me/api',
                owner: { login: 'me', type: 'User' },
                private: true,
                fork: false,
                archived: true,
                size: 12,
              },
            ],
          }),
    );
    store.tokens = { accessToken: 'ghu_secret' };
    expect(await adapter.listRepositories()).toEqual([
      { id: 7, fullName: 'me/api', owner: 'me', fork: false, archived: true },
    ]);
  });

  test.each([
    [json(401, {}), 'GitHubNotConnected'],
    [
      json(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792490460' }),
      'RateLimited',
    ],
    [json(500, {}), 'Network'],
  ] as const)('a failing listing becomes a fixed error', async (response, code) => {
    const { adapter, store } = arrange(() => response);
    store.tokens = { accessToken: 'ghu_secret' };
    const error = await adapter.listRepositories().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CompassError);
    expect((error as CompassError).code).toBe(code);
    expect(String((error as Error).message)).not.toContain('ghu_');
  });

  test('scans a repository with the current token and maps its errors', async () => {
    const { adapter, store, scans, setScan } = arrange(() => json(500, {}));
    const repo = { id: 7, fullName: 'me/api', owner: 'me', fork: false, archived: false };
    await expect(adapter.scanRepository(repo)).rejects.toEqual(
      new CompassError('GitHubNotConnected'),
    );
    store.tokens = { accessToken: 'ghu_secret' };
    expect((await adapter.scanRepository(repo)).technologies).toHaveLength(1);
    expect(scans).toEqual([{ fullName: 'me/api', token: 'ghu_secret' }]);
    setScan(() => Promise.reject(new GitHubNotConnectedError()));
    await expect(adapter.scanRepository(repo)).rejects.toEqual(
      new CompassError('GitHubNotConnected'),
    );
    setScan(() => Promise.reject(new Error('worker died')));
    await expect(adapter.scanRepository(repo)).rejects.toEqual(new CompassError('Network'));
  });
});

describe('mapping GitHub errors', () => {
  test('a CompassError passes through, a rate limit carries a wait, anything else is a network error', () => {
    const passed = new CompassError('ReadOnly');
    expect(toCompassError(passed)).toBe(passed);
    expect(toCompassError(new GitHubRateLimitedError(10_500), () => 0).details).toEqual({
      retryAfterSeconds: 11,
    });
    expect(toCompassError(new GitHubRateLimitedError(0), () => 5000).details).toEqual({
      retryAfterSeconds: 1,
    });
    expect(toCompassError(new GitHubRateLimitedError(undefined)).details).toEqual({});
    expect(toCompassError(new GitHubRequestError(502)).code).toBe('Network');
  });
});

describe('the abortable sleep', () => {
  test('waits, ends early on abort, and ends at once when already aborted', async () => {
    await abortableSleep(1);
    const controller = new AbortController();
    const waiting = abortableSleep(60_000, controller.signal);
    controller.abort();
    await waiting;
    await abortableSleep(60_000, controller.signal);
  });
});
