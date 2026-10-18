import { describe, expect, test, vi } from 'vitest';
import fc from 'fast-check';
import {
  KEYCHAIN_FAILED_NOTICE,
  MEMORY_ONLY_NOTICE,
  buildAuthorizeUrl,
  redirectUriFor,
  signIn,
  startSignIn,
  type SignInDeps,
} from '../../src/auth/sign-in.js';
import {
  AUTHORIZE_ENDPOINT,
  CLIENT_ID,
  SCOPE,
  TOKEN_ENDPOINT,
  defaultOAuthFetch,
} from '../../src/auth/oauth.js';
import { computeChallenge } from '../../src/auth/pkce.js';
import {
  CallbackError,
  SignInFailedError,
  SignInTimeoutError,
  StateMismatchError,
} from '../../src/auth/errors.js';
import type { LoopbackResult, LoopbackServer } from '../../src/auth/loopback-server.js';
import { capturingLogger, fakeOAuth, fakeStore, tokenBody, type Scripted } from './auth-harness.js';

// Tests for the sign-in flow (events-client, S1, tasks 11.1 to 11.4). The loopback
// server, the OAuth fetch, the browser opener, the store and the clock are all fakes,
// so nothing reaches a real port, browser, keychain or OAuth endpoint.

// Shorter than 22 characters, so only the registered needle (not the opaque token rule) removes it.
const GOOD_CODE = 'good-code-value-xyz';

interface Rig {
  deps: SignInDeps;
  store: ReturnType<typeof fakeStore>;
  oauth: ReturnType<typeof fakeOAuth>;
  opened: string[];
  timeouts: number[];
  boundStates: string[];
  logLines: string[];
  closed: () => number;
}

/**
 * Build a sign-in rig. `callback` decides what the fake loopback server delivers,
 * given the state the attempt generated (read back from the URL that was opened).
 */
function rig(options: {
  port?: number;
  script?: Scripted[];
  callback?: (state: string, port: number) => Promise<LoopbackResult>;
  openerThrows?: boolean;
  kind?: 'keychain' | 'memory';
  timeoutMs?: number;
}): Rig {
  const port = options.port ?? 8485;
  const store = fakeStore(undefined, options.kind ?? 'keychain');
  const oauth = fakeOAuth(options.script ?? [{ status: 200, body: tokenBody() }]);
  const opened: string[] = [];
  const timeouts: number[] = [];
  const boundStates: string[] = [];
  let closeCount = 0;
  const { logger, lines } = capturingLogger();
  const deps: SignInDeps = {
    store,
    logger,
    fetch: oauth.fetch,
    now: () => 5_000,
    openBrowser: (url) => {
      opened.push(url);
      if (options.openerThrows === true) {
        throw new Error('no browser');
      }
    },
    bind: (expectedState, lifetimeMs) => {
      timeouts.push(lifetimeMs);
      boundStates.push(expectedState);
      const server: LoopbackServer = {
        port,
        awaitCallback: () => {
          const url = new URL(opened[0] ?? '');
          const state = url.searchParams.get('state') ?? '';
          return (
            options.callback?.(state, port) ?? Promise.resolve({ code: GOOD_CODE, state, port })
          );
        },
        close: () => {
          closeCount += 1;
        },
      };
      return Promise.resolve(server);
    },
  };
  if (options.timeoutMs !== undefined) {
    deps.timeoutMs = options.timeoutMs;
  }
  return {
    deps,
    store,
    oauth,
    opened,
    timeouts,
    boundStates,
    logLines: lines,
    closed: () => closeCount,
  };
}

