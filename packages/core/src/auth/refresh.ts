// Single-flight token refresh (events-client, S1, task 11.5).
//
// refreshIfNeeded refreshes when the access token has 300 seconds or fewer left
// (Requirement 3.1); the expiry is the absolute time derived from the token
// response expires_in, and no JWT is ever decoded. refreshNow refreshes regardless
// of the window, for the operation path's reactive 401 handling.
//
// Single flight (Requirement 3.5): refreshes are keyed on the current refresh token,
// so a second request while one is running awaits the same promise rather than
// starting another exchange.
//
// The refresh token is sent only to the token endpoint, and the audience guard is
// asked first (Requirements 3.2, 4.2). A success replaces the stored access and ID
// tokens, and the refresh token only if the response returned a new one
// (Requirement 3.3). Only an invalid_grant answer clears the stored tokens and asks
// the attendee to sign in again (Requirement 3.4); any other failure leaves the
// stored tokens exactly as they were.

import { assertAudience, type CredentialSources } from './credential-provider.js';
import { NotSignedInError, RefreshFailedError, SignInRequiredError } from './errors.js';
import {
  CLIENT_ID,
  REFRESH_WINDOW_SECONDS,
  REVOKE_ENDPOINT,
  TOKEN_ENDPOINT,
  hostOf,
  isOk,
  oauthErrorCode,
  parseTokenResponse,
  postForm,
  type OAuthFetch,
} from './oauth.js';
import { KEYCHAIN_FAILED_NOTICE, MEMORY_ONLY_NOTICE } from './sign-in.js';
import { REVOKE_TIMEOUT_MS } from './sign-out.js';
import type { TokenSet, TokenStore } from './token-store.js';
import type { RedactingLogger } from '../api/redacting-logger.js';

/** What a refresh needs, all injectable. */
export interface RefreshDeps {
  fetch: OAuthFetch;
  logger: RedactingLogger;
  now: () => number;
}

/** Refreshes in progress, keyed by the refresh token they are using. */
const inFlight = new Map<string, Promise<RefreshResult>>();

/** What a refresh reports back. */
export interface RefreshResult {
  /**
   * Present when the refreshed tokens are held in memory only (the keychain could not
   * be written). It never contains a token value.
   */
  memoryOnlyNotice?: string;
}

/**
 * Best-effort revoke of a rotated refresh token that was not stored because the
 * session changed meanwhile (finding N8): without this the new token would stay
 * valid at the server, unknown to the client, until it expires.
 */
async function revokeDropped(token: string, deps: RefreshDeps): Promise<void> {
  try {
    assertAudience('refresh-token', hostOf(REVOKE_ENDPOINT));
    await postForm(
      deps.fetch,
      REVOKE_ENDPOINT,
      { token, client_id: CLIENT_ID },
      AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    );
  } catch {
    deps.logger.warn('A refresh token that was dropped could not be revoked');
  }
}

/** Run one refresh exchange for the held tokens and store the result. */
async function exchange(
  store: TokenStore,
  held: TokenSet,
  generation: number,
  deps: RefreshDeps,
): Promise<RefreshResult> {
  assertAudience('refresh-token', hostOf(TOKEN_ENDPOINT));
  let result;
  try {
    result = await postForm(deps.fetch, TOKEN_ENDPOINT, {
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: held.refreshToken,
    });
  } catch {
    deps.logger.warn('Token refresh failed: the token endpoint could not be reached');
    throw new RefreshFailedError();
  }

  if (!isOk(result.status)) {
    if (oauthErrorCode(result.json) === 'invalid_grant') {
      // A rejection of an old refresh token must not wipe tokens from a newer
      // sign-in, nor repeat a clear that sign-out already did (finding M2).
      if (!store.clearIfCurrent(generation)) {
        deps.logger.warn('Token refresh result discarded: the session changed meanwhile');
        return {};
      }
      deps.logger.warn('Token refresh rejected: sign-in is required');
      throw new SignInRequiredError();
    }
    deps.logger.warn(`Token refresh failed with status ${String(result.status)}`);
    throw new RefreshFailedError();
  }

  const parsed = parseTokenResponse(result.json);
  if (parsed === undefined) {
    deps.logger.warn('Token refresh failed: the response was not usable');
    throw new RefreshFailedError();
  }
  deps.logger.addSecret(parsed.accessToken);
  deps.logger.addSecret(parsed.idToken);
  deps.logger.addSecret(parsed.refreshToken);
  // Write only if no sign-in, sign-out or clear happened since this refresh started,
  // so a late refresh can never bring back tokens after sign-out (finding M2).
  const keychainBefore = store.kind === 'keychain';
  const stored = store.replaceIfCurrent(generation, {
    accessToken: parsed.accessToken,
    idToken: parsed.idToken,
    refreshToken: parsed.refreshToken ?? held.refreshToken,
    accessTokenExpiresAt: deps.now() + parsed.expiresInSeconds * 1000,
  });
  if (stored === undefined) {
    deps.logger.warn('Token refresh result discarded: the session changed meanwhile');
    if (parsed.refreshToken !== undefined && parsed.refreshToken !== held.refreshToken) {
      await revokeDropped(parsed.refreshToken, deps);
    }
    return {};
  }
  if (stored === 'memory') {
    // The keychain could not be written (finding M9): say so, without any token value.
    if (keychainBefore) {
      deps.logger.warn('The keychain could not be written; tokens are now held in memory only');
    }
    return { memoryOnlyNotice: keychainBefore ? KEYCHAIN_FAILED_NOTICE : MEMORY_ONLY_NOTICE };
  }
  return {};
}

/** Refresh now, sharing any refresh already running for the same refresh token. */
export function refreshNow(store: TokenStore, deps: RefreshDeps): Promise<RefreshResult> {
  const held = store.load();
  const generation = store.generation;
  if (held === undefined) {
    return Promise.reject(new NotSignedInError());
  }
  const running = inFlight.get(held.refreshToken);
  if (running !== undefined) {
    return running;
  }
  const started = exchange(store, held, generation, deps).finally(() => {
    inFlight.delete(held.refreshToken);
  });
  inFlight.set(held.refreshToken, started);
  return started;
}

/**
 * Refresh only when the access token has 300 seconds or fewer left at `now`. If the
 * refresh fails for a reason other than a rejected refresh token (a 5xx, a network
 * error) while the current access token is still valid, the current token is used and
 * the failure is only logged (QA L9); a rejected refresh token always propagates.
 */
export async function refreshIfNeeded(
  store: TokenStore,
  now: number,
  deps: RefreshDeps,
): Promise<RefreshResult> {
  const held = store.load();
  if (held === undefined || held.accessTokenExpiresAt - now > REFRESH_WINDOW_SECONDS * 1000) {
    return {};
  }
  try {
    return await refreshNow(store, deps);
  } catch (error) {
    if (error instanceof RefreshFailedError && held.accessTokenExpiresAt > now) {
      deps.logger.warn('Token refresh failed; the current access token is still valid and is used');
      return {};
    }
    throw error;
  }
}

/** Wire the store and refresh into the CredentialSources the providers read. */
export function createCredentialSources(store: TokenStore, deps: RefreshDeps): CredentialSources {
  return {
    refreshIfNeeded: async () => {
      await refreshIfNeeded(store, deps.now(), deps);
    },
    refreshNow: async () => {
      await refreshNow(store, deps);
    },
    accessToken: () => store.load()?.accessToken,
    idToken: () => store.load()?.idToken,
  };
}
