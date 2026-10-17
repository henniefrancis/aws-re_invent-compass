// A token store that keeps the redacting logger informed (events-client, S1, M4).
//
// The logger can only scrub a token it knows about. Tokens that were stored by an
// earlier process, or loaded from the keychain, were never seen by sign-in or
// refresh, so registering only there leaves a gap. This wrapper registers the access,
// refresh and ID tokens as secrets whenever the store loads or saves them, and
// removes them (with their URL-encoded and form-encoded forms, which the logger
// handles) when the store is cleared. It adds nothing else: every other member
// delegates to the wrapped store.

import type { RedactingLogger } from '../api/redacting-logger.js';
import type { TokenSet, TokenStore } from './token-store.js';

/** Register every token in the set with the logger. */
function register(logger: RedactingLogger, tokens: TokenSet | undefined): void {
  logger.addSecret(tokens?.accessToken);
  logger.addSecret(tokens?.refreshToken);
  logger.addSecret(tokens?.idToken);
}

/** Remove every token in the set from the logger. */
function unregister(logger: RedactingLogger, tokens: TokenSet | undefined): void {
  logger.removeSecret(tokens?.accessToken);
  logger.removeSecret(tokens?.refreshToken);
  logger.removeSecret(tokens?.idToken);
}

/** Wrap a store so its tokens are always registered with (and removed from) the logger. */
export function registerStoreSecrets(store: TokenStore, logger: RedactingLogger): TokenStore {
  return {
    get kind() {
      return store.kind;
    },
    get generation() {
      return store.generation;
    },
    load() {
      const tokens = store.load();
      register(logger, tokens);
      return tokens;
    },
    save(tokens) {
      register(logger, tokens);
      return store.save(tokens);
    },
    replaceIfCurrent(generation, tokens) {
      register(logger, tokens);
      return store.replaceIfCurrent(generation, tokens);
    },
    invalidate() {
      store.invalidate();
    },
    clear() {
      unregister(logger, store.load());
      store.clear();
    },
    clearIfCurrent(generation) {
      const held = store.load();
      const cleared = store.clearIfCurrent(generation);
      if (cleared) {
        unregister(logger, held);
      }
      return cleared;
    },
  };
}
