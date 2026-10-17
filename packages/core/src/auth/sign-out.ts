// Sign-out (events-client, S1, task 11.9).
//
// Revokes the refresh token at the revoke endpoint, then clears all three tokens
// from the store and returns the Builder ID sign-out URL (Requirements 5.1, 5.2).
// Whatever happens to the revoke (an error status, a thrown error or no answer
// within 10 seconds) the tokens are cleared and the URL is returned (Requirement
// 5.3). The refresh token goes only to the revoke endpoint, after the audience
// guard. Nothing sensitive reaches a log line or an error.

import { assertAudience } from './credential-provider.js';
import {
  BUILDER_ID_SIGN_OUT_URL,
  CLIENT_ID,
  REVOKE_ENDPOINT,
  hostOf,
  isOk,
  postForm,
  type OAuthFetch,
} from './oauth.js';
import type { TokenStore } from './token-store.js';
import type { RedactingLogger } from '../api/redacting-logger.js';

/** The revoke call gives up after ten seconds. */
export const REVOKE_TIMEOUT_MS = 10_000;

/** What sign-out needs, all injectable. */
export interface SignOutDeps {
  fetch: OAuthFetch;
  logger: RedactingLogger;
  /** Overrides the 10 second revoke timeout. */
  timeoutMs?: number;
}

/** The outcome of a sign-out. */
export interface SignOutResult {
  /** The Builder ID sign-out page, https://idp.awsevents.com/oidc/logout. */
  signOutUrl: string;
}

/** Revoke the refresh token, giving up (and aborting the request) after the timeout. */
async function revoke(refreshToken: string, deps: SignOutDeps): Promise<void> {
  assertAudience('refresh-token', hostOf(REVOKE_ENDPOINT));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, deps.timeoutMs ?? REVOKE_TIMEOUT_MS);
  });
  try {
    const outcome = await Promise.race([
      postForm(
        deps.fetch,
        REVOKE_ENDPOINT,
        { token: refreshToken, client_id: CLIENT_ID },
        controller.signal,
      ),
      timeout,
    ]);
    if (outcome === 'timeout') {
      deps.logger.warn('Token revoke timed out; tokens are cleared locally anyway');
    } else if (!isOk(outcome.status)) {
      deps.logger.warn(`Token revoke failed with status ${String(outcome.status)}`);
    }
  } catch {
    deps.logger.warn('Token revoke failed; tokens are cleared locally anyway');
  } finally {
    clearTimeout(timer);
  }
}

/** Sign out: revoke, then clear, then return the Builder ID sign-out URL. */
export async function signOut(store: TokenStore, deps: SignOutDeps): Promise<SignOutResult> {
  // Invalidate first: a refresh already running can then no longer write tokens that
  // sign-out would not revoke or clear (finding M2).
  store.invalidate();
  const held = store.load();
  if (held !== undefined) {
    await revoke(held.refreshToken, deps);
  }
  store.clear();
  return { signOutUrl: BUILDER_ID_SIGN_OUT_URL };
}
