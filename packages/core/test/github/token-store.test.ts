import { describe, expect, test, vi } from 'vitest';

// The real keyring module must never be exercised by tests: it is replaced for the whole file
// by an in-memory fake, so even the default-keyring path stays off the OS keychain.
const mockStore = vi.hoisted(() => ({ secrets: new Map<string, number[]>() }));
vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    constructor(
      private readonly service: string,
      private readonly account: string,
    ) {}
    setSecret(secret: Uint8Array): void {
      mockStore.secrets.set(`${this.service}/${this.account}`, [...secret]);
    }
    getSecret(): number[] | null {
      return mockStore.secrets.get(`${this.service}/${this.account}`) ?? null;
    }
    deleteCredential(): boolean {
      return mockStore.secrets.delete(`${this.service}/${this.account}`);
    }
  },
}));

import { createRedactingLogger } from '../../src/api/redacting-logger.js';
import type { KeyringEntryLike, KeyringLike } from '../../src/auth/token-store.js';
import { GitHubNetworkError, GitHubNotConnectedError } from '../../src/github/errors.js';
import {
  GITHUB_KEYCHAIN_ACCOUNTS,
  GITHUB_KEYCHAIN_SERVICE,
  GITHUB_REFRESH_WINDOW_SECONDS,
  createGitHubTokenStore,
  getAccessToken,
  registerGitHubSecrets,
  type GitHubTokenStore,
} from '../../src/github/token-store.js';
import type { GitHubFetch } from '../../src/github/http.js';
import { SECRET_ACCESS, SECRET_REFRESH, errorText, fakeFetch, jsonResponse } from './support.js';

interface FakeKeyring extends KeyringLike {
  secrets: Map<string, string>;
  constructed: { service: string; account: string; options: unknown }[];
  calls: string[];
  failOn: Set<string>;
}

/** A fake keyring. failOn holds "<op>:<account>" or "<op>" keys that should throw. */
function fakeKeyring(options: { constructorThrows?: boolean } = {}): FakeKeyring {
  const fake: FakeKeyring = {
    secrets: new Map(),
    constructed: [],
    calls: [],
    failOn: new Set(),
    Entry: class implements KeyringEntryLike {
      private readonly account: string;
      constructor(service: string, account: string, opts?: unknown) {
        if (options.constructorThrows === true) {
          throw new Error('no secret service');
        }
        this.account = account;
        fake.constructed.push({ service, account, options: opts });
      }
      private guard(op: string): void {
        fake.calls.push(`${op}:${this.account}`);
        if (fake.failOn.has(op) || fake.failOn.has(`${op}:${this.account}`)) {
          throw new Error(`${op} failed`);
        }
      }
      setSecret(secret: Uint8Array): void {
        this.guard('set');
        fake.secrets.set(this.account, Buffer.from(secret).toString('utf8'));
      }
      getSecret(): number[] | null {
        this.guard('get');
        const value = fake.secrets.get(this.account);
        return value === undefined ? null : [...Buffer.from(value, 'utf8')];
      }
      deleteCredential(): boolean {
        this.guard('delete');
        return fake.secrets.delete(this.account);
      }
    },
  };
  return fake;
}

const FULL = {
  accessToken: SECRET_ACCESS,
  refreshToken: SECRET_REFRESH,
  accessTokenExpiresAt: 1_700_000_000_000,
};

