import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createRedactingLogger } from '../../src/api/redacting-logger.js';
import { createQuotaTracker } from '../../src/api/quota-tracker.js';
import { createHttpTransport, type FetchResponseLike } from '../../src/api/http-transport.js';
import { getSchedule } from '../../src/api/get-schedule.js';
import { reserveSessions } from '../../src/api/reserve-sessions.js';
import { cancelReservation } from '../../src/api/cancel-reservation.js';
import { EventsApiError } from '../../src/api/errors.js';
import { AuthError } from '../../src/auth/errors.js';
import { createCredentialSources, refreshIfNeeded, refreshNow } from '../../src/auth/refresh.js';
import { createEventsApiCredential } from '../../src/auth/credential-provider.js';
import { registerStoreSecrets } from '../../src/auth/secret-registering-store.js';
import { signIn } from '../../src/auth/sign-in.js';
import { signOut } from '../../src/auth/sign-out.js';
import {
  createTokenStore,
  type KeyringEntryLike,
  type KeyringLike,
} from '../../src/auth/token-store.js';
import type { LoopbackServer } from '../../src/auth/loopback-server.js';
import type { OAuthFetch } from '../../src/auth/oauth.js';
import type { ClientContext } from '../../src/api/transport.js';
import { fakeOAuth, type Scripted } from './auth-harness.js';

// The required security test (events-client, S1, task 17.1; Requirements 20.1 to
// 20.3), the full named run of Property 7. One scenario drives sign-in, token refresh
// and failing Events API operations while every server answer, thrown error message
// and header echo is laden with five kinds of needle: the access token, the refresh
// token, the ID token, an email address and the Authorization header value. Nothing
// the code logs, returns or throws may contain any of them.

const b64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');

interface Needles {
  access: string;
  refresh: string;
  id: string;
  email: string;
  code: string;
}

/** The secrets the OAuth server hands out in one run. All are distinct and recognisable. */
function makeNeedles(a: string, r: string, i: string, e: string): Needles {
  const email = `${e}@example.com`;
  return {
    access: `AT-${a}`,
    refresh: `RT-${r}`,
    id: `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ email, tag: i }))}.${b64url(`sig-${i}`)}`,
    email,
    code: `CODE-${a}`,
  };
}

/** Everything observable from outside: log lines and every error with all its fields. */
interface Observed {
  lines: string[];
  errors: unknown[];
}

function serialise(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const own = Object.fromEntries(
    Object.getOwnPropertyNames(error).map((k) => [
      k,
      (error as unknown as Record<string, unknown>)[k],
    ]),
  );
  return `${String(error)} ${JSON.stringify(own)} ${error.stack ?? ''}`;
}

function memoryKeyring(): KeyringLike {
  const secrets = new Map<string, number[]>();
  class Entry implements KeyringEntryLike {
    constructor(
      _service: string,
      private readonly account: string,
    ) {}
    setSecret(secret: Uint8Array): void {
      secrets.set(this.account, [...secret]);
    }
    getSecret(): number[] | null {
      return secrets.get(this.account) ?? null;
    }
    deleteCredential(): boolean {
      return secrets.delete(this.account);
    }
  }
  return { Entry };
}

/** A token endpoint body carrying the needles in every field a server might echo. */
function tokenBody(n: Needles, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: n.access,
    id_token: n.id,
    refresh_token: n.refresh,
    expires_in: 3600,
    token_type: 'Bearer',
    email: n.email,
    ...extra,
  };
}

