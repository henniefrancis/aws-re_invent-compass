// Scans one GitHub repository in a worker thread with a hard wall-clock budget (compass-power task
// 45.1, Requirement P2.9, security review H1).
//
// If the budget is spent, the worker is terminated and `ScanTimeoutError` is thrown, whatever the
// scan was doing. A missing repository rejects with GitHubRepositoryNotFoundError, a rejected
// token with GitHubNotConnectedError, a rate limit with GitHubRateLimitedError, and anything else
// with ScanWorkerError. No error carries the token or the repository name. The worker file is the
// bundled `github-scan-worker.js`; its location is given by the caller.

import { Worker } from 'node:worker_threads';
import { ScanTimeoutError, ScanWorkerError } from '../scanner/scan-in-worker.js';
import type { ScanResult } from '../scanner/scan-repo.js';
import type { ArchiveLimits } from './archive.js';
import {
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  GitHubRepositoryNotFoundError,
  type GitHubError,
} from './errors.js';
import type { GitHubScanReply, GitHubScanRequest } from './github-scan-worker-core.js';

/** The default budget for one repository: 60 seconds. */
export const DEFAULT_GITHUB_SCAN_BUDGET_MS = 60_000;

/** The part of a `Worker` this module uses. */
export interface GitHubWorkerLike {
  once(event: 'message', listener: (reply: GitHubScanReply) => void): unknown;
  once(event: 'error', listener: (error: unknown) => void): unknown;
  once(event: 'exit', listener: (code: number) => void): unknown;
  postMessage(request: GitHubScanRequest): void;
  terminate(): Promise<number>;
}

/** What `scanGitHubRepoInWorker` needs. */
export interface ScanGitHubRepoOptions {
  /** The path of the bundled worker file. */
  workerPath: string;
  budgetMs?: number;
  limits?: Partial<ArchiveLimits>;
  /** Creates the worker (default: a real `worker_threads` Worker). Tests inject a fake. */
  create?: (workerPath: string) => GitHubWorkerLike;
}

/** The heap a GitHub scan worker may use, so a hostile repository cannot take the machine's memory. */
export const GITHUB_WORKER_HEAP_MB = 512;

const realWorker = (workerPath: string): GitHubWorkerLike =>
  new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: GITHUB_WORKER_HEAP_MB } });

/** The error for a failed reply. */
function errorFor(reply: Extract<GitHubScanReply, { ok: false }>): GitHubError | ScanWorkerError {
  switch (reply.failure) {
    case 'notFound':
      return new GitHubRepositoryNotFoundError();
    case 'notConnected':
      return new GitHubNotConnectedError();
    case 'rateLimited':
      return new GitHubRateLimitedError(reply.resetAt);
    default:
      return new ScanWorkerError();
  }
}

/** Scans one repository in a worker, under the budget. */
export function scanGitHubRepoInWorker(
  request: { fullName: string; accessToken: string },
  options: ScanGitHubRepoOptions,
): Promise<ScanResult> {
  const worker = (options.create ?? realWorker)(options.workerPath);
  return new Promise<ScanResult>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        settle();
      }
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new ScanTimeoutError());
      });
    }, options.budgetMs ?? DEFAULT_GITHUB_SCAN_BUDGET_MS);
    worker.once('message', (reply) => {
      finish(() => {
        if (reply.ok) {
          resolve(reply.result);
        } else {
          reject(errorFor(reply));
        }
      });
    });
    worker.once('error', () => {
      finish(() => {
        reject(new ScanWorkerError());
      });
    });
    worker.once('exit', () => {
      finish(() => {
        reject(new ScanWorkerError());
      });
    });
    worker.postMessage({
      fullName: request.fullName,
      accessToken: request.accessToken,
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    });
  });
}
