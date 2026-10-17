// When the held access token expires, for the sign_in text. Reads the token store only; nothing is
// returned that could be a token.

import type { TokenStore } from '@compass/core/auth';

/** The expiry as an ISO instant, or undefined when nothing is held. */
export function expiryOf(store: Pick<TokenStore, 'load'>): string | undefined {
  const held = store.load();
  return held === undefined ? undefined : new Date(held.accessTokenExpiresAt).toISOString();
}
