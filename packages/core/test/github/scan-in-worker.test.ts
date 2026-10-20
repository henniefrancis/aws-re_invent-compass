import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  GitHubRepositoryNotFoundError,
} from '../../src/github/errors.js';
import { runGitHubScanWorker } from '../../src/github/github-scan-worker-core.js';
import type {
  GitHubScanReply,
  GitHubScanRequest,
  GitHubWorkerPort,
} from '../../src/github/github-scan-worker-core.js';
import type { GitHubFetch, GitHubResponseLike } from '../../src/github/http.js';
import {
  DEFAULT_GITHUB_SCAN_BUDGET_MS,
  scanGitHubRepoInWorker,
  type GitHubWorkerLike,
} from '../../src/github/scan-in-worker.js';
import { ScanTimeoutError, ScanWorkerError } from '../../src/scanner/scan-in-worker.js';
import { repoRoot } from '../support/repo-root.js';
import {
  SECRET_ACCESS,
  TOP,
  errorText,
  fakeFetch,
  githubTarball,
  gzip,
  jsonResponse,
  streamResponse,
  tarEntry,
} from './support.js';

const CODELOAD = 'https://codeload.github.com/octo/hello/legacy.tar.gz/refs/heads/main';

/** A fake GitHub whose API answers `api` and whose codeload serves `archive`. */
function github(api: GitHubResponseLike, archive = new Uint8Array(0)): GitHubFetch {
  return fakeFetch((url) =>
    url.startsWith('https://api.github.com/') ? api : streamResponse(200, archive),
  ).fetch;
}

describe('runGitHubScanWorker', () => {
  function fakePort() {
    let listener: ((request: GitHubScanRequest) => void) | undefined;
    const replies: GitHubScanReply[] = [];
    const port: GitHubWorkerPort = {
      once: (_event, fn) => {
        listener = fn;
      },
      postMessage: (reply) => {
        replies.push(reply);
      },
    };
    const send = async (request: GitHubScanRequest): Promise<GitHubScanReply> => {
      listener?.(request);
      for (let i = 0; i < 100 && replies.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const reply = replies.shift();
      if (reply === undefined) {
        throw new Error('no reply');
      }
      return reply;
    };
    return { port, send };
  }

  const request = { fullName: 'octo/hello', accessToken: SECRET_ACCESS };

  test('does nothing without a port, and the entry file is harmless outside a worker', async () => {
    expect(() => {
      runGitHubScanWorker(null);
    }).not.toThrow();
    await expect(import('../../src/github/github-scan-worker.js')).resolves.toBeDefined();
  });

  test('reads the archive, analyses it and replies with the result only', async () => {
    const archive = gzip(
      githubTarball([
        tarEntry(
          `${TOP}/src/app.ts`,
          "import { S3Client } from '@aws-sdk/client-s3';\nexport const s3 = new S3Client({});\n",
        ),
        tarEntry(`${TOP}/package.json`, '{"dependencies":{"@aws-sdk/client-s3":"3.0.0"}}'),
      ]),
    );
    const { port, send } = fakePort();
    runGitHubScanWorker(port, github(jsonResponse(302, '', { location: CODELOAD }), archive));
    const reply = await send({ ...request, limits: { maxFiles: 10 } });
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.result.services.map((s) => s.key)).toContain('s3');
      expect(reply.result.filesRead).toBe(2);
    }
    expect(JSON.stringify(reply)).not.toContain(SECRET_ACCESS);
    expect(JSON.stringify(reply)).not.toContain('app.ts');
  });

  test('maps each failure to a kind, keeping only the reset time of a rate limit', async () => {
    const reply = async (api: GitHubResponseLike, fullName = 'octo/hello') => {
      const { port, send } = fakePort();
      runGitHubScanWorker(port, github(api));
      return send({ fullName, accessToken: SECRET_ACCESS });
    };
    expect(await reply(jsonResponse(404, ''))).toEqual({ ok: false, failure: 'notFound' });
    expect(await reply(jsonResponse(200, ''), 'not a name')).toEqual({
      ok: false,
      failure: 'notFound',
    });
    expect(await reply(jsonResponse(401, ''))).toEqual({ ok: false, failure: 'notConnected' });
    expect(await reply(jsonResponse(429, ''))).toEqual({ ok: false, failure: 'rateLimited' });
    expect(
      await reply(
        jsonResponse(403, '', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
      ),
    ).toEqual({ ok: false, failure: 'rateLimited', resetAt: 1_700_000_000_000 });
    expect(await reply(jsonResponse(500, SECRET_ACCESS))).toEqual({ ok: false, failure: 'failed' });
  });
});

