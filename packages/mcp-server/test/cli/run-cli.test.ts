import { describe, expect, test, vi } from 'vitest';
import { SimulatedModeRefusedError } from '@compass/core/api';
import { runCli, USAGE } from '../../src/cli/run-cli.js';
import type { CliDeps, CliIo } from '../../src/cli/run-cli.js';
import {
  AWSEVENTS_BLOCK_REASON,
  COULD_NOT_CHECK_NOTE,
} from '../../src/hooks/pre-write-guardrail.js';
import type { HookDeps } from '../../src/hooks/pre-write-guardrail.js';
import { CompassError } from '../../src/ports/errors.js';
import type { Runtime } from '../../src/ports/runtime.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';

async function* bytes(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
  await Promise.resolve();
}

function arrange(argv: string[], options: { stdin?: string; env?: Record<string, string> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
  const hookDeps: HookDeps = {
    rules: fake.rules,
    snapshot: fake.snapshot,
    clock: fake.clock,
    catalog: () => fake.events.catalog(),
  };
  const calls = {
    createRuntime: [] as { env: Readonly<Record<string, string | undefined>>; cwd?: string }[],
    startServer: [] as Runtime[],
    cleanup: 0,
    prepared: [] as string[],
  };
  const deps: CliDeps = {
    version: '9.8.7',
    createRuntime: (env, runtimeOptions) => {
      calls.createRuntime.push({
        env,
        ...(runtimeOptions?.cwd === undefined ? {} : { cwd: runtimeOptions.cwd }),
      });
      return Promise.resolve(fake.runtime);
    },
    createHookDeps: () => Promise.resolve(hookDeps),
    startServer: (runtime) => {
      calls.startServer.push(runtime);
      return Promise.resolve();
    },
    prepareWorkspace: (repoPath) => {
      calls.prepared.push(repoPath);
      return Promise.resolve({
        path: '/tmp/workspace',
        cleanup: () => {
          calls.cleanup += 1;
          return Promise.resolve();
        },
      });
    },
    defaultRepoPath: () => Promise.resolve('/bundled/sample-repo'),
  };
  const io: CliIo = {
    argv,
    env: options.env ?? { HOME: '/home/x' },
    stdin: bytes(options.stdin ?? ''),
    stdout: { write: (c) => out.push(c) },
    stderr: { write: (c) => err.push(c) },
  };
  return { io, deps, fake, calls, out: () => out.join(''), err: () => err.join(''), hookDeps };
}

describe('help, version and unknown commands', () => {
  test('--help and -h print the usage on stdout and exit 0', async () => {
    for (const flag of ['--help', '-h']) {
      const t = arrange([flag]);
      expect(await runCli(t.io, t.deps)).toBe(0);
      expect(t.out()).toBe(USAGE);
      expect(t.err()).toBe('');
    }
  });

  test('--version and -v print the version on stdout and exit 0', async () => {
    for (const flag of ['--version', '-v']) {
      const t = arrange([flag]);
      expect(await runCli(t.io, t.deps)).toBe(0);
      expect(t.out()).toBe('9.8.7\n');
    }
  });

  test('an unknown command, unknown flag, extra argument or stray --repo prints the usage on stderr and exits 1', async () => {
    for (const argv of [
      ['frobnicate'],
      ['--bogus'],
      ['demo', 'extra'],
      ['--repo', 'x'],
      ['serve', 'x'],
    ]) {
      const t = arrange(argv);
      expect(await runCli(t.io, t.deps)).toBe(1);
      expect(t.err()).toBe(USAGE);
      expect(t.out()).toBe('');
      expect(t.calls.startServer).toEqual([]);
    }
  });

  test('the usage names every command', () => {
    for (const word of [
      'demo',
      'hook',
      '--version',
      '--help',
      'pre-write-guardrail',
      'post-write-sync',
    ]) {
      expect(USAGE).toContain(word);
    }
  });
});

describe('serving', () => {
  test('no arguments creates the runtime from the environment and starts the server', async () => {
    const t = arrange([], { env: { COMPASS_MODE: 'live', X: '1' } });
    expect(await runCli(t.io, t.deps)).toBe(0);
    expect(t.calls.createRuntime).toEqual([{ env: { COMPASS_MODE: 'live', X: '1' } }]);
    expect(t.calls.startServer).toEqual([t.fake.runtime]);
    expect(t.out()).toBe('');
  });

  test('a start-up failure prints a fixed message and exits 1', async () => {
    const cases: [Error, string][] = [
      [new SimulatedModeRefusedError(), 'Simulated mode is refused in production'],
      [new CompassError('Network'), 'Compass could not reach the service.'],
      [new Error('secret detail'), 'Compass could not start.'],
    ];
    for (const [error, expected] of cases) {
      const t = arrange([]);
      t.deps.createRuntime = () => Promise.reject(error);
      expect(await runCli(t.io, t.deps)).toBe(1);
      expect(t.err()).toContain(expected);
      expect(t.err()).not.toContain('secret detail');
      expect(t.out()).toBe('');
    }
  });

  test('a server that cannot start also exits 1', async () => {
    const t = arrange([]);
    t.deps.startServer = () => Promise.reject(new Error('port in use'));
    expect(await runCli(t.io, t.deps)).toBe(1);
    expect(t.err()).toBe('Compass could not start.\n');
  });
});

describe('the demo command', () => {
  test('forces simulated mode, uses a copy of the repo as the workspace, and cleans it up', async () => {
    const t = arrange(['demo', '--repo', '/my/repo'], {
      env: { COMPASS_MODE: 'live', KEEP: 'yes' },
    });
    const code = await runCli(t.io, t.deps);
    expect(t.calls.prepared).toEqual(['/my/repo']);
    expect(t.calls.createRuntime).toEqual([
      { env: { COMPASS_MODE: 'simulated', KEEP: 'yes' }, cwd: '/tmp/workspace' },
    ]);
    expect(t.calls.cleanup).toBe(1);
    expect(t.out()).toContain('reinvent-compass demo');
    expect(code).toBe(1);
  });

  test('defaults to the bundled sample repo', async () => {
    const t = arrange(['demo']);
    await runCli(t.io, t.deps);
    expect(t.calls.prepared).toEqual(['/bundled/sample-repo']);
  });

  test('a failure while preparing prints a fixed message, exits 1, and has nothing to clean up', async () => {
    const t = arrange(['demo']);
    t.deps.prepareWorkspace = () => Promise.reject(new CompassError('FolderNotFound'));
    expect(await runCli(t.io, t.deps)).toBe(1);
    expect(t.err()).toBe('That folder could not be found.\n');
    expect(t.calls.cleanup).toBe(0);
  });

  test('a runtime that cannot be built exits 1 and still cleans up the workspace', async () => {
    const t = arrange(['demo']);
    t.deps.createRuntime = () => Promise.reject(new SimulatedModeRefusedError());
    expect(await runCli(t.io, t.deps)).toBe(1);
    expect(t.err()).toContain('Simulated mode is refused');
    expect(t.calls.cleanup).toBe(1);
  });
});

describe('the hook command', () => {
  const reserve = JSON.stringify({
    tool_name: 'mcp_awsevents_ReserveSessions',
    tool_input: { sessionIds: ['x'] },
  });

  test('a blocked call exits 2 with the reason on stderr only', async () => {
    const t = arrange(['hook', 'pre-write-guardrail'], { stdin: reserve });
    expect(await runCli(t.io, t.deps)).toBe(2);
    expect(t.err()).toBe(`${AWSEVENTS_BLOCK_REASON}\n`);
    expect(t.out()).toBe('');
  });

  test('a note goes to stdout with exit 0, and the sync hook prints its reminder', async () => {
    const note = arrange(['hook', 'pre-write-guardrail'], { stdin: 'not json' });
    expect(await runCli(note.io, note.deps)).toBe(0);
    expect(note.out()).toBe(`${COULD_NOT_CHECK_NOTE}\n`);
    const sync = arrange(['hook', 'post-write-sync'], {
      stdin: JSON.stringify({ tool_name: 'reserve_with_guardrails' }),
    });
    expect(await runCli(sync.io, sync.deps)).toBe(0);
    expect(sync.out()).toContain('sync_passes');
  });

  test('an unknown hook name, a missing name or extra flags still exit 0', async () => {
    for (const argv of [['hook', 'rm -rf'], ['hook'], ['hook', 'post-write-sync', '--whatever']]) {
      const t = arrange(argv, { stdin: '{}' });
      expect(await runCli(t.io, t.deps)).toBe(0);
    }
    const unknown = arrange(['hook', 'nope']);
    await runCli(unknown.io, unknown.deps);
    expect(unknown.err()).toContain('Unknown hook name');
  });

  test('a hook that cannot build its dependencies fails open with the right output', async () => {
    const pre = arrange(['hook', 'pre-write-guardrail'], { stdin: reserve });
    pre.deps.createHookDeps = () => Promise.reject(new Error('no venues file'));
    expect(await runCli(pre.io, pre.deps)).toBe(0);
    expect(pre.out()).toBe(`${COULD_NOT_CHECK_NOTE}\n`);
    const post = arrange(['hook', 'post-write-sync'], { stdin: reserve });
    post.deps.createHookDeps = () => Promise.reject(new Error('no venues file'));
    expect(await runCli(post.io, post.deps)).toBe(0);
    expect(post.out()).toBe('');
  });

  test('a hook never creates a runtime, starts a server or prepares a workspace', async () => {
    const t = arrange(['hook', 'pre-write-guardrail'], { stdin: reserve });
    const spy = vi.spyOn(t.deps, 'createRuntime');
    await runCli(t.io, t.deps);
    expect(spy).not.toHaveBeenCalled();
    expect(t.calls.startServer).toEqual([]);
    expect(t.calls.prepared).toEqual([]);
  });
});
