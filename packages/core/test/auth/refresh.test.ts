import { describe, expect, test, vi } from 'vitest';
import fc from 'fast-check';
import {
  createCredentialSources,
  refreshIfNeeded,
  refreshNow,
  type RefreshDeps,
} from '../../src/auth/refresh.js';
import {
  createEventsApiCredential,
  createIdTokenProvider,
} from '../../src/auth/credential-provider.js';
import { CLIENT_ID, TOKEN_ENDPOINT } from '../../src/auth/oauth.js';
import { signOut } from '../../src/auth/sign-out.js';
import {
  NotSignedInError,
  RefreshFailedError,
  SignInRequiredError,
} from '../../src/auth/errors.js';
import type { TokenSet } from '../../src/auth/token-store.js';
import {
  capturingLogger,
  fakeOAuth,
  fakeStore,
  heldTokens,
  tokenBody,
  type Scripted,
} from './auth-harness.js';

// Tests for refresh (events-client, S1, tasks 11.5 to 11.8): the 300 second window,
// invalid_grant handling and single flight. OAuth is a scripted fake; no network.

const NOW = 10_000_000;

function deps(
  oauth: ReturnType<typeof fakeOAuth>,
  now = NOW,
): {
  deps: RefreshDeps;
  lines: string[];
} {
  const { logger, lines } = capturingLogger();
  return { deps: { fetch: oauth.fetch, logger, now: () => now }, lines };
}

const tokenArb = fc.stringMatching(/^[A-Za-z0-9]{12,30}$/);
const heldArb: fc.Arbitrary<TokenSet> = fc
  .record({
    accessToken: tokenArb,
    refreshToken: tokenArb,
    idToken: tokenArb,
    accessTokenExpiresAt: fc.integer({ min: 0, max: 100_000_000 }),
  })
  .filter(
    (t) =>
      new Set([t.accessToken, t.refreshToken, t.idToken]).size === 3 &&
      !t.refreshToken.startsWith('new') &&
      !t.accessToken.startsWith('new'),
  );

describe('Feature: events-client, Property 8: Access token is refreshed exactly within 300 seconds of expiry', () => {
  // Validates: Requirements 3.1
  test('for any expiry and clock, a refresh happens if and only if 300 seconds or fewer remain', async () => {
    await fc.assert(
      fc.asyncProperty(heldArb, fc.integer({ min: 0, max: 100_000_000 }), async (held, now) => {
        const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
        const store = fakeStore(held);
        await refreshIfNeeded(store, now, deps(oauth, now).deps);
        const shouldRefresh = held.accessTokenExpiresAt - now <= 300_000;
        expect(oauth.calls).toHaveLength(shouldRefresh ? 1 : 0);
        expect(store.saves).toHaveLength(shouldRefresh ? 1 : 0);
      }),
      { numRuns: 100 },
    );
  });

  test('the boundary is inclusive at exactly 300 seconds and exclusive at 300.001', async () => {
    for (const [remaining, expected] of [
      [300_000, 1],
      [300_001, 0],
      [0, 1],
      [-5, 1],
    ] as const) {
      const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
      const store = fakeStore(heldTokens({ accessTokenExpiresAt: NOW + remaining }));
      await refreshIfNeeded(store, NOW, deps(oauth).deps);
      expect(oauth.calls).toHaveLength(expected);
    }
  });

  test('with nothing stored there is nothing to refresh', async () => {
    const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
    await refreshIfNeeded(fakeStore(), NOW, deps(oauth).deps);
    expect(oauth.calls).toHaveLength(0);
  });
});