describe('scanGitHubRepoInWorker with a fake worker', () => {
  type Events = {
    message?: (r: GitHubScanReply) => void;
    error?: (e: unknown) => void;
    exit?: (c: number) => void;
  };
  function fake(onPost: (events: Events) => void) {
    const events: Events = {};
    const state = { terminated: 0, posted: [] as GitHubScanRequest[] };
    const worker: GitHubWorkerLike = {
      once: (event: 'message' | 'error' | 'exit', fn: never) => {
        (events as Record<string, unknown>)[event] = fn;
      },
      postMessage: (message) => {
        state.posted.push(message);
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
  const request = { fullName: 'octo/hello', accessToken: SECRET_ACCESS };

  test('posts the request, resolves with the result and terminates the worker', async () => {
    const f = fake((e) => e.message?.({ ok: true, result }));
    const got = await scanGitHubRepoInWorker(request, {
      workerPath: 'w.js',
      create: f.create,
      limits: { maxFiles: 3 },
    });
    expect(got).toBe(result);
    expect(f.state.terminated).toBe(1);
    expect(f.state.posted).toEqual([{ ...request, limits: { maxFiles: 3 } }]);
  });

  test('each failure kind rejects with its typed error, none carrying the token', async () => {
    const failing = async (onPost: (events: Events) => void): Promise<unknown> => {
      const error = await scanGitHubRepoInWorker(request, {
        workerPath: 'w.js',
        create: fake(onPost).create,
      }).catch((e: unknown) => e);
      expect(errorText(error)).not.toContain(SECRET_ACCESS);
      expect(errorText(error)).not.toContain('octo/hello');
      return error;
    };
    expect(await failing((e) => e.message?.({ ok: false, failure: 'notFound' }))).toBeInstanceOf(
      GitHubRepositoryNotFoundError,
    );
    expect(
      await failing((e) => e.message?.({ ok: false, failure: 'notConnected' })),
    ).toBeInstanceOf(GitHubNotConnectedError);
    const limited = await failing((e) =>
      e.message?.({ ok: false, failure: 'rateLimited', resetAt: 42 }),
    );
    expect(limited).toBeInstanceOf(GitHubRateLimitedError);
    expect((limited as GitHubRateLimitedError).resetAt).toBe(42);
    expect(await failing((e) => e.message?.({ ok: false, failure: 'failed' }))).toBeInstanceOf(
      ScanWorkerError,
    );
    expect(await failing((e) => e.error?.(new Error(SECRET_ACCESS)))).toBeInstanceOf(
      ScanWorkerError,
    );
    expect(await failing((e) => e.exit?.(1))).toBeInstanceOf(ScanWorkerError);
  });

  test('a second event after the first is ignored', async () => {
    const f = fake((e) => {
      e.message?.({ ok: true, result });
      e.exit?.(0);
      e.error?.(new Error('late'));
    });
    await expect(
      scanGitHubRepoInWorker(request, { workerPath: 'w.js', create: f.create }),
    ).resolves.toBe(result);
    expect(f.state.terminated).toBe(1);
  });

  test('a scan that outlives its budget is terminated and times out; the default is 60 seconds', async () => {
    const f = fake(() => undefined);
    await expect(
      scanGitHubRepoInWorker(request, { workerPath: 'w.js', create: f.create, budgetMs: 30 }),
    ).rejects.toBeInstanceOf(ScanTimeoutError);
    expect(f.state.terminated).toBe(1);
    expect(DEFAULT_GITHUB_SCAN_BUDGET_MS).toBe(60_000);
  });
});

describe('scanGitHubRepoInWorker with a real worker thread', () => {
  let temp: string;
  let workerPath: string;
  let hangPath: string;

  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'compass-github-worker-'));
    workerPath = join(temp, 'github-scan-worker.mjs');
    await build({
      entryPoints: [join(repoRoot(), 'packages', 'core', 'src', 'github', 'github-scan-worker.ts')],
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

  test('the bundled worker answers a malformed name as not found, without any request', async () => {
    await expect(
      scanGitHubRepoInWorker({ fullName: '../etc', accessToken: SECRET_ACCESS }, { workerPath }),
    ).rejects.toBeInstanceOf(GitHubRepositoryNotFoundError);
  });

  test('a worker that never answers is terminated within the budget', async () => {
    const started = performance.now();
    await expect(
      scanGitHubRepoInWorker(
        { fullName: 'octo/hello', accessToken: SECRET_ACCESS },
        { workerPath: hangPath, budgetMs: 300 },
      ),
    ).rejects.toBeInstanceOf(ScanTimeoutError);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  test('a worker file that cannot be loaded is a fixed error', async () => {
    await expect(
      scanGitHubRepoInWorker(
        { fullName: 'octo/hello', accessToken: SECRET_ACCESS },
        { workerPath: join(temp, 'missing-worker.mjs'), budgetMs: 2000 },
      ),
    ).rejects.toBeInstanceOf(ScanWorkerError);
  });
});
