import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  execSync: vi.fn(),
  fork: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('node:child_process', () => spies);

const { main } = await import('../../src/cli/main.js');

let temp: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'compass-nospawn-'));
  vi.clearAllMocks();
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe('hook commands never start a process', () => {
  test('both hooks, with blocking and non-blocking input, spawn nothing', async () => {
    const inputs: [string, string, number][] = [
      ['pre-write-guardrail', JSON.stringify({ tool_name: 'mcp_awsevents_ReserveSessions' }), 2],
      ['pre-write-guardrail', 'not json', 0],
      ['post-write-sync', JSON.stringify({ tool_name: 'reserve_with_guardrails' }), 0],
      ['post-write-sync', '', 0],
    ];
    for (const [name, stdinText, expected] of inputs) {
      const stdin = new PassThrough();
      stdin.end(stdinText);
      const code = await main(
        {
          argv: ['hook', name],
          env: {},
          stdin,
          stdout: new PassThrough(),
          stderr: new PassThrough(),
        },
        { homeDir: join(temp, 'home'), platform: 'linux', cwd: temp },
      );
      expect(code).toBe(expected);
    }
    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
