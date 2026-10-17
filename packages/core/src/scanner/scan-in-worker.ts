// Runs the scan in a worker thread with a hard wall-clock budget (security review H1 and M6).
//
// If the budget is spent, the worker is terminated and `ScanTimeoutError` is thrown, whatever the
// scan was doing (a slow pattern, a huge tree, a stuck file system). The error carries no path.
// The worker file is the bundled `scan-worker.js`; its location is given by the caller.

import { Worker } from 'node:worker_threads';
import type { ScanReply, ScanRequest } from './scan-worker-core.js';
import type { ScanResult } from './scan-repo.js';
import { FolderNotFoundError } from './walker.js';
import type { WalkLimits } from './walker.js';

/** The default budget for a whole scan: 20 seconds. */
export const DEFAULT_SCAN_BUDGET_MS = 20_000;

/** The scan did not finish inside its budget and was stopped. */
export class ScanTimeoutError extends Error {
  constructor() {
    super('The scan took too long and was stopped.');
    this.name = 'ScanTimeoutError';
  }
}

/** The scan worker failed in a way that is not a missing folder. */
export class ScanWorkerError extends Error {
  constructor() {
    super('The scan could not be completed.');
    this.name = 'ScanWorkerError';
  }
}

/** The part of a `Worker` this module uses. */
export interface WorkerLike {
  once(event: 'message', listener: (reply: ScanReply) => void): unknown;
  once(event: 'error', listener: (error: unknown) => void): unknown;
  once(event: 'exit', listener: (code: number) => void): unknown;
  postMessage(request: ScanRequest): void;
  terminate(): Promise<number>;
}

/** What `scanInWorker` needs. */
export interface ScanInWorkerOptions {
  /** The path of the bundled worker file. */
  workerPath: string;
  budgetMs?: number;
  limits?: Partial<WalkLimits>;
  /** Creates the worker (default: a real `worker_threads` Worker). Tests inject a fake. */
  create?: (workerPath: string) => WorkerLike;
}

const realWorker = (workerPath: string): WorkerLike => new Worker(workerPath);

/** Scans `root` in a worker. Rejects with FolderNotFoundError, ScanTimeoutError or ScanWorkerError. */
export function scanInWorker(root: string, options: ScanInWorkerOptions): Promise<ScanResult> {
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
    }, options.budgetMs ?? DEFAULT_SCAN_BUDGET_MS);
    worker.once('message', (reply) => {
      finish(() => {
        if (reply.ok) {
          resolve(reply.result);
        } else {
          reject(reply.folderNotFound ? new FolderNotFoundError() : new ScanWorkerError());
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
      root,
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    });
  });
}