describe('Feature: events-client, Property 3: Authorize request is built correctly for any bound port', () => {
  // Validates: Requirements 1.9, 1.10, 1.11
  test('for any port, challenge and state the URL carries exactly the required parameters', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        fc.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        (port, challenge, state) => {
          const url = new URL(buildAuthorizeUrl(port, challenge, state));
          expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_ENDPOINT);
          const p = url.searchParams;
          expect(p.get('client_id')).toBe('7vmom55m1qstvq8i71ph127bfq');
          expect(p.get('scope')).toBe('openid email events/access');
          expect(p.get('code_challenge_method')).toBe('S256');
          expect(p.get('identity_provider')).toBe('AWSBuilderID');
          expect(p.get('response_type')).toBe('code');
          expect(p.get('redirect_uri')).toBe(`http://localhost:${String(port)}/callback`);
          expect(p.get('code_challenge')).toBe(challenge);
          expect(p.get('state')).toBe(state);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('a started sign-in opens that URL for the bound port with a fresh PKCE pair', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(8484, 8485, 8486, 8487, 8488, 8489), async (port) => {
        const r = rig({ port });
        const pending = await startSignIn(r.deps);
        expect(pending.port).toBe(port);
        expect(r.opened).toEqual([pending.authorizeUrl]);
        const params = new URL(pending.authorizeUrl).searchParams;
        expect(params.get('redirect_uri')).toBe(redirectUriFor(port));
        expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      }),
      { numRuns: 100 },
    );
  });

  test('constants match the official values', () => {
    expect(CLIENT_ID).toBe('7vmom55m1qstvq8i71ph127bfq');
    expect(SCOPE).toBe('openid email events/access');
    expect(TOKEN_ENDPOINT).toBe('https://oauth.awsevents.com/oauth2/token');
    expect(AUTHORIZE_ENDPOINT).toBe('https://oauth.awsevents.com/oauth2/authorize');
  });
});

