// The worker thread entry for the scan. It holds no logic: see scan-worker-core.ts. Outside a worker
// `parentPort` is null and importing this file does nothing.

import { parentPort } from 'node:worker_threads';
import { runScanWorker } from './scan-worker-core.js';

runScanWorker(parentPort);
