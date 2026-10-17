import { describe, expect, test, vi } from 'vitest';
import fc from 'fast-check';
import { REVOKE_TIMEOUT_MS, signOut } from '../../src/auth/sign-out.js';
import { BUILDER_ID_SIGN_OUT_URL, CLIENT_ID, REVOKE_ENDPOINT } from '../../src/auth/oauth.js';
import {
  capturingLogger,
  fakeOAuth,
  fakeStore,
  heldTokens,
  type Scripted,
} from './auth-harness.js';

// Tests for sign-out (events-client, S1, tasks 11.9 and 11.10). OAuth is a scripted
// fake and the store is in memory; nothing reaches the network.

const SIGN_OUT_URL = 'https://idp.awsevents.com/oidc/logout';

const outcomes: Scripted[] = [
  { status: 200 },
  { status: 204 },
  { status: 400, body: { error: 'invalid_token' } },
  { status: 500, body: 'oops' },
  { throws: new Error('connect ETIMEDOUT') },
  { hang: true },
];

describe('Feature: events-client, Property 12: Sign-out always clears tokens and returns the logout URL', () => {
  // Validates: Requirements 5.1, 5.2, 5.3
  test('for any revoke outcome the tokens are cleared and the Builder ID sign-out URL returned', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...outcomes), fc.boolean(), async (outcome, signedIn) => {
        const oauth = fakeOAuth([outcome]);
        const store = fakeStore(signedIn ? heldTokens() : undefined);
        const { logger, lines } = capturingLogger();
        const result = await signOut(store, { fetch: oauth.fetch, logger, timeoutMs: 5 });
        expect(result).toEqual({ signOutUrl: SIGN_OUT_URL });
        expect(store.load()).toBeUndefined();
        expect(store.clears).toBe(1);
        expect(oauth.calls).toHaveLength(signedIn ? 1 : 0);
        expect(lines.join('\n')).not.toContain('held-refresh-token-value');
      }),
      { numRuns: 100 },
    );
  });

  test('the refresh token is revoked at the revoke endpoint before the store is cleared', async () => {
    const store = fakeStore(heldTokens());
    let heldAtRevoke: string | undefined;
    const oauth = fakeOAuth([{ status: 200 }]);
    const wrapped = (url: string, init: Parameters<typeof oauth.fetch>[1]) => {
      heldAtRevoke = store.load()?.refreshToken;
      return oauth.fetch(url, init);
    };
    await signOut(store, { fetch: wrapped, logger: capturingLogger().logger });
    expect(heldAtRevoke).toBe('held-refresh-token-value');
    expect(oauth.calls[0]?.url).toBe(REVOKE_ENDPOINT);
    expect(oauth.calls[0]?.form).toEqual({
      token: 'held-refresh-token-value',
      client_id: CLIENT_ID,
    });
    expect(store.clears).toBe(1);
  });

  test('a revoke that never answers is aborted at the timeout and the tokens are still cleared', async () => {
    const oauth = fakeOAuth([{ hang: true }]);
    const store = fakeStore(heldTokens());
    const { logger, lines } = capturingLogger();
    await signOut(store, { fetch: oauth.fetch, logger, timeoutMs: 5 });
    expect(oauth.calls[0]?.signal?.aborted).toBe(true);
    expect(store.load()).toBeUndefined();
    expect(lines.some((l) => l.includes('timed out'))).toBe(true);
  });

  test('the default timeout is ten seconds', async () => {
    expect(REVOKE_TIMEOUT_MS).toBe(10_000);
    vi.useFakeTimers();
    try {
      const oauth = fakeOAuth([{ hang: true }]);
      const store = fakeStore(heldTokens());
      const pending = signOut(store, { fetch: oauth.fetch, logger: capturingLogger().logger });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(store.clears).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ signOutUrl: BUILDER_ID_SIGN_OUT_URL });
      expect(store.clears).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a failed revoke status is logged without any token', async () => {
    const { logger, lines } = capturingLogger();
    await signOut(fakeStore(heldTokens()), {
      fetch: fakeOAuth([{ status: 500, body: 'held-refresh-token-value' }]).fetch,
      logger,
    });
    expect(lines.join('\n')).toContain('status 500');
    expect(lines.join('\n')).not.toContain('held-refresh-token-value');
  });
});

describe('events-client, M3: OAuth calls refuse redirects and have time limits', () => {
  test('the revoke call refuses redirects and uses its own 10 second signal', async () => {
    const oauth = fakeOAuth([{ status: 200 }]);
    await signOut(fakeStore(heldTokens()), {
      fetch: oauth.fetch,
      logger: capturingLogger().logger,
    });
    expect(oauth.calls[0]?.redirect).toBe('error');
    expect(oauth.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});
