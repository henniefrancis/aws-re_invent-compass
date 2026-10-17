// Token store with keychain and memory fallback (events-client, S1, task 10.1).
//
// Holds the access, refresh and ID tokens. Each token lives in its own OS keychain
// entry through @napi-rs/keyring (service "reinvent-compass", accounts "access",
// "refresh" and "id"), each entry built with { linux: { store: 'secret-service' } }
// so the kernel keyutils store is never used (Requirement 2.1). Secrets are written
// as UTF-8 bytes with setSecret and read back with getSecret.
//
// Failure handling (Requirements 2.2, 2.4, 2.6): if the keychain is unavailable or
// ANY keychain call throws (including a TooLong error), the store falls back to
// holding the tokens in process memory only and makes a best-effort delete of all
// three entries so a half-written set cannot linger. Nothing is ever written to a
// file: this module imports no file or path API. The fallback is reported by kind
// and by the value returned from save, never by anything containing a token.
//
// The access token expiry (derived from expires_in, never from decoding a JWT) is
// stored in the same keychain entry as the access token, as "<expiresAtMs>:<token>"
// (QA L9), so it survives a restart and the account names stay the three the spec
// fixes. A value without that prefix (written by an earlier version) is read as a
// bare token with an unknown expiry of 0, which makes the first use refresh it. A JWT
// never starts with digits and a colon, so the two forms cannot be confused.
//
// The keyring is injected so tests never touch the real OS keychain.

import { Entry } from '@napi-rs/keyring';

/** The three tokens and the access token expiry, in epoch milliseconds. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accessTokenExpiresAt: number;
}

/** Where the tokens are currently held. */
export type StorageKind = 'keychain' | 'memory';

/** The token store. */
export interface TokenStore {
  /** Where tokens are held now. Becomes 'memory' after any keychain failure. */
  readonly kind: StorageKind;
  /** The held tokens, or undefined when not signed in. */
  load(): TokenSet | undefined;
  /**
   * Store the tokens of a new sign-in. Returns 'memory' if the keychain failed and
   * memory is used. A sign-in save starts a new generation, so any refresh that began
   * earlier can no longer write.
   */
  save(tokens: TokenSet): StorageKind;
  /** Remove every token and start a new generation. Empties memory even if a delete throws. */
  clear(): void;
  /**
   * The current generation. It changes on every sign-in save, clear and invalidate. A
   * refresh records it when it starts and may only write or clear if it is unchanged.
   */
  readonly generation: number;
  /** Start a new generation without touching the tokens (used when sign-out begins). */
  invalidate(): void;
  /**
   * Store refreshed tokens only if the generation is still `generation`. Returns the
   * storage kind, or undefined (and writes nothing) when the generation has moved on.
   */
  replaceIfCurrent(generation: number, tokens: TokenSet): StorageKind | undefined;
  /** Clear the tokens only if the generation is still `generation`; true if cleared. */
  clearIfCurrent(generation: number): boolean;
}

/** The part of a keyring Entry this store uses. */
export interface KeyringEntryLike {
  setSecret(secret: Uint8Array): void;
  getSecret(): number[] | null;
  deleteCredential(): boolean;
}

/** The part of the @napi-rs/keyring module this store uses. */
export interface KeyringLike {
  Entry: new (
    service: string,
    username: string,
    options?: { linux?: { store?: 'secret-service' | 'keyutils' } } | null,
  ) => KeyringEntryLike;
}

/** The keychain service name for every entry. */
export const KEYCHAIN_SERVICE = 'reinvent-compass';

/** The keychain account name for each token. */
export const KEYCHAIN_ACCOUNTS = { access: 'access', refresh: 'refresh', id: 'id' } as const;

const ENTRY_OPTIONS = { linux: { store: 'secret-service' as const } };

/** The real keyring module. Tests inject a fake instead. */
const realKeyring: KeyringLike = { Entry };

interface Entries {
  access: KeyringEntryLike;
  refresh: KeyringEntryLike;
  id: KeyringEntryLike;
}