/** Run the whole scenario for one set of needles and return what was observable. */
async function runScenario(n: Needles): Promise<Observed> {
  const lines: string[] = [];
  const push = (line: string): void => {
    lines.push(line);
  };
  const logger = createRedactingLogger({ info: push, warn: push, error: push });
  const errors: unknown[] = [];
  const attempt = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (error) {
      errors.push(error);
    }
  };
  let clock = 10_000_000;
  const now = (): number => clock;

  const store = registerStoreSecrets(createTokenStore(memoryKeyring()), logger);

  // A fake loopback server that delivers one callback carrying the right state.
  const bindOk = (state: string): Promise<LoopbackServer> =>
    Promise.resolve({
      port: 8484,
      awaitCallback: () => Promise.resolve({ code: n.code, state, port: 8484 }),
      close: () => undefined,
    });
  const signInWith = (script: Scripted[], target = store): Promise<unknown> => {
    const oauth = fakeOAuth(script);
    return signIn({
      store: target,
      logger,
      fetch: oauth.fetch,
      now,
      openBrowser: () => undefined,
      bind: (state) => bindOk(state),
    });
  };

  // 1. Sign-in: first the failures, with secret-laden answers, then a success.
  const failing: Scripted[] = [
    {
      status: 400,
      body: {
        error: 'invalid_grant',
        error_description: `${n.email} ${n.refresh}`,
        ...tokenBody(n),
      },
    },
    { status: 500, body: `oops ${n.access} ${n.email} authorization: Bearer ${n.access}` },
    { throws: new Error(`connect failed for ${n.refresh} and ${n.email}`) },
    { status: 200, body: { ...tokenBody(n), expires_in: 'soon' } },
  ];
  for (const step of failing) {
    await attempt(() =>
      signInWith([step], registerStoreSecrets(createTokenStore(memoryKeyring()), logger)),
    );
  }
  await attempt(() => signInWith([{ status: 200, body: tokenBody(n) }]));

  // 2. Refresh: success, rejected refresh token, network error and an unusable answer.
  const refreshDeps = (fetch: OAuthFetch) => ({ fetch, logger, now });
  clock += 3_000_000;
  await attempt(() =>
    refreshIfNeeded(
      store,
      now(),
      refreshDeps(fakeOAuth([{ status: 200, body: tokenBody(n) }]).fetch),
    ),
  );
  for (const step of [
    { status: 500, body: `down ${n.refresh} ${n.email}` },
    { throws: new Error(`socket closed ${n.refresh} ${n.id}`) },
    { status: 200, body: { access_token: n.access, email: n.email } },
    {
      status: 400,
      body: { error: 'invalid_grant', error_description: `${n.email} ${n.refresh} ${n.id}` },
    },
  ] satisfies Scripted[]) {
    const other = registerStoreSecrets(createTokenStore(memoryKeyring()), logger);
    other.save({
      accessToken: n.access,
      refreshToken: n.refresh,
      idToken: n.id,
      accessTokenExpiresAt: 0,
    });
    await attempt(() => refreshNow(other, refreshDeps(fakeOAuth([step]).fetch)));
  }

  // 3. Events API operations that fail, through the real HTTP transport. The fake
  // server echoes the Authorization header and the email back in its error bodies.
  const apiFetch =
    (replies: { status: number; body: string }[]) =>
    (_url: string, init: { headers: Record<string, string> }): Promise<FetchResponseLike> => {
      const reply = replies.shift() ?? { status: 500, body: '' };
      const text = `${reply.body} echo=${init.headers.authorization ?? ''} email=${n.email} id=${n.id}`;
      return Promise.resolve({
        status: reply.status,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ message: text })),
      });
    };
  store.save({
    accessToken: n.access,
    refreshToken: n.refresh,
    idToken: n.id,
    accessTokenExpiresAt: clock + 3_600_000,
  });
  const contextFor = (replies: { status: number; body: string }[]): ClientContext => {
    const sources = createCredentialSources(
      store,
      refreshDeps(fakeOAuth([{ status: 200, body: tokenBody(n) }]).fetch),
    );
    return {
      eventId: 'reinvent2026',
      transport: createHttpTransport({
        credential: createEventsApiCredential(sources),
        fetch: apiFetch(replies),
      }),
      accessToken: createEventsApiCredential(sources),
      quota: createQuotaTracker(),
      logger,
      now,
      sleep: () => Promise.resolve(),
    };
  };
  for (const status of [400, 403, 404, 409, 500, 503, 418]) {
    await attempt(() => getSchedule(contextFor([{ status, body: `fail ${n.access}` }])));
  }
  await attempt(() =>
    getSchedule(
      contextFor([
        { status: 401, body: 'expired' },
        { status: 401, body: 'still expired' },
      ]),
    ),
  );
  await attempt(() => reserveSessions(contextFor([{ status: 401, body: n.refresh }]), ['S1']));
  await attempt(() => cancelReservation(contextFor([{ status: 429, body: n.refresh }]), 'S1'));
  await attempt(() => getSchedule(contextFor([{ status: 200, body: `not a schedule ${n.id}` }])));

  // A positive control, while the tokens are registered: the logger scrubs every
  // needle written to it.
  logger.info(
    `debug ${n.access} ${n.refresh} ${n.id} ${n.email} authorization: Bearer ${n.access} code=${n.code}`,
  );

  // 4. Sign-out with a failing revoke.
  await attempt(() =>
    signOut(store, {
      fetch: fakeOAuth([{ status: 500, body: `${n.refresh} ${n.email}` }]).fetch,
      logger,
    }),
  );

  return { lines, errors };
}

function assertClean(n: Needles, observed: Observed): void {
  const needles = [n.access, n.refresh, n.id, n.email, n.code, `Bearer ${n.access}`];
  const outputs = [...observed.lines, ...observed.errors.map(serialise)];
  expect(outputs.length).toBeGreaterThan(10);
  for (const out of outputs) {
    for (const needle of needles) {
      expect(out).not.toContain(needle);
    }
    // Any Authorization or Bearer value that appears must be redacted.
    expect(out).not.toMatch(/bearer\s+(?!\[REDACTED\])\S/i);
    expect(out).not.toMatch(/authorization\s*[:=]\s*(?!bearer\s+\[REDACTED\]|\[REDACTED\])\S/i);
  }
}

const part = fc.stringMatching(/^[A-Za-z0-9]{16,28}$/);

describe('Feature: events-client, Property 7: No secret ever appears in logs or errors', () => {
  // Validates: Requirements 20.1, 20.2, 20.3 (the required security test)
  test('across sign-in, refresh and failing operations no needle appears in any log line or error', async () => {
    await fc.assert(
      fc.asyncProperty(part, part, part, fc.stringMatching(/^[a-z]{6,12}$/), async (a, r, i, e) => {
        const n = makeNeedles(a, r, i, e);
        assertClean(n, await runScenario(n));
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  test('every failure the scenario produced is one of the typed errors', async () => {
    const observed = await runScenario(
      makeNeedles('a'.repeat(20), 'r'.repeat(20), 'i'.repeat(20), 'person'),
    );
    expect(observed.errors.length).toBeGreaterThan(15);
    for (const error of observed.errors) {
      expect(error instanceof AuthError || error instanceof EventsApiError).toBe(true);
    }
  });

  test('the needles are live: a logger that knows nothing leaves them in the line', () => {
    const n = makeNeedles('b'.repeat(20), 'c'.repeat(20), 'd'.repeat(20), 'someone');
    const raw: string[] = [];
    const bare = createRedactingLogger({
      info: (l) => raw.push(l),
      warn: (l) => raw.push(l),
      error: (l) => raw.push(l),
    });
    // Without registering anything, only the structural patterns act: the opaque
    // refresh token and the plain access token are not removed by them.
    bare.info(`x ${n.refresh} ${n.access}`);
    expect(raw[0]).toContain(n.refresh);
    expect(raw[0]).toContain(n.access);
  });
});
