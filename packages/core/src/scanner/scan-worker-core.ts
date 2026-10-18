// The body of the scan worker (security review H1). The scan runs in a worker thread so that a
// wall-clock budget can stop it with `terminate()` whatever it is doing. The worker builds its own
// read-only file system (functions cannot cross the thread boundary), runs `scanRepo` and posts
// one reply: the result, or a flag saying the folder was not found. File names and contents never
// appear in a reply, only what `scanRepo` already returns.

import { createNodeScanFs } from './scan-fs.js';
import { scanRepo } from './scan-repo.js';
import type { ScanResult } from './scan-repo.js';
import { FolderNotFoundError } from './walker.js';
import type { WalkLimits } from './walker.js';

/** What the parent asks for. */
export interface ScanRequest {
  root: string;
  limits?: Partial<WalkLimits>;
}

/** What the worker answers. */
export type ScanReply = { ok: true; result: ScanResult } | { ok: false; folderNotFound: boolean };

/** The part of a worker `parentPort` the worker body uses. */
export interface WorkerPort {
  once(event: 'message', listener: (message: ScanRequest) => void): unknown;
  postMessage(reply: ScanReply): void;
}

/** Answers one request on `port`. With no port (the module imported outside a worker) it does nothing. */
export function runScanWorker(port: WorkerPort | null): void {
  port?.once('message', (request) => {
    scanRepo(request.root, {
      fs: createNodeScanFs(),
      ...(request.limits === undefined ? {} : { limits: request.limits }),
    }).then(
      (result) => {
        port.postMessage({ ok: true, result });
      },
      (error: unknown) => {
        port.postMessage({ ok: false, folderNotFound: error instanceof FolderNotFoundError });
      },
    );
  });
}
