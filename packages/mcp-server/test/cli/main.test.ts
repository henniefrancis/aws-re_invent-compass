import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { defaultExecFile, main, readVersion } from '../../src/cli/main.js';
import type { Host, MainIo } from '../../src/cli/main.js';
import { startStdioServer } from '../../src/cli/stdio.js';
import * as pkg from '../../src/index.js';
import { DEMO_STEP_TITLES } from '../../src/demo/run-demo.js';
import { createRuntime } from '../../src/runtime/create-runtime.js';
import { connect } from '../support/connect.js';
import { installNetworkGuard } from '../support/network-guard.js';
import type { NetworkGuard } from '../support/network-guard.js';
import { repoRoot } from '../support/fake-catalog.js';
import { testEnvironment } from '../support/runtime-env.js';

let temp: string;
let guard: NetworkGuard;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'compass-main-'));
  guard = installNetworkGuard();
});
afterEach(async () => {
  guard.restore();
  await rm(temp, { recursive: true, force: true });
});

function io(
  argv: string[],
  env: Record<string, string> = {},
  stdinText = '',
): MainIo & {
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const stdin = new PassThrough();
  stdin.end(stdinText);
  const stdout = new PassThrough();
  stdout.on('data', (chunk: Buffer) => out.push(chunk.toString()));
  const stderr = new PassThrough();
  stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
  return { argv, env, stdin, stdout, stderr, out, err };
}

const host = (): Host => ({
  homeDir: join(temp, 'home'),
  platform: 'linux',
  cwd: temp,
  tempRoot: temp,
});

describe('readVersion', () => {
  test('reads the version from the package.json in the package root', async () => {
    const dir = join(temp, 'pkg');
    await mkdir(dir, { recursive: true });
    const moduleUrl = new URL('./', pathToFileURL(join(dir, 'x')));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '3.2.1' }));
    expect(await readVersion(moduleUrl)).toBe('3.2.1');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: 5 }));
    expect(await readVersion(moduleUrl)).toBe('unknown');
    await writeFile(join(dir, 'package.json'), 'not json');
    expect(await readVersion(moduleUrl)).toBe('unknown');
    await rm(join(dir, 'package.json'));
    expect(await readVersion(moduleUrl)).toBe('unknown');
  });
});

