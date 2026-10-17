// Sign-in flow (events-client, S1, task 11.1).
//
// OAuth 2.0 authorization code with PKCE against oauth.awsevents.com:
//   1. generate a new verifier, challenge and state for this attempt,
//   2. bind the loopback server (first free port of 8484 to 8489),
//   3. build the authorize URL and open it through the injected browser opener,
//   4. wait for the single redirect and compare the returned state,
//   5. exchange the code at the token endpoint with the verifier,
//   6. store all three tokens (and only then), reporting memory-only storage.
//
// startSignIn returns the authorize URL straight away so a headless or test run can
// drive it; signIn runs the whole flow. A failed exchange stores nothing, and no
// error or log line ever carries a code, a token, a response body or the state.

import { SignInFailedError, StateMismatchError } from './errors.js';
import {
  bindLoopback,
  defaultLoopbackDeps,
  LOOPBACK_PORTS,
  type LoopbackServer,
} from './loopback-server.js';
import {
  AUTHORIZE_ENDPOINT,
  CLIENT_ID,
  IDENTITY_PROVIDER,
  SCOPE,
  TOKEN_ENDPOINT,
  isOk,
  parseTokenResponse,
  postForm,
  type OAuthFetch,
} from './oauth.js';
import { createPkcePair, createState, type RandomBytes } from './pkce.js';
import type { StorageKind, TokenStore } from './token-store.js';
import type { RedactingLogger } from '../api/redacting-logger.js';

/** Opens a URL in the user's browser. Fire and forget. */
export type BrowserOpener = (url: string) => void;

/** How long to wait for the browser redirect by default: five minutes. */
export const DEFAULT_SIGN_IN_TIMEOUT_MS = 300_000;

/** The notice returned when tokens are held in memory only (Requirement 2.3). */
export const MEMORY_ONLY_NOTICE =
  'No OS keychain is available, so your tokens are held in memory only. ' +
  'You will need to sign in again each session.';

/** Everything the sign-in flow needs, all injectable. */
export interface SignInDeps {
  store: TokenStore;
  logger: RedactingLogger;
  fetch: OAuthFetch;
  openBrowser: BrowserOpener;
  now: () => number;
  /** How long to wait for the redirect. Defaults to five minutes. */
  timeoutMs?: number;
  /** Binds the loopback server. Defaults to the real binder over 8484 to 8489. */
  bind?: (expectedState: string, timeoutMs: number) => Promise<LoopbackServer>;
  /** Random bytes for the verifier and state. Defaults to node:crypto. */
  random?: RandomBytes;
}

/** The outcome of a completed sign-in. */
export interface SignInResult {
  storage: StorageKind;
  /** Present only when tokens are held in memory only. */
  memoryOnlyNotice?: string;
  /** The authorize URL that was opened, for headless callers. */
  authorizeUrl: string;
}

/** A sign-in that has started: the URL to open and the way to finish. */
export interface PendingSignIn {
  authorizeUrl: string;
  /** The bound loopback port. */
  port: number;
  /** Wait for the redirect, exchange the code and store the tokens. */
  complete(): Promise<SignInResult>;
}

/** The exact redirect URI for a bound port. */
export function redirectUriFor(port: number): string {
  return `http://localhost:${String(port)}/callback`;
}

/** Percent-encode one query component. */
function encode(value: string): string {
  return encodeURIComponent(value);
}

/** Build the authorize URL for a bound port, challenge and state. */
export function buildAuthorizeUrl(port: number, challenge: string, state: string): string {
  const params: [string, string][] = [
    ['response_type', 'code'],
    ['client_id', CLIENT_ID],
    ['redirect_uri', redirectUriFor(port)],
    ['scope', SCOPE],
    ['state', state],
    ['code_challenge', challenge],
    ['code_challenge_method', 'S256'],
    ['identity_provider', IDENTITY_PROVIDER],
  ];
  return `${AUTHORIZE_ENDPOINT}?${params.map(([k, v]) => `${k}=${encode(v)}`).join('&')}`;
}

/** Begin a sign-in: bind the port, build the URL and open the browser. */
export async function startSignIn(deps: SignInDeps): Promise<PendingSignIn> {
  const pkce = createPkcePair(deps.random);
  const state = createState(deps.random);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS;
  const bind =
    deps.bind ??
    ((expectedState: string, lifetimeMs: number) =>
      bindLoopback(LOOPBACK_PORTS, defaultLoopbackDeps, { expectedState, timeoutMs: lifetimeMs }));
  const server = await bind(state, timeoutMs);
  const authorizeUrl = buildAuthorizeUrl(server.port, pkce.challenge, state);

  try {
    deps.openBrowser(authorizeUrl);
  } catch {
    // The URL is also returned, so the attendee can open it by hand.
    deps.logger.warn('Could not open the browser automatically; open the sign-in link manually');
  }

  return {
    authorizeUrl,
    port: server.port,
    async complete() {
      const callback = await server.awaitCallback();
      if (callback.state !== state) {
        throw new StateMismatchError();
      }
      const tokens = await exchangeCode(deps, callback.code, pkce.verifier, server.port);
      deps.logger.addSecret(tokens.accessToken);
      deps.logger.addSecret(tokens.refreshToken);
      deps.logger.addSecret(tokens.idToken);
      const storage = deps.store.save(tokens);
      deps.logger.info('Signed in');
      return storage === 'memory'
        ? { storage, memoryOnlyNotice: MEMORY_ONLY_NOTICE, authorizeUrl }
        : { storage, authorizeUrl };
    },
  };
}

/** Run the whole flow: start, wait for the redirect, exchange and store. */
export async function signIn(deps: SignInDeps): Promise<SignInResult> {
  const pending = await startSignIn(deps);
  return pending.complete();
}

/** Exchange the authorization code for the three tokens. Never stores anything. */
async function exchangeCode(
  deps: SignInDeps,
  code: string,
  verifier: string,
  port: number,
): Promise<{
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accessTokenExpiresAt: number;
}> {
  let result;
  try {
    result = await postForm(deps.fetch, TOKEN_ENDPOINT, {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUriFor(port),
      code_verifier: verifier,
    });
  } catch {
    throw new SignInFailedError();
  }
  const parsed = isOk(result.status) ? parseTokenResponse(result.json) : undefined;
  if (parsed?.refreshToken === undefined) {
    throw new SignInFailedError();
  }
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    idToken: parsed.idToken,
    accessTokenExpiresAt: deps.now() + parsed.expiresInSeconds * 1000,
  };
}
