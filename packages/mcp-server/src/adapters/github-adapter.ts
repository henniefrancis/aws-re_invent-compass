// The live GitHub port (compass-power task 45, Requirements P2.8 and P2.9) over `@compass/core/github`.
// The device sign-in starts on `connect` and is polled in the background, so the tool answers at
// once with the code; the tokens go to the GitHub_Token_Store (keychain, redacted). Listing and
// reading go through the core client and the scan worker, which only ever reach github.com,
// api.github.com and codeload.github.com. Core errors become fixed CompassError codes, so no token,
// repository name or upstream text rides on an error.

import {
  createGitHubClient,
  getAccessToken,
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  startDeviceFlow,
  waitForDeviceToken,
} from '@compass/core/github';
import type { GitHubFetch, GitHubTokenStore } from '@compass/core/github';
import type { ScanResult } from '@compass/core/scanner';
import type { GitHubAppConfig } from '../config/github.js';
import { CompassError } from '../ports/errors.js';
import type { GitHubConnection, GitHubPort, GitHubRepositoryRef } from '../ports/github-port.js';

/** What the adapter is built from. */
export interface GitHubAdapterDeps {
  /** Undefined when the build has no GitHub App, so nothing is ever sent. */
  config: GitHubAppConfig | undefined;
  store: GitHubTokenStore;
  fetch: GitHubFetch;
  openBrowser: (url: string) => void;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Reads one repository under the scan budget (the worker in production). */
  scanRepository: (fullName: string, accessToken: string) => Promise<ScanResult>;
}

type Pending = {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  abort: AbortController;
};

/** Maps a core error from a GitHub request to a fixed CompassError. */
export function toCompassError(error: unknown, now: () => number = Date.now): CompassError {
  if (error instanceof CompassError) {
    return error;
  }
  if (error instanceof GitHubNotConnectedError) {
    return new CompassError('GitHubNotConnected');
  }
  if (error instanceof GitHubRateLimitedError) {
    return new CompassError('RateLimited', {
      ...(error.resetAt === undefined
        ? {}
        : { retryAfterSeconds: Math.max(1, Math.ceil((error.resetAt - now()) / 1000)) }),
    });
  }
  return new CompassError('Network');
}

/** Creates the live GitHub port. */
export function createGitHubAdapter(deps: GitHubAdapterDeps): GitHubPort {
  const { config } = deps;
  let pending: Pending | undefined;
  let failure: 'denied' | 'expired' | 'error' | undefined;
  /** A connect that is still asking GitHub for a code; a second call joins it (security review L2). */
  let starting: Promise<GitHubConnection> | undefined;

  const accessToken = (clientId: string): Promise<string> =>
    getAccessToken({ store: deps.store, clientId, fetch: deps.fetch, now: deps.now });

  const status = (): GitHubConnection => {
    if (config === undefined) {
      return { state: 'notConfigured' };
    }
    if (pending !== undefined) {
      return {
        state: 'waiting',
        userCode: pending.userCode,
        verificationUri: pending.verificationUri,
        expiresAt: new Date(pending.expiresAt).toISOString(),
      };
    }
    if (failure !== undefined) {
      return { state: 'failed', reason: failure };
    }
    return deps.store.load() === undefined ? { state: 'disconnected' } : { state: 'connected' };
  };

  const finish = (mine: Pending, result: Awaited<ReturnType<typeof waitForDeviceToken>>): void => {
    if (pending !== mine) {
      return;
    }
    pending = undefined;
    if (result.status === 'ok') {
      deps.store.save(result.tokens);
      failure = undefined;
    } else {
      failure =
        result.status === 'denied' ? 'denied' : result.status === 'expired' ? 'expired' : 'error';
    }
  };

  const begin = async (app: GitHubAppConfig): Promise<GitHubConnection> => {
    failure = undefined;
    let start;
    try {
      start = await startDeviceFlow({ clientId: app.clientId, fetch: deps.fetch });
    } catch {
      failure = 'error';
      return status();
    }
    const mine: Pending = {
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresAt: deps.now() + start.expiresIn * 1000,
      abort: new AbortController(),
    };
    pending = mine;
    deps.openBrowser(start.verificationUri);
    void waitForDeviceToken({
      clientId: app.clientId,
      deviceCode: start.deviceCode,
      interval: start.interval,
      expiresAt: mine.expiresAt,
      fetch: deps.fetch,
      sleep: deps.sleep,
      now: deps.now,
      signal: mine.abort.signal,
    }).then(
      (result) => {
        finish(mine, result);
      },
      () => {
        finish(mine, { status: 'failed', reason: 'unknown_error' });
      },
    );
    return status();
  };

  return {
    installUrl: config?.installUrl,
    status,
    connect: () => {
      const current = status();
      if (config === undefined || current.state === 'waiting' || current.state === 'connected') {
        return Promise.resolve(current);
      }
      starting ??= begin(config).finally(() => {
        starting = undefined;
      });
      return starting;
    },
    listRepositories: async () => {
      if (config === undefined) {
        throw new CompassError('GitHubNotConnected');
      }
      try {
        const client = createGitHubClient({
          fetch: deps.fetch,
          accessToken: () => accessToken(config.clientId),
        });
        return (await client.listRepositories()).map((repo): GitHubRepositoryRef => ({
          id: repo.id,
          fullName: repo.fullName,
          owner: repo.owner,
          fork: repo.fork,
          archived: repo.archived,
        }));
      } catch (error) {
        throw toCompassError(error, deps.now);
      }
    },
    scanRepository: async (repository) => {
      if (config === undefined) {
        throw new CompassError('GitHubNotConnected');
      }
      let token: string;
      try {
        token = await accessToken(config.clientId);
      } catch (error) {
        throw toCompassError(error, deps.now);
      }
      try {
        return await deps.scanRepository(repository.fullName, token);
      } catch (error) {
        throw toCompassError(error, deps.now);
      }
    },
    disconnect: () => {
      pending?.abort.abort();
      pending = undefined;
      failure = undefined;
      deps.store.clear();
    },
  };
}