describe('main', () => {
  test('--version prints the version of this package', async () => {
    const t = io(['--version']);
    const manifest = JSON.parse(
      await readFile(join(repoRoot(), 'packages', 'mcp-server', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(await main(t, host())).toBe(0);
    expect(t.out.join('')).toBe(`${manifest.version}\n`);
  });

  test('the hook command reads stdin and prints the reminder with exit 0', async () => {
    const t = io(
      ['hook', 'post-write-sync'],
      {},
      JSON.stringify({ tool_name: 'reserve_with_guardrails' }),
    );
    expect(await main(t, {})).toBe(0);
    expect(t.out.join('')).toContain('sync_passes');
  });

  test('the demo runs end to end with the real simulated stack, on a copy of the bundled sample repo', async () => {
    const t = io(['demo'], { COMPASS_MODE: 'live' });
    const code = await main(t, { homeDir: join(temp, 'home'), platform: 'linux', cwd: temp });
    expect(t.err.join('')).toBe(['SIMULATED MODE: no real data', ''].join('\n'));
    expect(code).toBe(0);
    const headings = [...t.out.join('').matchAll(/^Step \d+ of 10: (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([...DEMO_STEP_TITLES]);
    expect(guard.attempts).toEqual([]);
  });

  test('the demo accepts a folder with --repo and leaves it untouched', async () => {
    const sample = join(repoRoot(), 'fixtures', 'sample-repo');
    const t = io(['demo', '--repo', sample]);
    expect(await main(t, host())).toBe(0);
    expect(t.out.join('')).toContain('The demo finished.');
    expect(guard.attempts).toEqual([]);
  });

  test('the demo fails with exit 1 for a folder that does not exist', async () => {
    const t = io(['demo', '--repo', join(temp, 'missing')]);
    expect(await main(t, host())).toBe(1);
    expect(t.err.join('')).toContain('That folder could not be found.');
  });

  test('serving answers MCP requests on stdout and nothing else goes there', async () => {
    const t = io([], { COMPASS_MODE: 'simulated' });
    const stdin = new PassThrough();
    const served = { ...t, stdin };
    expect(await main(served, host())).toBe(0);
    const lines: string[] = [];
    served.stdout.on('data', (chunk: Buffer) => lines.push(chunk.toString()));
    stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    stdin.end();
    const messages = (t.out.join('') + lines.join(''))
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } });
    expect(messages.every((m) => 'result' in m || 'method' in m)).toBe(true);
    expect(messages.find((m) => m.id === 2)?.result?.tools).toHaveLength(17);
  });

  test('a start-up failure exits 1 with a fixed message', async () => {
    const t = io([], { COMPASS_MODE: 'simulated', NODE_ENV: 'production' });
    expect(await main(t, host())).toBe(1);
    expect(t.err.join('')).toContain('Simulated mode is refused in production');
    expect(t.out.join('')).toBe('');
  });
});

describe('startStdioServer and the package surface', () => {
  test('connects a server to the given streams', async () => {
    const env = await testEnvironment();
    const runtime = await createRuntime(env.environment, { COMPASS_MODE: 'simulated' });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    await startStdioServer(runtime, stdin, stdout);
    stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(chunks.join('')).toContain('"reinvent-compass"');
    stdin.end();
  });

  test('the package exports the server, the CLI, the demo and the runtime factory', async () => {
    expect(Object.keys(pkg).sort()).toEqual(
      ['createCompassServer', 'createRuntime', 'runCli', 'runDemo', 'runStdioServer'].sort(),
    );
    const env = await testEnvironment();
    const runtime = await pkg.createRuntime(env.environment, { COMPASS_MODE: 'simulated' });
    const conn = await connect(runtime);
    expect((await conn.call('sign_in')).isError).not.toBe(true);
    await conn.close();
  });

  test('the default launcher runs a real program and reports success', async () => {
    const result = await new Promise<Error | null>((resolve) => {
      defaultExecFile(process.execPath, ['--version'], resolve);
    });
    expect(result).toBeNull();
  });
});

describe('main with a built package layout', () => {
  test('finds the bundled scan worker, venue list and sample repo next to the compiled code', async () => {
    const { build } = await import('esbuild');
    const { cp, mkdir, writeFile } = await import('node:fs/promises');
    const pkg = join(temp, 'pkg');
    await mkdir(join(pkg, 'dist', 'cli'), { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ version: '4.5.6' }));
    await build({
      entryPoints: [join(repoRoot(), 'packages', 'core', 'src', 'scanner', 'scan-worker.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: join(pkg, 'dist', 'scan-worker.js'),
      logLevel: 'silent',
    });
    await cp(join(repoRoot(), 'data'), join(pkg, 'dist', 'data'), { recursive: true });
    await cp(join(repoRoot(), 'fixtures', 'sample-repo'), join(pkg, 'dist', 'sample-repo'), {
      recursive: true,
    });
    await cp(join(repoRoot(), 'fixtures', 'api'), join(pkg, 'dist', 'fixtures', 'api'), {
      recursive: true,
    });
    await cp(
      join(repoRoot(), 'fixtures', 'synthetic'),
      join(pkg, 'dist', 'fixtures', 'synthetic'),
      { recursive: true },
    );
    const moduleUrl = pathToFileURL(join(pkg, 'dist', 'cli', 'main.js')).href;
    const version = io(['--version']);
    expect(await main(version, { ...host(), moduleUrl })).toBe(0);
    expect(version.out.join('')).toBe('4.5.6\n');
    const t = io(['demo']);
    expect(await main(t, { ...host(), moduleUrl })).toBe(0);
    expect(t.out.join('')).toContain('The demo finished.');
  });
});

describe('main with a package that has no worker and no fixtures folder', () => {
  test('falls back to the in-thread scan and the default simulated fixtures', async () => {
    const { cp, mkdir, writeFile } = await import('node:fs/promises');
    const pkg = join(temp, 'lean');
    await mkdir(join(pkg, 'dist', 'cli'), { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    await cp(join(repoRoot(), 'data'), join(pkg, 'dist', 'data'), { recursive: true });
    await cp(join(repoRoot(), 'fixtures', 'sample-repo'), join(pkg, 'dist', 'sample-repo'), {
      recursive: true,
    });
    const moduleUrl = pathToFileURL(join(pkg, 'dist', 'cli', 'main.js')).href;
    const t = io(['demo']);
    expect(await main(t, { ...host(), moduleUrl })).toBe(0);
    expect(t.out.join('')).toContain('The demo finished.');
  });
});
