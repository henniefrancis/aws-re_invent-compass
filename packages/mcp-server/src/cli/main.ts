// The production wiring behind `bin.ts`: builds the runtime environment from the process values and
// calls `runCli`. Everything that touches the machine can be replaced through `host`, so this is
// tested with fakes; `bin.ts` passes nothing but the process values.

import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { prepareWorkspace } from '../demo/workspace-copy.js';
import { createHookDeps } from '../runtime/hook-deps.js';
import { createRuntime } from '../runtime/create-runtime.js';
import type { RuntimeEnvironment } from '../runtime/create-runtime.js';
import {
  findOptionalResource,
  findPackageRoot,
  findResource,
  FIXTURES_LOCATION,
  SAMPLE_REPO_LOCATION,
  GITHUB_WORKER_LOCATION,
  SCAN_WORKER_LOCATION,
  VENUES_LOCATION,
} from '../runtime/resources.js';
import type { ExecFileLike } from '../runtime/browser-opener.js';
import type { StdinLimits } from '../hooks/read-stdin.js';
import { runCli } from './run-cli.js';
import { startStdioServer } from './stdio.js';

/** The process values `bin.ts` passes in. */
export interface MainIo {
  argv: string[];
  env: Readonly<Record<string, string | undefined>>;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

/** Machine values that default to the real ones and that tests replace. */
export interface Host {
  homeDir?: string;
  platform?: string;
  cwd?: string;
  execFile?: ExecFileLike;
  /** The URL of a module inside the package; the package root and its resources are found from it. */
  moduleUrl?: string;
  tempRoot?: string;
  /** Ends the process (default `process.exit`). Only a hook uses it. */
  exit?: (code: number) => void;
  /** Shortens the hook's stdin limits in tests. */
  hookLimits?: StdinLimits;
}

/** The real process launcher, used only to open the sign-in page. */
export const defaultExecFile: ExecFileLike = (file, args, callback) =>
  execFile(file, args, callback);

const exists = async (url: URL): Promise<boolean> => {
  try {
    await stat(url);
    return true;
  } catch {
    return false;
  }
};

/** The package version, read from the `package.json` in the package root. */
export async function readVersion(packageRoot: URL): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8')) as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Ignores a broken pipe on an output stream, for example `reinvent-compass demo | head`. The reader
 * is gone, so the writes are lost, but the command carries on and finishes its own clean-up (the
 * demo's temporary workspace) instead of dying with an unhandled stream error (QA low).
 */
export function ignoreBrokenPipe(stream: Writable): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') {
      throw error;
    }
  });
}

/** Resolves once everything written so far has been handed to the stream's destination. */
function flush(stream: Writable): Promise<void> {
  return new Promise((resolve) => {
    stream.write('', () => {
      resolve();
    });
  });
}

/** Runs the command line with the real machine behind it and returns the exit code. */
export async function main(io: MainIo, host: Host = {}): Promise<number> {
  ignoreBrokenPipe(io.stdout);
  ignoreBrokenPipe(io.stderr);
  const root = await findPackageRoot(host.moduleUrl ?? import.meta.url, exists);
  const version = await readVersion(root);
  const environment = async (): Promise<RuntimeEnvironment> => {
    const worker = await findOptionalResource(root, SCAN_WORKER_LOCATION, exists);
    const githubWorker = await findOptionalResource(root, GITHUB_WORKER_LOCATION, exists);
    const fixtures = await findOptionalResource(root, FIXTURES_LOCATION, exists);
    return {
      homeDir: host.homeDir ?? homedir(),
      platform: host.platform ?? process.platform,
      cwd: host.cwd ?? process.cwd(),
      version,
      stderr: io.stderr,
      execFile: host.execFile ?? defaultExecFile,
      venuesPath: fileURLToPath(await findResource(root, VENUES_LOCATION, exists)),
      ...(worker === undefined ? {} : { scanWorkerPath: fileURLToPath(worker) }),
      ...(githubWorker === undefined ? {} : { githubWorkerPath: fileURLToPath(githubWorker) }),
      ...(fixtures === undefined ? {} : { fixturesRoot: fileURLToPath(fixtures) }),
    };
  };
  const code = await runCli(
    { argv: io.argv, env: io.env, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr },
    {
      version,
      createRuntime: async (env, options) => createRuntime(await environment(), env, options),
      createHookDeps: async (env) => createHookDeps(await environment(), env),
      startServer: (runtime) => startStdioServer(runtime, io.stdin, io.stdout),
      prepareWorkspace: (repoPath) =>
        prepareWorkspace(repoPath, host.tempRoot === undefined ? {} : { tempRoot: host.tempRoot }),
      defaultRepoPath: async () =>
        fileURLToPath(await findResource(root, SAMPLE_REPO_LOCATION, exists)),
      ...(host.hookLimits === undefined ? {} : { hookLimits: host.hookLimits }),
    },
  );
  if (io.argv[0] === 'hook') {
    // A hook ends the process itself: stdin may still be open (a client that never closes it), and
    // an open stdin would keep the process alive past the hook's time limit (QA M6).
    io.stdin.destroy();
    await Promise.all([flush(io.stdout), flush(io.stderr)]);
    (host.exit ?? process.exit)(code);
  }
  return code;
}
