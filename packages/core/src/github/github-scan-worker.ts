// The worker thread entry for the GitHub scan. It holds no logic: see github-scan-worker-core.ts.
// Outside a worker `parentPort` is null and importing this file does nothing.

import { parentPort } from 'node:worker_threads';
import { runGitHubScanWorker } from './github-scan-worker-core.js';

runGitHubScanWorker(parentPort);