describe('createGitHubTokenStore with a keychain', () => {
  test('builds the two entries on the secret service under reinvent-compass', () => {
    const keyring = fakeKeyring();
    createGitHubTokenStore({ keyring });
    expect(keyring.constructed).toEqual([
      {
        service: 'reinvent-compass',
        account: 'github-access',
        options: { linux: { store: 'secret-service' } },
      },
      {
        service: 'reinvent-compass',
        account: 'github-refresh',
        options: { linux: { store: 'secret-service' } },
      },
    ]);
    expect(GITHUB_KEYCHAIN_SERVICE).toBe('reinvent-compass');
    expect(GITHUB_KEYCHAIN_ACCOUNTS).toEqual({
      access: 'github-access',
      refresh: 'github-refresh',
    });
  });

  test('stores the access token with its expiry and the refresh token, and loads them back', () => {
    const keyring = fakeKeyring();
    const store = createGitHubTokenStore({ keyring, service: 'reinvent-compass-test' });
    expect(store.kind).toBe('keychain');
    expect(store.load()).toBeUndefined();
    expect(store.save(FULL)).toBe('keychain');
    expect(keyring.secrets.get('github-access')).toBe(`1700000000000:${SECRET_ACCESS}`);
    expect(keyring.secrets.get('github-refresh')).toBe(SECRET_REFRESH);
    expect(store.load()).toEqual(FULL);
    expect(keyring.constructed[0].service).toBe('reinvent-compass-test');
  });

  test('a token with no expiry and no refresh token is stored bare and the refresh entry removed', () => {
    const keyring = fakeKeyring();
    const store = createGitHubTokenStore({ keyring });
    store.save(FULL);
    expect(store.save({ accessToken: SECRET_ACCESS })).toBe('keychain');
    expect(keyring.secrets.get('github-access')).toBe(SECRET_ACCESS);
    expect(keyring.secrets.has('github-refresh')).toBe(false);
    expect(store.load()).toEqual({ accessToken: SECRET_ACCESS });
  });

  test('clear deletes both entries, even when one delete throws', () => {
    const keyring = fakeKeyring();
    const store = createGitHubTokenStore({ keyring });
    store.save(FULL);
    keyring.failOn.add('delete:github-access');
    store.clear();
    expect(keyring.calls).toContain('delete:github-refresh');
    expect(keyring.secrets.has('github-refresh')).toBe(false);
    expect(store.kind).toBe('keychain');
  });

  test('a failed write falls back to memory and deletes both entries', () => {
    const keyring = fakeKeyring();
    const store = createGitHubTokenStore({ keyring });
    store.save(FULL);
    keyring.failOn.add('set:github-refresh');
    expect(store.save({ ...FULL, accessToken: 'ghu_new' })).toBe('memory');
    expect(store.kind).toBe('memory');
    expect(keyring.secrets.size).toBe(0);
    expect(store.load()).toEqual({ ...FULL, accessToken: 'ghu_new' });
    expect(store.save(FULL)).toBe('memory');
    store.clear();
    expect(store.load()).toBeUndefined();
  });

  test('a failed read falls back to memory and reports nothing held', () => {
    const keyring = fakeKeyring();
    const store = createGitHubTokenStore({ keyring });
    store.save(FULL);
    keyring.failOn.add('get');
    expect(store.load()).toBeUndefined();
    expect(store.kind).toBe('memory');
    expect(keyring.calls).toContain('delete:github-access');
    expect(keyring.calls).toContain('delete:github-refresh');
  });

  test('a missing keychain means memory only from the start', () => {
    const store = createGitHubTokenStore({ keyring: fakeKeyring({ constructorThrows: true }) });
    expect(store.kind).toBe('memory');
    expect(store.load()).toBeUndefined();
    expect(store.save(FULL)).toBe('memory');
    const loaded = store.load();
    expect(loaded).toEqual(FULL);
    loaded!.accessToken = 'changed';
    expect(store.load()).toEqual(FULL);
    store.clear();
    expect(store.load()).toBeUndefined();
  });

  test('the default keyring and service are used when none are given (mocked here)', () => {
    mockStore.secrets.clear();
    const store = createGitHubTokenStore();
    store.save(FULL);
    expect([...mockStore.secrets.keys()].sort()).toEqual([
      'reinvent-compass/github-access',
      'reinvent-compass/github-refresh',
    ]);
    store.clear();
    expect(mockStore.secrets.size).toBe(0);
  });
});

describe('registerGitHubSecrets', () => {
  function capture() {
    const lines: string[] = [];
    const logger = createRedactingLogger({
      info: (l) => lines.push(l),
      warn: (l) => lines.push(l),
      error: (l) => lines.push(l),
    });
    return { lines, logger };
  }

  test('registers tokens on save and on load, and removes them on clear', () => {
    const keyring = fakeKeyring();
    const raw = createGitHubTokenStore({ keyring });
    raw.save(FULL);

    const loading = capture();
    const loaded = registerGitHubSecrets(raw, loading.logger);
    expect(loaded.kind).toBe('keychain');
    expect(loaded.load()).toEqual(FULL);
    loading.logger.info(`a ${SECRET_ACCESS} b ${SECRET_REFRESH}`);
    expect(loading.lines.join('\n')).not.toContain(SECRET_ACCESS);
    expect(loading.lines.join('\n')).not.toContain(SECRET_REFRESH);

    const saving = capture();
    const saved = registerGitHubSecrets(
      createGitHubTokenStore({ keyring: fakeKeyring() }),
      saving.logger,
    );
    saved.save({ accessToken: 'ghu_x1', refreshToken: 'ghr_y1' });
    saving.logger.warn('ghu_x1 ghr_y1');
    expect(saving.lines.at(-1)).not.toContain('ghu_x1');
    expect(saving.lines.at(-1)).not.toContain('ghr_y1');
    saved.clear();
    expect(saved.load()).toBeUndefined();
    saving.logger.error('ghu_x1 ghr_y1');
    expect(saving.lines.at(-1)).toBe('ghu_x1 ghr_y1');
  });
});

