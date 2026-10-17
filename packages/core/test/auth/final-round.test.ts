import { describe, expect, test } from 'vitest';
import { BodyTooLargeError } from '../../src/api/capped-body.js';
import {
  OAuthNetworkError,
  OAuthTimeoutError,
  RefreshFailedError,
  SignInRequiredError,
} from '../../src/auth/errors.js';
import {
  postForm,
  REVOKE_ENDPOINT,
  TOKEN_ENDPOINT,
  type OAuthFetch,
} from '../../src/auth/oauth.js';
import { refreshIfNeeded, refreshNow, type RefreshDeps } from '../../src/auth/refresh.js';
import { MEMORY_ONLY_NOTICE } from '../../src/auth/sign-in.js';
import { capturingLogger, fakeOAuth, fakeStore, heldTokens, tokenBody } from './auth-harness.js';

// Final-round tests for the token handling findings: N7 (typed OAuth failures), N8
// (revoking a dropped rotated token), M9 (keychain failure on refresh) and L9 (a still
// valid access token survives a failing refresh).

const NOW = 10_000_000;

function setup(fetch: OAuthFetch): { deps: RefreshDeps; lines: string[] } {
  const { logger, lines } = capturingLogger();
  return { deps: { fetch, logger, now: () => NOW }, lines };
}

describe('events-client, N7: OAuth failures are typed, fixed and cause-free', () => {
  const failing =
    (error: Error): OAuthFetch =>
    () =>
      Promise.reject(error);

  test('a connection error or refused redirect becomes OAuthNetworkError', async () => {
    for (const error of [
      new TypeError('fetch failed', { cause: new Error('ECONNRESET refresh_token=SECRET') }),
      new Error('plain failure'),
    ]) {
      const failure = await postForm(failing(error), TOKEN_ENDPOINT, { a: 'b' }).catch(
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(OAuthNetworkError);
      expect((failure as Error).message).toBe('The sign-in service could not be reached');
      expect((failure as Error).cause).toBeUndefined();
    }
  });

  test('a timeout or abort becomes OAuthTimeoutError', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const error = new Error('aborted');
      error.name = name;
      const failure = await postForm(failing(error), TOKEN_ENDPOINT, {}).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(OAuthTimeoutError);
      expect((failure as Error).cause).toBeUndefined();
    }
  });

  test('a body over the limit keeps its own type', async () => {
    const oauth = fakeOAuth([{ status: 200, body: {}, headers: { 'content-length': '65537' } }]);
    await expect(postForm(oauth.fetch, TOKEN_ENDPOINT, {})).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });
});

describe('events-client, N8: a rotated refresh token that is dropped is revoked', () => {
  /** A router: the token endpoint answers after release, anything else is the revoke. */
  function router(revoke: 'ok' | 'throws' = 'ok'): {
    fetch: OAuthFetch;
    release: () => void;
    revokes: string[];
  } {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revokes: string[] = [];
    const fetch: OAuthFetch = async (url, init) => {
      if (url === TOKEN_ENDPOINT) {
        await gate;
        return {
          status: 200,
          text: () => Promise.resolve(JSON.stringify(tokenBody())),
        };
      }
      expect(url).toBe(REVOKE_ENDPOINT);
      revokes.push(new URLSearchParams(init.body).get('token') ?? '');
      if (revoke === 'throws') {
        throw new Error('revoke failed');
      }
      return { status: 200, text: () => Promise.resolve('') };
    };
    return { fetch, release, revokes };
  }

  test('when the session changed meanwhile the new refresh token is revoked and nothing is stored', async () => {
    const r = router();
    const store = fakeStore(heldTokens());
    const { deps, lines } = setup(r.fetch);
    const pending = refreshNow(store, deps);
    store.clear();
    r.release();
    await expect(pending).resolves.toEqual({});
    expect(r.revokes).toEqual(['new-refresh-token-value']);
    expect(store.load()).toBeUndefined();
    expect(lines.join('\n')).not.toContain('new-refresh-token-value');
  });

  test('a failing revoke is logged without a token and does not fail the refresh', async () => {
    const r = router('throws');
    const store = fakeStore(heldTokens());
    const { deps, lines } = setup(r.fetch);
    const pending = refreshNow(store, deps);
    store.clear();
    r.release();
    await expect(pending).resolves.toEqual({});
    expect(lines.some((l) => l.includes('could not be revoked'))).toBe(true);
    expect(lines.join('\n')).not.toContain('new-refresh-token-value');
  });

  test('a response that did not rotate the refresh token revokes nothing', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const fetch: OAuthFetch = async (url) => {
      calls.push(url);
      await gate;
      return {
        status: 200,
        text: () => Promise.resolve(JSON.stringify(tokenBody({ refresh_token: undefined }))),
      };
    };
    const store = fakeStore(heldTokens());
    const pending = refreshNow(store, setup(fetch).deps);
    store.clear();
    release();
    await pending;
    // A response that repeats the same refresh token revokes nothing either.
    const same = fakeStore(heldTokens());
    const second = refreshNow(
      same,
      setup(() =>
        Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(tokenBody({ refresh_token: 'held-refresh-token-value' })),
            ),
        }),
      ).deps,
    );
    same.clear();
    await second;
    expect(calls).toEqual([TOKEN_ENDPOINT]);
  });
});

