// The GitHub_Token_Store (compass-power task 45.1, Requirement P2.9).
//
// Holds the GitHub access and refresh tokens, each in its own OS keychain entry through
// @napi-rs/keyring (service "reinvent-compass", accounts "github-access" and "github-refresh"),
// each entry built with { linux: { store: 'secret-service' } } so the kernel keyutils store is
// never used. The access token is stored with its expiry as "<expiresAtMs>:<token>", as the
// Events store does; a token with no expiry is stored bare (a GitHub token starts with "ghu_",
// never with digits and a colon, so the forms cannot be confused).
//
// If the keychain is unavailable or ANY keychain call throws, the store holds the tokens in
// process memory only and makes a best-effort delete of both entries. Nothing is ever written to
// a file. `registerGitHubSecrets` wraps a store so every token it loads or saves is registered
// with the redacting logger, and `getAccessToken` refreshes a token close to expiry. The keyring
// is injected so tests never touch the real OS keychain.

import { Entry } from '@napi-rs/keyring';
import type { RedactingLogger } from '../api/redacting-logger.js';
import type { KeyringEntryLike, KeyringLike, StorageKind } from '../auth/token-store.js';
import { refreshGitHubToken, type GitHubTokens } from './device-flow.js';
import { GitHubNotConnectedError } from './errors.js';
import type { GitHubFetch } from './http.js';

/** The keychain service name for both entries (shared with the Events store). */
export const GITHUB_KEYCHAIN_SERVICE = 'reinvent-compass';

/** The keychain account name for each GitHub token. */
export const GITHUB_KEYCHAIN_ACCOUNTS = {
  access: 'github-access',
  refresh: 'github-refresh',
} as const;

/** Refresh when the access token has this many seconds or fewer left. */
export const GITHUB_REFRESH_WINDOW_SECONDS = 60;

/** The GitHub token store. */
export interface GitHubTokenStore {
  /** Where tokens are held now. Becomes 'memory' after any keychain failure. */
  readonly kind: StorageKind;
  /** The held tokens, or undefined when GitHub is not connected. */
  load(): GitHubTokens | undefined;
  /** Store the tokens. Returns 'memory' if the keychain failed and memory is used. */
  save(tokens: GitHubTokens): StorageKind;
  /** Remove both tokens. Empties memory even if a delete throws. */
  clear(): void;
}

/** What `createGitHubTokenStore` accepts. */
export interface GitHubTokenStoreOptions {
  /** The keyring module (default: the real @napi-rs/keyring). Tests inject a fake. */
  keyring?: KeyringLike;
  /** The keychain service name (default reinvent-compass). */
  service?: string;
}

const ENTRY_OPTIONS = { linux: { store: 'secret-service' as const } };

/** The real keyring module. Tests inject a fake instead. */
const realKeyring: KeyringLike = { Entry };

interface Entries {
  access: KeyringEntryLike;
  refresh: KeyringEntryLike;
}

