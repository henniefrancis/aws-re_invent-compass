import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runScanWorker } from '../../src/scanner/scan-worker-core.js';
import type { ScanReply, ScanRequest, WorkerPort } from '../../src/scanner/scan-worker-core.js';
import {
  DEFAULT_SCAN_BUDGET_MS,
  scanInWorker,
  ScanTimeoutError,
  ScanWorkerError,
} from '../../src/scanner/scan-in-worker.js';
import type { WorkerLike } from '../../src/scanner/scan-in-worker.js';
import { FolderNotFoundError } from '../../src/scanner/walker.js';
import { repoRoot } from '../support/repo-root.js';

describe('runScanWorker', () => {
  function fakePort() {
    let listener: ((request: ScanRequest) => void) | undefined;
    const replies: ScanReply[] = [];
    const port: WorkerPort = {
      once: (_event, fn) => {
        listener = fn;
      },
      postMessage: (reply) => {
        replies.push(reply);
      },
    };
    const send = async (request: ScanRequest): Promise<ScanReply> => {
      listener?.(request);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const reply = replies.shift();
      if (reply === undefined) {
        throw new Error('no reply');
      }
      return reply;
    };
    return { port, send };
  }

  test('does nothing without a port, and the entry file is harmless outside a worker', async () => {
    expect(() => {
      runScanWorker(null);
    }).not.toThrow();
    await expect(import('../../src/scanner/scan-worker.js')).resolves.toBeDefined();
  });

  test('replies with the result for a folder, with a flag for a missing folder, and for any other failure', async () => {
    const { port, send } = fakePort();
    runScanWorker(port);
    const ok = await send({ root: join(repoRoot(), 'fixtures', 'sample-repo') });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.result.services.length).toBeGreaterThan(0);
    }

    const second = fakePort();
    runScanWorker(second.port);
    expect(await second.send({ root: join(repoRoot(), 'no-such-folder') })).toEqual({
      ok: false,
      folderNotFound: true,
    });

    const third = fakePort();
    runScanWorker(third.port);
    const limits = Object.defineProperty({}, 'maxFiles', {
      enumerable: true,
      get: () => {
        throw new Error('broken limits');
      },
    });
    expect(await third.send({ root: repoRoot(), limits })).toEqual({
      ok: false,
      folderNotFound: false,
    });
  });
});

describe('scanInWorker with a fake worker', () => {
  type Events = {
    message?: (r: ScanReply) => void;
    error?: (e: unknown) => void;
    exit?: (c: number) => void;
  };
  function fake(onPost: (events: Events) => void) {
    const events: Events = {};
    const state = { terminated: 0, posted: [] as ScanRequest[] };
    const worker: WorkerLike = {
      once: (event: 'message' | 'error' | 'exit', fn: never) => {
        (events as Record<string, unknown>)[event] = fn;
      },
      postMessage: (request) => {
        state.posted.push(request);
        setTimeout(() => {
          onPost(events);
        }, 5);
      },
      terminate: () => {
        state.terminated += 1;
        return Promise.resolve(0);
      },
    };
    return { create: () => worker, state };
  }

  const result = { services: [], unmappedCount: 0 } as never;

  test('resolves with the result and terminates the worker', async () => {
    const f = fake((e) => e.message?.({ ok: true, result }));
    const got = await scanInWorker('/x', {
      workerPath: 'w.js',
      create: f.create,
      limits: { maxFiles: 3 },
    });
    expect(got).toBe(result);
    expect(f.state.terminated).toBe(1);
    expect(f.state.posted).toEqual([{ root: '/x', limits: { maxFiles: 3 } }]);
  });

  test('a missing folder, a worker error, an early exit and a failed scan reject with fixed errors', async () => {
    await expect(
      scanInWorker('/x', {
        workerPath: 'w.js',
        create: fake((e) => e.message?.({ ok: false, folderNotFound: true })).create,
      }),
    ).rejects.toBeInstanceOf(FolderNotFoundError);
    await expect(
      scanInWorker('/x', {
        workerPath: 'w.js',
        create: fake((e) => e.message?.({ ok: false, folderNotFound: false })).create,
      }),
    ).rejects.toBeInstanceOf(ScanWorkerError);
    await expect(
      scanInWorker('/x', {
        workerPath: 'w.js',
        create: fake((e) => e.error?.(new Error('secret path'))).create,
      }),
    ).rejects.toMatchObject({ message: 'The scan could not be completed.' });
    await expect(
      scanInWorker('/x', { workerPath: 'w.js', create: fake((e) => e.exit?.(1)).create }),
    ).rejects.toBeInstanceOf(ScanWorkerError);
  });

  test('a second event after the first is ignored', async () => {
    const f = fake((e) => {
      e.message?.({ ok: true, result });
      e.exit?.(0);
      e.error?.(new Error('late'));
    });
    await expect(scanInWorker('/x', { workerPath: 'w.js', create: f.create })).resolves.toBe(
      result,
    );
    expect(f.state.terminated).toBe(1);
  });

  test('a scan that outlives its budget is terminated and times out', async () => {
    const f = fake(() => undefined);
    await expect(
      scanInWorker('/x', { workerPath: 'w.js', create: f.create, budgetMs: 30 }),
    ).rejects.toBeInstanceOf(ScanTimeoutError);
    expect(f.state.terminated).toBe(1);
    expect(DEFAULT_SCAN_BUDGET_MS).toBe(20_000);
  });
});

describe('scanInWorker with a real worker thread', () => {
  let temp: string;
  let workerPath: string;
  let hangPath: string;

  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'compass-worker-'));
    workerPath = join(temp, 'scan-worker.mjs');
    await build({
      entryPoints: [join(repoRoot(), 'packages', 'core', 'src', 'scanner', 'scan-worker.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: workerPath,
      logLevel: 'silent',
    });
    hangPath = join(temp, 'hang.mjs');
    await writeFile(hangPath, 'for (;;) {}\n');
  });
  afterAll(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  test('scans a folder in the worker and returns the same result as the in-process scan', async () => {
    const root = join(repoRoot(), 'fixtures', 'sample-repo');
    const result = await scanInWorker(root, { workerPath });
    expect(result.services.map((s) => s.key)).toEqual(['dynamodb', 'lambda', 's3', 'sns', 'sqs']);
    expect(result.pythonAnalysed).toBe(true);
  });

  test('a missing folder is reported without echoing the path', async () => {
    const missing = join(temp, 'very-secret-folder');
    await expect(scanInWorker(missing, { workerPath })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof FolderNotFoundError && !String(error.message).includes('secret'),
    );
  });

  test('a worker that never answers is terminated within the budget', async () => {
    const started = performance.now();
    await expect(
      scanInWorker(temp, { workerPath: hangPath, budgetMs: 300 }),
    ).rejects.toBeInstanceOf(ScanTimeoutError);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  test('a worker file that cannot be loaded is a fixed error', async () => {
    await mkdir(join(temp, 'empty'), { recursive: true });
    await expect(
      scanInWorker(temp, { workerPath: join(temp, 'missing-worker.mjs'), budgetMs: 2000 }),
    ).rejects.toBeInstanceOf(ScanWorkerError);
  });
});