describe('events-client, M9: a keychain write failure during refresh is reported without a token', () => {
  test('the refresh logs a fixed warning once and returns the memory-only notice', async () => {
    const store = fakeStore(heldTokens());
    store.degradeOnReplace = true;
    const { deps, lines } = setup(fakeOAuth([{ status: 200, body: tokenBody() }]).fetch);
    const first = await refreshNow(store, deps);
    expect(first).toEqual({ memoryOnlyNotice: MEMORY_ONLY_NOTICE });
    expect(lines.filter((l) => l.includes('keychain could not be written'))).toHaveLength(1);
    // Already memory-only: still reported, but not warned about again.
    const second = await refreshNow(store, deps);
    expect(second).toEqual({ memoryOnlyNotice: MEMORY_ONLY_NOTICE });
    expect(lines.filter((l) => l.includes('keychain could not be written'))).toHaveLength(1);
    for (const secret of [
      'new-access-token-value',
      'new-refresh-token-value',
      'new-id-token-value',
    ]) {
      expect(lines.join('\n')).not.toContain(secret);
    }
  });

  test('a healthy keychain returns no notice', async () => {
    const { deps } = setup(fakeOAuth([{ status: 200, body: tokenBody() }]).fetch);
    expect(await refreshNow(fakeStore(heldTokens()), deps)).toEqual({});
  });
});

describe('events-client, L9: a still valid access token survives a transient refresh failure', () => {
  const near = (secondsLeft: number) =>
    heldTokens({ accessTokenExpiresAt: NOW + secondsLeft * 1000 });

  test('a 5xx or network error inside the window falls back to the current token', async () => {
    for (const step of [
      { status: 503, body: 'down' },
      { status: 500 },
      { throws: new Error('connect ECONNREFUSED') },
      { status: 200, body: { access_token: 'only' } },
    ] as const) {
      const held = near(100);
      const store = fakeStore(held);
      const { deps, lines } = setup(fakeOAuth([step]).fetch);
      await expect(refreshIfNeeded(store, NOW, deps)).resolves.toEqual({});
      expect(store.load()).toEqual(held);
      expect(lines.some((l) => l.includes('current access token is still valid'))).toBe(true);
    }
  });

  test('an expired access token does not fall back: the failure propagates', async () => {
    for (const secondsLeft of [0, -1, -3600]) {
      const store = fakeStore(near(secondsLeft));
      const { deps } = setup(fakeOAuth([{ status: 503 }]).fetch);
      await expect(refreshIfNeeded(store, NOW, deps)).rejects.toBeInstanceOf(RefreshFailedError);
    }
  });

  test('a rejected refresh token always propagates, even with a valid access token', async () => {
    const store = fakeStore(near(100));
    const { deps } = setup(fakeOAuth([{ status: 400, body: { error: 'invalid_grant' } }]).fetch);
    await expect(refreshIfNeeded(store, NOW, deps)).rejects.toBeInstanceOf(SignInRequiredError);
    expect(store.load()).toBeUndefined();
  });

  test('outside the window nothing is refreshed and a success replaces the token inside it', async () => {
    const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
    const outside = fakeStore(near(10_000));
    expect(await refreshIfNeeded(outside, NOW, setup(oauth.fetch).deps)).toEqual({});
    expect(oauth.calls).toHaveLength(0);
    const inside = fakeStore(near(100));
    await refreshIfNeeded(inside, NOW, setup(oauth.fetch).deps);
    expect(inside.load()?.accessToken).toBe('new-access-token-value');
  });
});