/** Build the three entries, or undefined when the keychain cannot be used. */
function buildEntries(keyring: KeyringLike, service: string): Entries | undefined {
  try {
    const make = (account: string): KeyringEntryLike =>
      new keyring.Entry(service, account, ENTRY_OPTIONS);
    return {
      access: make(KEYCHAIN_ACCOUNTS.access),
      refresh: make(KEYCHAIN_ACCOUNTS.refresh),
      id: make(KEYCHAIN_ACCOUNTS.id),
    };
  } catch {
    return undefined;
  }
}

/** Read one secret as UTF-8 text, or undefined when the entry is empty. */
function getSecret(entry: KeyringEntryLike): string | undefined {
  const bytes = entry.getSecret();
  return bytes === null ? undefined : Buffer.from(bytes).toString('utf8');
}

/** Split a stored access value into the token and its expiry (0 when there is none). */
function splitAccess(stored: string): { token: string; expiresAt: number } {
  const separator = stored.indexOf(':');
  if (separator > 0 && /^\d{1,16}$/.test(stored.slice(0, separator))) {
    return { token: stored.slice(separator + 1), expiresAt: Number(stored.slice(0, separator)) };
  }
  return { token: stored, expiresAt: 0 };
}

/** Write one secret as UTF-8 bytes. */
function setSecret(entry: KeyringEntryLike, value: string): void {
  entry.setSecret(Buffer.from(value, 'utf8'));
}

/** Delete every entry, swallowing each failure so one error never blocks the rest. */
function deleteAll(entries: Entries): void {
  for (const entry of [entries.access, entries.refresh, entries.id]) {
    try {
      entry.deleteCredential();
    } catch {
      // Best effort only: a failed delete must not stop the others or the caller.
    }
  }
}

/**
 * Create the token store. The keyring is injected for tests; the default is real. The
 * keychain service name defaults to reinvent-compass; the live smoke tests pass a
 * separate name (reinvent-compass-livetest) so they never touch the real session.
 */
export function createTokenStore(
  keyring: KeyringLike = realKeyring,
  service: string = KEYCHAIN_SERVICE,
): TokenStore {
  const entries = buildEntries(keyring, service);
  let kind: StorageKind = entries === undefined ? 'memory' : 'keychain';
  let memory: TokenSet | undefined;
  let generation = 0;

  /** Switch to memory only after a keychain failure, removing any leftovers. */
  function fallBack(held: Entries): void {
    kind = 'memory';
    deleteAll(held);
  }

  /** Write the tokens to the keychain, or to memory after a keychain failure. */
  function write(tokens: TokenSet): StorageKind {
    if (kind === 'keychain' && entries !== undefined) {
      try {
        setSecret(entries.access, `${String(tokens.accessTokenExpiresAt)}:${tokens.accessToken}`);
        setSecret(entries.refresh, tokens.refreshToken);
        setSecret(entries.id, tokens.idToken);
        memory = undefined;
        return 'keychain';
      } catch {
        fallBack(entries);
      }
    }
    memory = { ...tokens };
    return 'memory';
  }

  /** Remove every token and start a new generation. */
  function wipe(): void {
    generation += 1;
    memory = undefined;
    if (entries !== undefined) {
      deleteAll(entries);
    }
  }

  return {
    get kind() {
      return kind;
    },

    load() {
      if (kind === 'memory' || entries === undefined) {
        return memory === undefined ? undefined : { ...memory };
      }
      try {
        const storedAccess = getSecret(entries.access);
        const refreshToken = getSecret(entries.refresh);
        const idToken = getSecret(entries.id);
        if (storedAccess === undefined || refreshToken === undefined || idToken === undefined) {
          return undefined;
        }
        const access = splitAccess(storedAccess);
        return {
          accessToken: access.token,
          refreshToken,
          idToken,
          accessTokenExpiresAt: access.expiresAt,
        };
      } catch {
        fallBack(entries);
        return undefined;
      }
    },

    save(tokens) {
      generation += 1;
      return write(tokens);
    },

    clear() {
      wipe();
    },

    get generation() {
      return generation;
    },

    invalidate() {
      generation += 1;
    },

    replaceIfCurrent(expected, tokens) {
      return expected === generation ? write(tokens) : undefined;
    },

    clearIfCurrent(expected) {
      if (expected !== generation) {
        return false;
      }
      wipe();
      return true;
    },
  };
}
