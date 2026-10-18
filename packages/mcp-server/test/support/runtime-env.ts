import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KeyringEntryLike, KeyringLike } from '@compass/core/auth';
import type { RuntimeEnvironment } from '../../src/runtime/create-runtime.js';
import { repoRoot } from './fake-catalog.js';

/** An in-memory OS keychain, so no test touches the real one. */
export function memoryKeyring(): KeyringLike {
  const secrets = new Map<string, number[]>();
  class Entry implements KeyringEntryLike {
    constructor(
      _service: string,
      private readonly account: string,
    ) {}
    setSecret(secret: Uint8Array): void {
      secrets.set(this.account, [...secret]);
    }
    getSecret(): number[] | null {
      return secrets.get(this.account) ?? null;
    }
    deleteCredential(): boolean {
      return secrets.delete(this.account);
    }
  }
  return { Entry };
}

/** A RuntimeEnvironment over a fresh temporary home and workspace, recording stderr and launches. */
export interface TestEnvironment {
  environment: RuntimeEnvironment;
  home: string;
  workspace: string;
  stderr: string[];
  launched: { file: string; args: string[] }[];
}

/** Builds the environment. Nothing in it can reach the real home folder or launch a process. */
export async function testEnvironment(
  overrides: Partial<RuntimeEnvironment> = {},
): Promise<TestEnvironment> {
  const temp = await mkdtemp(join(tmpdir(), 'compass-runtime-'));
  const home = join(temp, 'home');
  const workspace = join(temp, 'workspace');
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const stderr: string[] = [];
  const launched: { file: string; args: string[] }[] = [];
  return {
    home,
    workspace,
    stderr,
    launched,
    environment: {
      homeDir: home,
      platform: 'linux',
      cwd: workspace,
      version: '1.2.3',
      stderr: { write: (chunk) => stderr.push(chunk) },
      execFile: (file, args, callback) => {
        launched.push({ file, args });
        callback(null);
      },
      venuesPath: join(repoRoot(), 'data', 'venues.json'),
      ...overrides,
    },
  };
}
