// Shared test harness for the sign-in, refresh and sign-out tests (events-client,
// S1). Provides an in-memory token store, a scripted OAuth fetch that records every
// call, and a redacting logger that captures its output. It holds no tests. Nothing
// here touches the real keychain, the network or a browser.

import { createRedactingLogger, type RedactingLogger } from '../../src/api/redacting-logger.js';
import type { OAuthFetch, OAuthFetchInit, OAuthResponseLike } from '../../src/auth/oauth.js';
import type { StorageKind, TokenSet, TokenStore } from '../../src/auth/token-store.js';

/** An in-memory TokenStore that records saves and clears. */
export interface FakeStore extends TokenStore {
  saves: TokenSet[];
  clears: number;
  setKind(kind: StorageKind): void;
  /** When true, a refresh write falls back to memory, as a failing keychain would. */
  degradeOnReplace: boolean;
}

/** Create a fake store. `kind` decides what save reports. */
export function fakeStore(initial?: TokenSet, kind: StorageKind = 'keychain'): FakeStore {
  let held = initial;
  let currentKind = kind;
  let generation = 0;
  const store: FakeStore = {
    saves: [],
    clears: 0,
    degradeOnReplace: false,
    get kind() {
      return currentKind;
    },
    get generation() {
      return generation;
    },
    setKind(next) {
      currentKind = next;
    },
    load: () => (held === undefined ? undefined : { ...held }),
    save(tokens) {
      generation += 1;
      store.saves.push(tokens);
      held = { ...tokens };
      return currentKind;
    },
    clear() {
      generation += 1;
      store.clears += 1;
      held = undefined;
    },
    invalidate() {
      generation += 1;
    },
    replaceIfCurrent(expected, tokens) {
      if (expected !== generation) {
        return undefined;
      }
      if (store.degradeOnReplace) {
        currentKind = 'memory';
      }
      store.saves.push(tokens);
      held = { ...tokens };
      return currentKind;
    },
    clearIfCurrent(expected) {
      if (expected !== generation) {
        return false;
      }
      generation += 1;
      store.clears += 1;
      held = undefined;
      return true;
    },
  };
  return store;
}

/** One scripted reply: a status and body, a thrown error, or a call that never ends. */
export type Scripted =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { throws: Error }
  | { hang: true }
  | { deferred: Promise<{ status: number; body?: unknown }> };

/** One recorded call to the OAuth fetch. */
export interface OAuthCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  form: Record<string, string>;
  signal: AbortSignal | undefined;
  redirect: string;
}

/** A scripted OAuth fetch and the calls it received. */
export interface FakeOAuth {
  fetch: OAuthFetch;
  calls: OAuthCall[];
}

function reply(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): OAuthResponseLike {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    text: () =>
      Promise.resolve(
        body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
      ),
  };
}

/** Replay the scripted replies in order; the last one repeats if the script runs out. */
export function fakeOAuth(script: Scripted[]): FakeOAuth {
  const calls: OAuthCall[] = [];
  let index = 0;
  const fetch: OAuthFetch = (url: string, init: OAuthFetchInit) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      form: Object.fromEntries(new URLSearchParams(init.body)),
      signal: init.signal,
      redirect: init.redirect,
    });
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    if (step === undefined) {
      return Promise.reject(new Error('empty script'));
    }
    if ('throws' in step) {
      return Promise.reject(step.throws);
    }
    if ('hang' in step) {
      return new Promise<OAuthResponseLike>(() => undefined);
    }
    if ('deferred' in step) {
      return step.deferred.then((r) => reply(r.status, r.body));
    }
    return Promise.resolve(reply(step.status, step.body, step.headers));
  };
  return { fetch, calls };
}

/** A successful token endpoint body. */
export function tokenBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'new-access-token-value',
    id_token: 'new-id-token-value',
    refresh_token: 'new-refresh-token-value',
    expires_in: 3600,
    token_type: 'Bearer',
    ...overrides,
  };
}

/** A logger over a capturing sink. `lines` holds every line written, redacted. */
export function capturingLogger(): { logger: RedactingLogger; lines: string[] } {
  const lines: string[] = [];
  const push = (line: string): void => {
    lines.push(line);
  };
  return { logger: createRedactingLogger({ info: push, warn: push, error: push }), lines };
}

/** A token set with distinct, recognisable values. */
export function heldTokens(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: 'held-access-token-value',
    refreshToken: 'held-refresh-token-value',
    idToken: 'held-id-token-value',
    accessTokenExpiresAt: 1_000_000,
    ...overrides,
  };
}
