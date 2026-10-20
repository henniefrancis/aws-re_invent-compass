// The body of the GitHub scan worker (compass-power task 45.1, security review H1). One repository
// is read and analysed in a worker thread so that a wall-clock budget can stop it with
// `terminate()` whatever it is doing (a slow pattern, a huge archive, a stalled download). The
// worker streams the archive with the global fetch, runs `analyseFiles` over it and posts one
// reply: the result, or a failure kind (with the rate-limit reset time when there is one). The
// token, the repository name, file names and contents never appear in a reply.

import { analyseFiles } from '../scanner/scan-repo.js';
import type { ScanResult } from '../scanner/scan-repo.js';
import { readRepositoryArchive, type ArchiveLimits } from './archive.js';
import {
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  GitHubRepositoryNotFoundError,
} from './errors.js';
import { defaultGitHubFetch, type GitHubFetch } from './http.js';

/** What the parent asks for. */
export interface GitHubScanRequest {
  /** `owner/name`. */
  fullName: string;
  accessToken: string;
  limits?: Partial<ArchiveLimits>;
}

/** Why a scan failed, as the parent maps it back to an error. */
export type GitHubScanFailure = 'notFound' | 'notConnected' | 'rateLimited' | 'failed';

/** What the worker answers. */
export type GitHubScanReply =
  { ok: true; result: ScanResult } | { ok: false; failure: GitHubScanFailure; resetAt?: number };

/** The part of a worker `parentPort` the worker body uses. */
export interface GitHubWorkerPort {
  once(event: 'message', listener: (message: GitHubScanRequest) => void): unknown;
  postMessage(reply: GitHubScanReply): void;
}

/** The reply for a failed scan: a kind only, never the error itself. */
function failureReply(error: unknown): GitHubScanReply {
  if (error instanceof GitHubRepositoryNotFoundError) {
    return { ok: false, failure: 'notFound' };
  }
  if (error instanceof GitHubNotConnectedError) {
    return { ok: false, failure: 'notConnected' };
  }
  if (error instanceof GitHubRateLimitedError) {
    return error.resetAt === undefined
      ? { ok: false, failure: 'rateLimited' }
      : { ok: false, failure: 'rateLimited', resetAt: error.resetAt };
  }
  return { ok: false, failure: 'failed' };
}

/**
 * Answers one request on `port`, fetching with `fetch` (the global fetch by default; tests inject
 * a fake). With no port (the module imported outside a worker) it does nothing.
 */
export function runGitHubScanWorker(
  port: GitHubWorkerPort | null,
  fetch: GitHubFetch = defaultGitHubFetch,
): void {
  port?.once('message', (request) => {
    analyseFiles(
      readRepositoryArchive({
        fullName: request.fullName,
        accessToken: request.accessToken,
        fetch,
        ...(request.limits === undefined ? {} : { limits: request.limits }),
      }),
      {},
    ).then(
      (result) => {
        port.postMessage({ ok: true, result });
      },
      (error: unknown) => {
        port.postMessage(failureReply(error));
      },
    );
  });
}