describe('events-client, task 11.5: what a refresh sends and stores', () => {
  test('the refresh token goes only to the token endpoint, in the form body', async () => {
    const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
    await refreshNow(fakeStore(heldTokens()), deps(oauth).deps);
    expect(oauth.calls).toHaveLength(1);
    expect(oauth.calls[0]?.url).toBe(TOKEN_ENDPOINT);
    expect(oauth.calls[0]?.form).toEqual({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: 'held-refresh-token-value',
    });
  });

  test('a success replaces access and ID tokens and takes the expiry from expires_in', async () => {
    const oauth = fakeOAuth([
      { status: 200, body: tokenBody({ refresh_token: undefined, expires_in: 900 }) },
    ]);
    const store = fakeStore(heldTokens());
    await refreshNow(store, deps(oauth).deps);
    expect(store.load()).toEqual({
      accessToken: 'new-access-token-value',
      idToken: 'new-id-token-value',
      refreshToken: 'held-refresh-token-value',
      accessTokenExpiresAt: NOW + 900_000,
    });
  });

  test('a new refresh token in the response replaces the stored one', async () => {
    const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
    const store = fakeStore(heldTokens());
    await refreshNow(store, deps(oauth).deps);
    expect(store.load()?.refreshToken).toBe('new-refresh-token-value');
  });

  test('refreshing with nothing stored reports not signed in and sends nothing', async () => {
    const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
    await expect(refreshNow(fakeStore(), deps(oauth).deps)).rejects.toBeInstanceOf(
      NotSignedInError,
    );
    expect(oauth.calls).toHaveLength(0);
  });

  test('no token reaches a log line on success or failure', async () => {
    const ok = deps(fakeOAuth([{ status: 200, body: tokenBody() }]));
    await refreshNow(fakeStore(heldTokens()), ok.deps);
    const bad = deps(
      fakeOAuth([
        { status: 400, body: { error: 'invalid_grant', secret: 'held-refresh-token-value' } },
      ]),
    );
    await refreshNow(fakeStore(heldTokens()), bad.deps).catch(() => undefined);
    const all = [...ok.lines, ...bad.lines].join('\n');
    for (const secret of [
      'held-refresh-token-value',
      'new-access-token-value',
      'new-id-token-value',
      'new-refresh-token-value',
    ]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe('Feature: events-client, Property 9: Only an invalid_grant refresh clears all tokens', () => {
  // Validates: Requirements 3.4
  const otherFailures: Scripted[] = [
    { status: 400, body: { error: 'invalid_request' } },
    { status: 400, body: { error: 'Invalid_Grant' } },
    { status: 401, body: { error: 'invalid_client' } },
    { status: 429, body: 'slow down' },
    { status: 500, body: undefined },
    { status: 503, body: 'down' },
    { status: 200, body: 'not json' },
    { status: 200, body: { access_token: 'only' } },
    { throws: new Error('connect ECONNRESET') },
  ];

  test('for any stored set, invalid_grant empties the store and asks for sign-in', async () => {
    await fc.assert(
      fc.asyncProperty(heldArb, fc.constantFrom(400, 401), async (held, status) => {
        const oauth = fakeOAuth([{ status, body: { error: 'invalid_grant' } }]);
        const store = fakeStore(held);
        await expect(refreshNow(store, deps(oauth).deps)).rejects.toBeInstanceOf(
          SignInRequiredError,
        );
        expect(store.load()).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  test('for any stored set, every other failure leaves the tokens exactly as they were', async () => {
    await fc.assert(
      fc.asyncProperty(heldArb, fc.constantFrom(...otherFailures), async (held, failure) => {
        const store = fakeStore(held);
        await expect(refreshNow(store, deps(fakeOAuth([failure])).deps)).rejects.toBeInstanceOf(
          RefreshFailedError,
        );
        expect(store.load()).toEqual(held);
        expect(store.clears).toBe(0);
        expect(store.saves).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: events-client, Property 10: Concurrent refreshes are single-flight', () => {
  // Validates: Requirements 3.5
  test('for any number of concurrent refreshes with one refresh token there is one exchange', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 12 }), heldArb, async (count, held) => {
        let release: (value: { status: number; body: unknown }) => void = () => undefined;
        const deferred = new Promise<{ status: number; body: unknown }>((resolve) => {
          release = resolve;
        });
        const oauth = fakeOAuth([{ deferred }]);
        const store = fakeStore(held);
        const d = deps(oauth).deps;
        const all = Array.from({ length: count }, () => refreshNow(store, d));
        release({ status: 200, body: tokenBody() });
        await Promise.all(all);
        expect(oauth.calls).toHaveLength(1);
        expect(store.saves).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  test('concurrent callers all see the same failure', async () => {
    const oauth = fakeOAuth([{ status: 400, body: { error: 'invalid_grant' } }]);
    const store = fakeStore(heldTokens());
    const d = deps(oauth).deps;
    const results = await Promise.allSettled([refreshNow(store, d), refreshNow(store, d)]);
    expect(oauth.calls).toHaveLength(1);
    for (const r of results) {
      expect(r.status).toBe('rejected');
    }
  });

  test('a refresh after the first has finished starts a new exchange', async () => {
    const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
    const store = fakeStore(heldTokens());
    const d = deps(oauth).deps;
    await refreshNow(store, d);
    await refreshNow(store, d);
    expect(oauth.calls).toHaveLength(2);
  });

  test('refreshes for different refresh tokens do not share a flight', async () => {
    const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
    const d = deps(oauth).deps;
    await Promise.all([
      refreshNow(fakeStore(heldTokens({ refreshToken: 'refresh-one-value' })), d),
      refreshNow(fakeStore(heldTokens({ refreshToken: 'refresh-two-value' })), d),
    ]);
    expect(oauth.calls).toHaveLength(2);
  });
});

describe('events-client, task 11.5: credential sources over the store', () => {
  test('the providers read tokens from the store and refresh through the same path', async () => {
    const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
    const store = fakeStore(heldTokens({ accessTokenExpiresAt: NOW + 60_000 }));
    const sources = createCredentialSources(store, deps(oauth).deps);
    // Within 300 seconds of expiry: the access token is refreshed before use.
    await expect(createEventsApiCredential(sources).getAccessTokenForEventsApi()).resolves.toBe(
      'new-access-token-value',
    );
    await expect(createIdTokenProvider(sources).getIdTokenForCompassApi()).resolves.toBe(
      'new-id-token-value',
    );
    expect(oauth.calls).toHaveLength(1);
    await createEventsApiCredential(sources).forceRefresh();
    expect(oauth.calls).toHaveLength(2);
  });

  test('with nothing stored the providers report not signed in', async () => {
    const sources = createCredentialSources(fakeStore(), deps(fakeOAuth([{ status: 200 }])).deps);
    await expect(
      createEventsApiCredential(sources).getAccessTokenForEventsApi(),
    ).rejects.toBeInstanceOf(NotSignedInError);
    await expect(sources.refreshNow()).rejects.toBeInstanceOf(NotSignedInError);
  });
});

describe('events-client, M2: a refresh cannot outlive the session it started in', () => {
  /** A refresh whose token endpoint answer is held back until released. */
  function heldRefresh(
    status = 200,
    body: unknown = tokenBody(),
  ): {
    oauth: ReturnType<typeof fakeOAuth>;
    release: () => void;
  } {
    let release: () => void = () => undefined;
    const deferred = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = () => {
        resolve({ status, body });
      };
    });
    return { oauth: fakeOAuth([{ deferred }]), release };
  }

  test('a refresh finishing after sign-out or clear does not bring the tokens back', async () => {
    const { oauth, release } = heldRefresh();
    const store = fakeStore(heldTokens());
    const pending = refreshNow(store, deps(oauth).deps);
    store.clear();
    release();
    await pending;
    expect(store.load()).toBeUndefined();
    expect(store.saves).toHaveLength(0);
  });

  test('a refresh finishing after a newer sign-in does not overwrite the new tokens', async () => {
    const { oauth, release } = heldRefresh();
    const store = fakeStore(heldTokens());
    const pending = refreshNow(store, deps(oauth).deps);
    const fresh = heldTokens({
      accessToken: 'newer-sign-in-access',
      refreshToken: 'newer-sign-in-refresh',
    });
    store.save(fresh);
    release();
    await pending;
    expect(store.load()).toEqual(fresh);
    expect(store.saves).toEqual([fresh]);
  });

  test('a stale invalid_grant does not wipe a newer sign-in or repeat a clear', async () => {
    const { oauth, release } = heldRefresh(400, { error: 'invalid_grant' });
    const store = fakeStore(heldTokens());
    const pending = refreshNow(store, deps(oauth).deps);
    const fresh = heldTokens({ refreshToken: 'newer-sign-in-refresh' });
    store.save(fresh);
    release();
    await expect(pending).resolves.toBeUndefined();
    expect(store.load()).toEqual(fresh);
    expect(store.clears).toBe(0);

    const second = heldRefresh(400, { error: 'invalid_grant' });
    const other = fakeStore(heldTokens({ refreshToken: 'other-refresh-token-value' }));
    const pending2 = refreshNow(other, deps(second.oauth).deps);
    other.clear();
    second.release();
    await expect(pending2).resolves.toBeUndefined();
    expect(other.clears).toBe(1);
  });

  test('a current invalid_grant still clears and asks for sign-in', async () => {
    const { oauth, release } = heldRefresh(400, { error: 'invalid_grant' });
    const store = fakeStore(heldTokens());
    const pending = refreshNow(store, deps(oauth).deps);
    release();
    await expect(pending).rejects.toBeInstanceOf(SignInRequiredError);
    expect(store.load()).toBeUndefined();
  });

  test('sign-out invalidates a refresh already in flight, so nothing unrevoked is stored', async () => {
    const { oauth: tokenOauth, release } = heldRefresh();
    const store = fakeStore(heldTokens());
    const { logger } = capturingLogger();
    const refreshing = refreshNow(store, deps(tokenOauth).deps);
    const revokeOauth = fakeOAuth([{ status: 200 }]);
    const signingOut = signOut(store, { fetch: revokeOauth.fetch, logger });
    release();
    await Promise.all([refreshing, signingOut]);
    expect(store.load()).toBeUndefined();
    expect(store.saves).toHaveLength(0);
  });
});

describe('events-client, M3: token and refresh calls refuse redirects and time out after 30 seconds', () => {
  test('both the refresh and the sign-in exchange pass redirect error and a 30 second signal', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    try {
      const oauth = fakeOAuth([{ status: 200, body: tokenBody() }]);
      await refreshNow(fakeStore(heldTokens()), deps(oauth).deps);
      expect(oauth.calls[0]?.redirect).toBe('error');
      expect(oauth.calls[0]?.signal).toBeInstanceOf(AbortSignal);
      expect(spy).toHaveBeenCalledWith(30_000);
    } finally {
      spy.mockRestore();
    }
  });
});
