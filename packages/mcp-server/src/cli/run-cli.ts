// The command line (Requirements 18.1 to 18.8). `runCli` is the one tested function that `bin.ts`
// hands the process values to. It never calls `process.exit`: it returns the exit code.
//
//   reinvent-compass                    start the Compass server on stdio
//   reinvent-compass demo [--repo dir]  run the simulated flow
//   reinvent-compass hook <name>        what a Kiro hook calls (stdin only, exits 0 or 2)
//   reinvent-compass --version | --help
//
// A `hook` command exits only with 0 or 2 and starts no shell and no subprocess. Anything the
// hook cannot judge fails open. An unknown command prints the usage on stderr and exits 1.

import { parseArgs } from 'node:util';
import { ClientConfigError, SIMULATED_MODE } from '@compass/core/api';
import { runDemo } from '../demo/run-demo.js';
import type { Workspace } from '../demo/workspace-copy.js';
import { COULD_NOT_CHECK_NOTE } from '../hooks/pre-write-guardrail.js';
import type { HookDeps } from '../hooks/pre-write-guardrail.js';
import { isHookName, runHook } from '../hooks/run-hook.js';
import type { StdinLimits } from '../hooks/read-stdin.js';
import { CompassError } from '../ports/errors.js';
import type { Runtime } from '../ports/runtime.js';
import { messageFor } from '../server/error-messages.js';

/** Anything with a string `write`, such as `process.stdout`. */
export interface Output {
  write(chunk: string): unknown;
}

/** The process values `bin.ts` passes in. */
export interface CliIo {
  argv: string[];
  env: Readonly<Record<string, string | undefined>>;
  stdin: AsyncIterable<Uint8Array>;
  stdout: Output;
  stderr: Output;
}

/** What the commands need from the machine. */
export interface CliDeps {
  version: string;
  createRuntime(
    env: Readonly<Record<string, string | undefined>>,
    options?: { cwd?: string },
  ): Promise<Runtime>;
  createHookDeps(env: Readonly<Record<string, string | undefined>>): Promise<HookDeps>;
  /** Connects the server to stdio and resolves once connected. */
  startServer(runtime: Runtime): Promise<void>;
  /** Copies the folder the demo scans into a temporary workspace. */
  prepareWorkspace(repoPath: string): Promise<Workspace>;
  /** The sample repo that ships with the package. */
  defaultRepoPath(): Promise<string>;
  /** The hook's stdin limits (default 1 MiB and 5 seconds); tests shorten them. */
  hookLimits?: StdinLimits;
}

/** The usage text. */
export const USAGE = [
  'reinvent-compass: plan your re:Invent week with guardrails.',
  '',
  'Usage:',
  '  reinvent-compass                     start the Compass server on stdio',
  '  reinvent-compass demo [--repo <dir>] run the simulated demo (no network)',
  '  reinvent-compass hook <name>         run a Kiro hook: pre-write-guardrail or post-write-sync',
  '  reinvent-compass --version           print the version',
  '  reinvent-compass --help              print this text',
  '',
].join('\n');

/** The message for a start-up failure. It never carries upstream free text. */
function startupMessage(error: unknown): string {
  if (error instanceof ClientConfigError) {
    return error.message;
  }
  return error instanceof CompassError ? messageFor(error) : 'Compass could not start.';
}

async function runHookCommand(name: string, io: CliIo, deps: CliDeps): Promise<number> {
  if (!isHookName(name)) {
    io.stderr.write('Unknown hook name. Use pre-write-guardrail or post-write-sync.\n');
    return 0;
  }
  let decision;
  try {
    decision = await runHook(name, io.stdin, await deps.createHookDeps(io.env), deps.hookLimits);
  } catch {
    decision =
      name === 'pre-write-guardrail'
        ? { exitCode: 0 as const, stdout: COULD_NOT_CHECK_NOTE }
        : { exitCode: 0 as const };
  }
  if (decision.stdout !== undefined) {
    io.stdout.write(`${decision.stdout}\n`);
  }
  if (decision.stderr !== undefined) {
    io.stderr.write(`${decision.stderr}\n`);
  }
  return decision.exitCode;
}

async function runDemoCommand(repo: string | undefined, io: CliIo, deps: CliDeps): Promise<number> {
  let workspace: Workspace | undefined;
  try {
    const source = repo ?? (await deps.defaultRepoPath());
    workspace = await deps.prepareWorkspace(source);
    const runtime = await deps.createRuntime(
      { ...io.env, COMPASS_MODE: SIMULATED_MODE },
      { cwd: workspace.path },
    );
    return await runDemo(io, runtime, { repoPath: workspace.path });
  } catch (error) {
    io.stderr.write(`${startupMessage(error)}\n`);
    return 1;
  } finally {
    await workspace?.cleanup();
  }
}

/** Runs the command line and returns the exit code. */
export async function runCli(io: CliIo, deps: CliDeps): Promise<number> {
  // A hook never reads flags and never exits with anything but 0 or 2, so it is dispatched first.
  if (io.argv[0] === 'hook') {
    return runHookCommand(io.argv[1] ?? '', io, deps);
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: io.argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        repo: { type: 'string' },
      },
    });
  } catch {
    io.stderr.write(USAGE);
    return 1;
  }
  const { values, positionals } = parsed;
  const [command, argument] = positionals;

  if (values.help === true) {
    io.stdout.write(USAGE);
    return 0;
  }
  if (values.version === true) {
    io.stdout.write(`${deps.version}\n`);
    return 0;
  }
  if (command === 'demo' && argument === undefined) {
    return runDemoCommand(values.repo, io, deps);
  }
  if (command === undefined && values.repo === undefined) {
    try {
      await deps.startServer(await deps.createRuntime(io.env));
      return 0;
    } catch (error) {
      io.stderr.write(`${startupMessage(error)}\n`);
      return 1;
    }
  }
  io.stderr.write(USAGE);
  return 1;
}
