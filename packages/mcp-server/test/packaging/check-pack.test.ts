import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { repoRoot } from '../support/fake-catalog.js';

const run = promisify(execFile);
const packageDir = join(repoRoot(), 'packages', 'mcp-server');
const script = join(packageDir, 'scripts', 'check-pack.mjs');

interface CheckPack {
  checkPackFiles: (paths: string[]) => string[];
  pathsFromPackJson: (text: string) => string[];
  REQUIRED_FILES: string[];
}
const load = async (): Promise<CheckPack> =>
  (await import(pathToFileURL(script).href)) as CheckPack;

describe('the pre-publish file list check (CTO H2, TAM B3)', () => {
  test('the required files alone are fine', async () => {
    const { checkPackFiles, REQUIRED_FILES } = await load();
    expect(checkPackFiles(REQUIRED_FILES)).toEqual([]);
  });

  test('a missing file, a source file, a test, type output or a path trick is reported', async () => {
    const { checkPackFiles, REQUIRED_FILES } = await load();
    expect(checkPackFiles(REQUIRED_FILES.slice(1))).toEqual(['missing: package.json']);
    for (const extra of [
      'src/bin.ts',
      'test/a.test.ts',
      'dist/tsc/bin.js',
      '.env',
      'dist/data/../x',
      'dist/fixtures/synthetic/generate.ts',
    ]) {
      expect(checkPackFiles([...REQUIRED_FILES, extra]), extra).toEqual([`unexpected: ${extra}`]);
    }
  });

  test('reads the file paths from the json of npm pack, as an array or a single object', async () => {
    const { pathsFromPackJson } = await load();
    expect(pathsFromPackJson(JSON.stringify([{ files: [{ path: 'a' }, { path: 'b' }] }]))).toEqual([
      'a',
      'b',
    ]);
    expect(pathsFromPackJson(JSON.stringify({ files: [{ path: 'c' }] }))).toEqual(['c']);
    expect(pathsFromPackJson('[{}]')).toEqual([]);
  });

  test('the command line accepts a real dry run, refuses a bad list and a missing argument', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'compass-checkpack-'));
    try {
      const { REQUIRED_FILES } = await load();
      const good = join(dir, 'good.json');
      await writeFile(good, JSON.stringify([{ files: REQUIRED_FILES.map((path) => ({ path })) }]));
      const ok = await run(process.execPath, [script, good]);
      expect(ok.stdout).toContain('as expected');
      const bad = join(dir, 'bad.json');
      await writeFile(bad, JSON.stringify([{ files: [{ path: 'src/x.ts' }] }]));
      await expect(run(process.execPath, [script, bad])).rejects.toMatchObject({ code: 1 });
      await expect(run(process.execPath, [script])).rejects.toMatchObject({ code: 2 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