/** Build both entries, or undefined when the keychain cannot be used. */
function buildEntries(keyring: KeyringLike, service: string): Entries | undefined {
  try {
    return {
      access: new keyring.Entry(service, GITHUB_KEYCHAIN_ACCOUNTS.access, ENTRY_OPTIONS),
      refresh: new keyring.Entry(service, GITHUB_KEYCHAIN_ACCOUNTS.refresh, ENTRY_OPTIONS),
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

/** Delete both entries, swallowing each failure so one error never blocks the other. */
function deleteAll(entries: Entries): void {
  for (const entry of [entries.access, entries.refresh]) {
    try {
      entry.deleteCredential();
    } catch {
      // Best effort only: a failed delete must not stop the other or the caller.
    }
  }
}

/** Split a stored access value into the token and its expiry, if it has one. */
function splitAccess(stored: string): { token: string; expiresAt: number | undefined } {
  const separator = stored.indexOf(':');
  if (separator > 0 && /^\d{1,16}$/.test(stored.slice(0, separator))) {
    return { token: stored.slice(separator + 1), expiresAt: Number(stored.slice(0, separator)) };
  }
  return { token: stored, expiresAt: undefined };
}

/** Create the GitHub token store. */
export function createGitHubTokenStore(options: GitHubTokenStoreOptions = {}): GitHubTokenStore {
  const entries = buildEntries(
    options.keyring ?? realKeyring,
    options.service ?? GITHUB_KEYCHAIN_SERVICE,
  );
  let kind: StorageKind = entries === undefined ? 'memory' : 'keychain';
  let memory: GitHubTokens | undefined;

  /** Switch to memory only after a keychain failure, removing any leftovers. */
  function fallBack(held: Entries): void {
    kind = 'memory';
    deleteAll(held);
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
        if (storedAccess === undefined) {
          return undefined;
        }
        const refreshToken = getSecret(entries.refresh);
        const access = splitAccess(storedAccess);
        return {
          accessToken: access.token,
          ...(refreshToken === undefined ? {} : { refreshToken }),
          ...(access.expiresAt === undefined ? {} : { accessTokenExpiresAt: access.expiresAt }),
        };
      } catch {
        fallBack(entries);
        return undefined;
      }
    },

    save(tokens) {
      if (kind === 'keychain' && entries !== undefined) {
        try {
          const access =
            tokens.accessTokenExpiresAt === undefined
              ? tokens.accessToken
              : `${String(tokens.accessTokenExpiresAt)}:${tokens.accessToken}`;
          entries.access.setSecret(Buffer.from(access, 'utf8'));
          if (tokens.refreshToken === undefined) {
            entries.refresh.deleteCredential();
          } else {
            entries.refresh.setSecret(Buffer.from(tokens.refreshToken, 'utf8'));
          }
          memory = undefined;
          return 'keychain';
        } catch {
          fallBack(entries);
        }
      }
      memory = { ...tokens };
      return 'memory';
    },

    clear() {
      memory = undefined;
      if (entries !== undefined) {
        deleteAll(entries);
      }
    },
  };
}

/** Register (or remove) every token of a set with the logger. */
function register(logger: RedactingLogger, tokens: GitHubTokens | undefined): void {
  logger.addSecret(tokens?.accessToken);
  logger.addSecret(tokens?.refreshToken);
}

/**
 * Wrap a store so every token it loads or saves is registered with the redacting logger, and
 * removed from it when the store is cleared. Every other member delegates.
 */
export function registerGitHubSecrets(
  store: GitHubTokenStore,
  logger: RedactingLogger,
): GitHubTokenStore {
  return {
    get kind() {
      return store.kind;
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
    clear() {
      const held = store.load();
      logger.removeSecret(held?.accessToken);
      logger.removeSecret(held?.refreshToken);
      store.clear();
    },
  };
}

/** What `getAccessToken` needs. */
export interface GetAccessTokenOptions {
  store: GitHubTokenStore;
  clientId: string;
  fetch: GitHubFetch;
  now: () => number;
}

/** Refreshes in progress, keyed by the refresh token they use, so a rotation runs once. */
const inFlight = new Map<string, Promise<GitHubTokens>>();

/** Refresh with `refreshToken` once, sharing a refresh already running for it. */
function refreshOnce(refreshToken: string, options: GetAccessTokenOptions): Promise<GitHubTokens> {
  const running = inFlight.get(refreshToken);
  if (running !== undefined) {
    return running;
  }
  const started = refreshGitHubToken({
    clientId: options.clientId,
    refreshToken,
    fetch: options.fetch,
    now: options.now,
  })
    .then((fresh) => {
      const tokens = { ...fresh, refreshToken: fresh.refreshToken ?? refreshToken };
      // Save only if the store still holds the pair this refresh started from, so a refresh that
      // ends after disconnect (or after a new sign-in) can never bring tokens back.
      if (options.store.load()?.refreshToken === refreshToken) {
        options.store.save(tokens);
      }
      return tokens;
    })
    .finally(() => {
      inFlight.delete(refreshToken);
    });
  inFlight.set(refreshToken, started);
  return started;
}

/**
 * The access token to use now. It is refreshed (and the new pair saved) when it has 60 seconds
 * or fewer left. Throws GitHubNotConnectedError when no token is held, when an expired token
 * has no refresh token, or when GitHub rejects the refresh token (the store is then cleared).
 * Any other refresh failure falls back to the current token while it is still valid, and is
 * thrown otherwise.
 */
export async function getAccessToken(options: GetAccessTokenOptions): Promise<string> {
  const held = options.store.load();
  if (held === undefined) {
    throw new GitHubNotConnectedError();
  }
  const expiresAt = held.accessTokenExpiresAt;
  const now = options.now();
  if (expiresAt === undefined || expiresAt - now > GITHUB_REFRESH_WINDOW_SECONDS * 1000) {
    return held.accessToken;
  }
  if (held.refreshToken === undefined) {
    if (expiresAt > now) {
      return held.accessToken;
    }
    throw new GitHubNotConnectedError();
  }
  try {
    return (await refreshOnce(held.refreshToken, options)).accessToken;
  } catch (error) {
    if (error instanceof GitHubNotConnectedError) {
      options.store.clear();
      throw error;
    }
    if (expiresAt > now) {
      return held.accessToken;
    }
    throw error;
  }
}
