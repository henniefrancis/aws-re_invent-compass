import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { repoRoot } from '../support/fake-catalog.js';

const run = promisify(execFile);

interface Built {
  extracted: string;
  holder: string;
  scratch: string;
  entries: string[];
}

let built: Built;
const packageDir = join(repoRoot(), 'packages', 'mcp-server');
const version = (
  JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string }
).version;

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(path, base)));
    } else {
      out.push(
        path
          .slice(base.length + 1)
          .split('\\')
          .join('/'),
      );
    }
  }
  return out.sort();
}

describe('the packed package (QA H2, security M1)', () => {
  beforeAll(async () => {
    const { buildPackage } = (await import(
      pathToFileURL(join(packageDir, 'scripts', 'build.mjs')).href
    )) as { buildPackage: () => Promise<string> };
    await buildPackage();
    const scratch = await mkdtemp(join(tmpdir(), 'compass-pack-'));
    await run('npm', ['pack', '--pack-destination', scratch, '--silent'], {
      cwd: packageDir,
      shell: true,
    });
    // The extracted copy sits inside the repository's node_modules folder so that the one external
    // dependency (the native keyring) resolves from the repository, as it would after an install.
    const holder = await mkdtemp(join(repoRoot(), 'node_modules', '.compass-pack-smoke-'));
    // The archive is named relative to its folder because GNU tar reads `C:` as a remote host.
    await run(
      'tar',
      ['-xzf', `reinvent-compass-${version}.tgz`, '-C', holder.replaceAll('\\', '/')],
      {
        cwd: scratch,
      },
    );
    const extracted = join(holder, 'package');
    built = { extracted, holder, scratch, entries: await listFiles(extracted) };
  }, 180_000);

  afterAll(async () => {
    await rm(built.holder, { recursive: true, force: true });
    await rm(built.scratch, { recursive: true, force: true });
  });

  test('contains the bundle, the worker, the resources and the README, and nothing else', () => {
    expect(built.entries).toContain('dist/bin.js');
    expect(built.entries).toContain('dist/scan-worker.js');
    expect(built.entries).toContain('dist/data/venues.json');
    expect(built.entries).toContain('dist/sample-repo/infra/main.tf');
    expect(built.entries).toContain('dist/fixtures/api/get-event/success.json');
    expect(built.entries).toContain('dist/fixtures/synthetic/catalog.json');
    expect(built.entries).toContain('package.json');
    expect(built.entries).toContain('README.md');
    for (const entry of built.entries) {
      expect(entry, entry).toMatch(
        /^(dist\/(bin\.js|scan-worker\.js|data\/|sample-repo\/|fixtures\/)|package\.json$|README\.md$)/,
      );
      expect(entry).not.toMatch(/\.ts$|dist\/tsc|\/test\//);
    }
  });

  test('declares only the native keyring as a dependency and bundles everything else', async () => {
    const manifest = JSON.parse(await readFile(join(built.extracted, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      private: boolean;
      bin: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({ '@napi-rs/keyring': '2.1.1' });
    expect(manifest.private).toBe(true);
    expect(manifest.bin).toEqual({ 'reinvent-compass': 'dist/bin.js' });
    for (const file of ['bin.js', 'scan-worker.js']) {
      const text = await readFile(join(built.extracted, 'dist', file), 'utf8');
      expect(text.startsWith(file === 'bin.js' ? '#!/usr/bin/env node\n' : 'import')).toBe(true);
      const imports = [...text.matchAll(/^import\s[^;]*?from\s*["']([^"']+)["']/gm)].map(
        (m) => m[1],
      );
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${String(specifier)}`).toMatch(
          /^node:|^@napi-rs\/keyring$/,
        );
      }
    }
  });

  test('runs --version from the extracted folder', async () => {
    const { stdout } = await run(process.execPath, [
      join(built.extracted, 'dist', 'bin.js'),
      '--version',
    ]);
    expect(stdout).toBe(`${version}\n`);
  });

  test('runs the whole demo from the extracted folder with its own bundle, worker and data', async () => {
    const home = await mkdtemp(join(tmpdir(), 'compass-pack-home-'));
    try {
      const { stdout, stderr } = await run(
        process.execPath,
        [join(built.extracted, 'dist', 'bin.js'), 'demo'],
        {
          cwd: home,
          timeout: 120_000,
          env: {
            PATH: process.env.PATH ?? '',
            SystemRoot: process.env.SystemRoot ?? '',
            HOME: home,
            USERPROFILE: home,
            APPDATA: home,
            LOCALAPPDATA: home,
            XDG_DATA_HOME: home,
            NODE_ENV: 'test',
          },
        },
      );
      const headings = [...stdout.matchAll(/^Step (\d+) of 10: (.+)$/gm)];
      expect(headings).toHaveLength(10);
      expect(stdout).toContain('The demo finished. Every step worked.');
      expect(stderr).toBe(['SIMULATED MODE: no real data', ''].join('\n'));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test('a hook exits within six seconds with its code even when stdin stays open (QA M6)', async () => {
    const started = performance.now();
    const result = await new Promise<{ code: number | null; elapsed: number }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [join(built.extracted, 'dist', 'bin.js'), 'hook', 'post-write-sync'],
          {
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('the hook did not exit'));
        }, 20_000);
        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve({ code, elapsed: performance.now() - started });
        });
        // stdin is left open on purpose: nothing is written and it is never ended.
      },
    );
    expect(result.code).toBe(0);
    expect(result.elapsed).toBeLessThan(6000);
  }, 30_000);

  test('a dry run of npm pack, as the publish workflow does it, passes the file list check', async () => {
    const { stdout } = await run(
      'npm',
      ['pack', '--dry-run', '--json', '--workspace', 'packages/mcp-server'],
      { cwd: repoRoot(), shell: true },
    );
    const { checkPackFiles, pathsFromPackJson } = (await import(
      pathToFileURL(join(packageDir, 'scripts', 'check-pack.mjs')).href
    )) as { checkPackFiles: (p: string[]) => string[]; pathsFromPackJson: (t: string) => string[] };
    expect(checkPackFiles(pathsFromPackJson(stdout))).toEqual([]);
  }, 120_000);
});