describe('Feature: events-client, Property 4: State mismatch is rejected', () => {
  // Validates: Requirements 1.12, 1.13
  test('for any returned state other than the attempt state the attempt is rejected with no exchange or storage', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), async (returned) => {
        const r = rig({
          callback: (state, port) =>
            Promise.resolve({
              code: GOOD_CODE,
              state: returned === state ? `${returned}x` : returned,
              port,
            }),
        });
        await expect(signIn(r.deps)).rejects.toBeInstanceOf(StateMismatchError);
        expect(r.oauth.calls).toHaveLength(0);
        expect(r.store.saves).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  test('the matching state proceeds to the exchange', async () => {
    const r = rig({});
    await expect(signIn(r.deps)).resolves.toMatchObject({ storage: 'keychain' });
    expect(r.oauth.calls).toHaveLength(1);
  });
});

describe('events-client, task 11.1: the code exchange and storage', () => {
  test('the exchange posts the verifier, the exact redirect URI and the code to the token endpoint', async () => {
    const r = rig({ port: 8486 });
    await signIn(r.deps);
    const call = r.oauth.calls[0];
    expect(call?.url).toBe(TOKEN_ENDPOINT);
    expect(call?.method).toBe('POST');
    expect(call?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(call?.form).toMatchObject({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: GOOD_CODE,
      redirect_uri: 'http://localhost:8486/callback',
    });
    const challenge = new URL(r.opened[0] ?? '').searchParams.get('code_challenge');
    expect(computeChallenge(call?.form.code_verifier ?? '')).toBe(challenge);
  });

  test('all three tokens are stored with the expiry taken from expires_in', async () => {
    const r = rig({ script: [{ status: 200, body: tokenBody({ expires_in: 1800 }) }] });
    const result = await signIn(r.deps);
    expect(r.store.saves).toEqual([
      {
        accessToken: 'new-access-token-value',
        refreshToken: 'new-refresh-token-value',
        idToken: 'new-id-token-value',
        accessTokenExpiresAt: 5_000 + 1_800_000,
      },
    ]);
    expect(result.storage).toBe('keychain');
    expect(result.memoryOnlyNotice).toBeUndefined();
    expect(result.authorizeUrl).toBe(r.opened[0]);
  });

  test('every attempt uses a new verifier and a new state', async () => {
    const a = rig({});
    const b = rig({});
    await signIn(a.deps);
    await signIn(b.deps);
    expect(a.oauth.calls[0]?.form.code_verifier).not.toBe(b.oauth.calls[0]?.form.code_verifier);
    expect(new URL(a.opened[0] ?? '').searchParams.get('state')).not.toBe(
      new URL(b.opened[0] ?? '').searchParams.get('state'),
    );
  });

  test('the timeout defaults to five minutes and can be overridden', async () => {
    const a = rig({});
    await signIn(a.deps);
    expect(a.timeouts).toEqual([300_000]);
    const b = rig({ timeoutMs: 1234 });
    await signIn(b.deps);
    expect(b.timeouts).toEqual([1234]);
  });

  test('a browser that cannot be opened does not stop sign-in, and the URL is still returned', async () => {
    const r = rig({ openerThrows: true });
    const pending = await startSignIn(r.deps);
    expect(pending.authorizeUrl.startsWith(AUTHORIZE_ENDPOINT)).toBe(true);
    await expect(pending.complete()).resolves.toMatchObject({ storage: 'keychain' });
    expect(r.logLines.some((l) => l.includes('open the sign-in link manually'))).toBe(true);
  });

  test('a redirect error and a timeout from the loopback server propagate and store nothing', async () => {
    for (const error of [new CallbackError('access_denied'), new SignInTimeoutError()]) {
      const r = rig({ callback: () => Promise.reject(error) });
      await expect(signIn(r.deps)).rejects.toBe(error);
      expect(r.store.saves).toHaveLength(0);
      expect(r.oauth.calls).toHaveLength(0);
    }
  });
});

describe('events-client, task 11.4: token exchange failure and memory-only notice', () => {
  const failures: [string, Scripted][] = [
    ['an error status', { status: 400, body: { error: 'invalid_grant' } }],
    ['a server error', { status: 503, body: 'down' }],
    ['a network error', { throws: new Error('connect ECONNREFUSED') }],
    ['a body that is not JSON', { status: 200, body: 'not json' }],
    ['a body of the wrong shape', { status: 200, body: { access_token: 'a' } }],
    [
      'a response with no refresh token',
      { status: 200, body: { ...tokenBody(), refresh_token: undefined } },
    ],
    ['a non-positive expires_in', { status: 200, body: tokenBody({ expires_in: 0 }) }],
  ];
  for (const [label, step] of failures) {
    test(`${label} is a sign-in failure that stores no partial token and leaks nothing`, async () => {
      const r = rig({ script: [step] });
      const failure = await signIn(r.deps).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(SignInFailedError);
      expect((failure as Error).message).not.toContain(GOOD_CODE);
      expect((failure as Error).message).not.toContain('ECONNREFUSED');
      expect(r.store.saves).toHaveLength(0);
      expect(r.store.load()).toBeUndefined();
      expect(r.logLines.join('\n')).not.toContain(GOOD_CODE);
    });
  }

  test('with no keychain the result carries the memory-only notice', async () => {
    const r = rig({ kind: 'memory' });
    const result = await signIn(r.deps);
    expect(result.storage).toBe('memory');
    expect(result.memoryOnlyNotice).toBe(MEMORY_ONLY_NOTICE);
    expect(MEMORY_ONLY_NOTICE).toContain('sign in again each session');
  });

  test('no token ever reaches a log line', async () => {
    const r = rig({});
    await signIn(r.deps);
    const all = r.logLines.join('\n');
    for (const secret of [
      'new-access-token-value',
      'new-refresh-token-value',
      'new-id-token-value',
    ]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe('events-client: the default OAuth fetch', () => {
  test('delegates to the global fetch with the same url and init (stubbed, no network)', async () => {
    const stub = vi.fn(() => Promise.resolve({ status: 200, text: () => Promise.resolve('{}') }));
    vi.stubGlobal('fetch', stub);
    try {
      const res = await defaultOAuthFetch('https://oauth.awsevents.com/x', {
        method: 'POST',
        headers: {},
        body: 'a=b',
      });
      expect(res.status).toBe(200);
      expect(stub).toHaveBeenCalledWith('https://oauth.awsevents.com/x', {
        method: 'POST',
        headers: {},
        body: 'a=b',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('events-client, M1: the loopback is bound with this attempt state', () => {
  test('the state handed to the binder is the state in the authorize URL', async () => {
    const r = rig({});
    await signIn(r.deps);
    expect(r.boundStates).toEqual([new URL(r.opened[0] ?? '').searchParams.get('state')]);
  });
});

describe('events-client, M3: the sign-in exchange refuses redirects and times out after 30 seconds', () => {
  test('the token exchange passes redirect error and a signal', async () => {
    const r = rig({});
    await signIn(r.deps);
    expect(r.oauth.calls[0]?.redirect).toBe('error');
    expect(r.oauth.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('events-client, L3: an oversize token response is a sign-in failure', () => {
  test('a declared 64 KB plus one response is refused and nothing is stored', async () => {
    const r = rig({
      script: [{ status: 200, body: tokenBody(), headers: { 'content-length': '65537' } }],
    });
    await expect(signIn(r.deps)).rejects.toBeInstanceOf(SignInFailedError);
    expect(r.store.saves).toHaveLength(0);
  });
});

describe('events-client, M4: the authorization code and verifier are scrubbed during the exchange', () => {
  test('a logger line written while the exchange runs hides the code and the verifier', async () => {
    const r = rig({});
    const originalFetch = r.deps.fetch;
    r.deps.fetch = (url, init) => {
      const form = Object.fromEntries(new URLSearchParams(init.body));
      r.deps.logger.info(`exchanging ${form.code ?? ''} with ${form.code_verifier ?? ''}`);
      return originalFetch(url, init);
    };
    await signIn(r.deps);
    const line = r.logLines.find((l) => l.startsWith('exchanging')) ?? '';
    expect(line).not.toContain(GOOD_CODE);
    expect(line).not.toContain(r.oauth.calls[0]?.form.code_verifier ?? 'missing');
    // After the exchange the needles are removed again.
    r.deps.logger.info(`late ${GOOD_CODE}`);
    expect(r.logLines.at(-1)).toContain(GOOD_CODE);
  });
});

describe('events-client, L5: only bearer token responses are accepted', () => {
  test('token_type must be Bearer, in any letter case', async () => {
    for (const type of ['Bearer', 'bearer', 'BEARER']) {
      const r = rig({ script: [{ status: 200, body: tokenBody({ token_type: type }) }] });
      await expect(signIn(r.deps)).resolves.toMatchObject({ storage: 'keychain' });
    }
    for (const type of ['MAC', '', undefined, 7]) {
      const r = rig({ script: [{ status: 200, body: tokenBody({ token_type: type }) }] });
      await expect(signIn(r.deps)).rejects.toBeInstanceOf(SignInFailedError);
      expect(r.store.saves).toHaveLength(0);
    }
  });
});

describe('events-client, L7: the memory-only notice matches why tokens are in memory', () => {
  test('no keychain from the start gets the no-keychain notice', async () => {
    const r = rig({ kind: 'memory' });
    const result = await signIn(r.deps);
    expect(result.memoryOnlyNotice).toBe(MEMORY_ONLY_NOTICE);
    expect(MEMORY_ONLY_NOTICE).toContain('No OS keychain is available');
  });

  test('a keychain that fails while saving gets the keychain-failed notice', async () => {
    const r = rig({});
    const save = r.store.save.bind(r.store);
    r.store.save = (tokens) => {
      r.store.setKind('memory');
      return save(tokens);
    };
    const result = await signIn(r.deps);
    expect(result.memoryOnlyNotice).toBe(KEYCHAIN_FAILED_NOTICE);
    expect(KEYCHAIN_FAILED_NOTICE).toContain('could not be written');
    expect(KEYCHAIN_FAILED_NOTICE).not.toContain('No OS keychain is available');
    expect(KEYCHAIN_FAILED_NOTICE).not.toContain('each session');
  });
});