describe('getAccessToken', () => {
  const CLIENT_ID = 'Iv23liCLIENTID';
  const NOW = 1_000_000_000;

  function memoryStore(tokens?: Parameters<GitHubTokenStore['save']>[0]): GitHubTokenStore {
    const store = createGitHubTokenStore({ keyring: fakeKeyring({ constructorThrows: true }) });
    if (tokens !== undefined) {
      store.save(tokens);
    }
    return store;
  }

  const refreshed = {
    access_token: 'ghu_NEW',
    refresh_token: 'ghr_NEW',
    expires_in: 28800,
    token_type: 'bearer',
  };

  test('no token held means not connected', async () => {
    const { fetch } = fakeFetch(() => jsonResponse(200, refreshed));
    await expect(
      getAccessToken({ store: memoryStore(), clientId: CLIENT_ID, fetch, now: () => NOW }),
    ).rejects.toBeInstanceOf(GitHubNotConnectedError);
  });

  test('a token with no expiry or more than 60 seconds left is used as it is', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, refreshed));
    expect(
      await getAccessToken({
        store: memoryStore({ accessToken: 'ghu_A' }),
        clientId: CLIENT_ID,
        fetch,
        now: () => NOW,
      }),
    ).toBe('ghu_A');
    expect(
      await getAccessToken({
        store: memoryStore({
          accessToken: 'ghu_B',
          refreshToken: 'ghr_B',
          accessTokenExpiresAt: NOW + GITHUB_REFRESH_WINDOW_SECONDS * 1000 + 1,
        }),
        clientId: CLIENT_ID,
        fetch,
        now: () => NOW,
      }),
    ).toBe('ghu_B');
    expect(calls).toHaveLength(0);
  });

  test('refreshes within 60 seconds of expiry, saves the new pair and shares one refresh', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, refreshed));
    const store = memoryStore({
      accessToken: 'ghu_OLD',
      refreshToken: 'ghr_OLD',
      accessTokenExpiresAt: NOW + 60_000,
    });
    const [a, b] = await Promise.all([
      getAccessToken({ store, clientId: CLIENT_ID, fetch, now: () => NOW }),
      getAccessToken({ store, clientId: CLIENT_ID, fetch, now: () => NOW }),
    ]);
    expect([a, b]).toEqual(['ghu_NEW', 'ghu_NEW']);
    expect(calls).toHaveLength(1);
    expect(store.load()).toEqual({
      accessToken: 'ghu_NEW',
      refreshToken: 'ghr_NEW',
      accessTokenExpiresAt: NOW + 28_800_000,
    });
  });

  test('a refresh that ends after the store was cleared saves nothing', async () => {
    const store = memoryStore({
      accessToken: 'ghu_OLD',
      refreshToken: 'ghr_GONE',
      accessTokenExpiresAt: NOW,
    });
    const fetch: GitHubFetch = () => {
      store.clear();
      return Promise.resolve(jsonResponse(200, refreshed));
    };
    expect(await getAccessToken({ store, clientId: CLIENT_ID, fetch, now: () => NOW })).toBe(
      'ghu_NEW',
    );
    expect(store.load()).toBeUndefined();
  });

  test('keeps the old refresh token when GitHub does not return a new one', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(200, { access_token: 'ghu_N2', token_type: 'bearer', expires_in: 100 }),
    );
    const store = memoryStore({
      accessToken: 'ghu_O',
      refreshToken: 'ghr_KEEP',
      accessTokenExpiresAt: NOW,
    });
    expect(await getAccessToken({ store, clientId: CLIENT_ID, fetch, now: () => NOW })).toBe(
      'ghu_N2',
    );
    expect(store.load()?.refreshToken).toBe('ghr_KEEP');
  });

  test('a rejected refresh token clears the store and means not connected', async () => {
    const { fetch } = fakeFetch(() => jsonResponse(200, { error: 'bad_refresh_token' }));
    const store = memoryStore({ ...FULL, accessTokenExpiresAt: NOW + 10_000 });
    const error = await getAccessToken({ store, clientId: CLIENT_ID, fetch, now: () => NOW }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GitHubNotConnectedError);
    expect(errorText(error)).not.toContain(SECRET_REFRESH);
    expect(store.load()).toBeUndefined();
  });

  test('another refresh failure uses the current token while it is valid, and throws once expired', async () => {
    const fetch = () => Promise.reject(new Error(`offline ${SECRET_REFRESH}`));
    const valid = memoryStore({ ...FULL, accessTokenExpiresAt: NOW + 10_000 });
    expect(await getAccessToken({ store: valid, clientId: CLIENT_ID, fetch, now: () => NOW })).toBe(
      SECRET_ACCESS,
    );
    const expired = memoryStore({ ...FULL, accessTokenExpiresAt: NOW - 1 });
    const error = await getAccessToken({
      store: expired,
      clientId: CLIENT_ID,
      fetch,
      now: () => NOW,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubNetworkError);
    expect(errorText(error)).not.toContain(SECRET_REFRESH);
    expect(expired.load()).toEqual({ ...FULL, accessTokenExpiresAt: NOW - 1 });
  });

  test('a token close to expiry with no refresh token is used until it expires', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, refreshed));
    expect(
      await getAccessToken({
        store: memoryStore({ accessToken: 'ghu_S', accessTokenExpiresAt: NOW + 5 }),
        clientId: CLIENT_ID,
        fetch,
        now: () => NOW,
      }),
    ).toBe('ghu_S');
    await expect(
      getAccessToken({
        store: memoryStore({ accessToken: 'ghu_S', accessTokenExpiresAt: NOW }),
        clientId: CLIENT_ID,
        fetch,
        now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(GitHubNotConnectedError);
    expect(calls).toHaveLength(0);
  });
});
