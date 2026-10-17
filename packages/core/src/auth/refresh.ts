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
  TOKEN_ENDPOINT,
  hostOf,
  isOk,
  oauthErrorCode,
  parseTokenResponse,
  postForm,
  type OAuthFetch,
} from './oauth.js';
import type { TokenSet, TokenStore } from './token-store.js';
import type { RedactingLogger } from '../api/redacting-logger.js';

/** What a refresh needs, all injectable. */
export interface RefreshDeps {
  fetch: OAuthFetch;
  logger: RedactingLogger;
  now: () => number;
}

/** Refreshes in progress, keyed by the refresh token they are using. */
const inFlight = new Map<string, Promise<void>>();

/** Run one refresh exchange for the held tokens and store the result. */
async function exchange(
  store: TokenStore,
  held: TokenSet,
  generation: number,
  deps: RefreshDeps,
): Promise<void> {
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
        return;
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
  const stored = store.replaceIfCurrent(generation, {
    accessToken: parsed.accessToken,
    idToken: parsed.idToken,
    refreshToken: parsed.refreshToken ?? held.refreshToken,
    accessTokenExpiresAt: deps.now() + parsed.expiresInSeconds * 1000,
  });
  if (stored === undefined) {
    deps.logger.warn('Token refresh result discarded: the session changed meanwhile');
  }
}

/** Refresh now, sharing any refresh already running for the same refresh token. */
export function refreshNow(store: TokenStore, deps: RefreshDeps): Promise<void> {
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

/** Refresh only when the access token has 300 seconds or fewer left at `now`. */
export async function refreshIfNeeded(
  store: TokenStore,
  now: number,
  deps: RefreshDeps,
): Promise<void> {
  const held = store.load();
  if (held === undefined) {
    return;
  }
  if (held.accessTokenExpiresAt - now <= REFRESH_WINDOW_SECONDS * 1000) {
    await refreshNow(store, deps);
  }
}

/** Wire the store and refresh into the CredentialSources the providers read. */
export function createCredentialSources(store: TokenStore, deps: RefreshDeps): CredentialSources {
  return {
    refreshIfNeeded: () => refreshIfNeeded(store, deps.now(), deps),
    refreshNow: () => refreshNow(store, deps),
    accessToken: () => store.load()?.accessToken,
    idToken: () => store.load()?.idToken,
  };
}
