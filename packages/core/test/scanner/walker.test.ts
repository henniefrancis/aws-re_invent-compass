import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createNodeScanFs } from '../../src/scanner/scan-fs.js';
import { isExcludedDirectory, isSupportedFile } from '../../src/scanner/file-filter.js';
import {
  DEFAULT_WALK_LIMITS,
  FolderNotFoundError,
  productionMarkerFor,
  walk,
} from '../../src/scanner/walker.js';
import { MemoryScanFs } from '../support/memory-scan-fs.js';
import type { MemoryTree } from '../support/memory-scan-fs.js';
import { drain } from '../support/drain.js';

async function run(tree: MemoryTree, limits = DEFAULT_WALK_LIMITS) {
  const fs = new MemoryScanFs(tree);
  const { files: all, summary } = await drain(walk(fs.root, fs, limits));
  // Read files carry text; files of an unsupported type are yielded by name only.
  const files = all.filter((f) => f.text !== undefined);
  const names = all.filter((f) => f.text === undefined).map((f) => f.relativePath);
  return { files, names, summary, fs };
}

describe('file filter', () => {
  test('names the excluded directories and supported files', () => {
    for (const name of ['node_modules', '.git', 'dist', 'cdk.out', '.terraform', 'venv']) {
      expect(isExcludedDirectory(name)).toBe(true);
    }
    expect(isExcludedDirectory('src')).toBe(false);
    for (const name of [
      'a.tf',
      'a.ts',
      'a.tsx',
      'a.mts',
      'a.cts',
      'a.js',
      'a.mjs',
      'a.cjs',
      'a.py',
    ]) {
      expect(isSupportedFile(name)).toBe(true);
    }
    expect(isSupportedFile('package.json')).toBe(true);
    expect(isSupportedFile('requirements.txt')).toBe(true);
    expect(isSupportedFile('notes.md')).toBe(false);
    expect(isSupportedFile('other.json')).toBe(false);
  });

  test('reads the technology manifests, .NET project files and C# source (task 41.2)', () => {
    for (const name of [
      'pyproject.toml',
      'Pipfile',
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
      'go.mod',
      'Cargo.toml',
      'Gemfile',
      'composer.json',
      'global.json',
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
      'Chart.yaml',
      'kustomization.yaml',
      'kustomization.yml',
      'App.csproj',
      'Lib.fsproj',
      'All.sln',
      'Program.cs',
    ]) {
      expect(isSupportedFile(name)).toBe(true);
    }
    for (const name of [
      'Main.java',
      'main.go',
      'lib.rs',
      'App.fs',
      'values.yaml',
      'tsconfig.json',
    ]) {
      expect(isSupportedFile(name)).toBe(false);
    }
  });
});

describe('name-only entries (task 41.1)', () => {
  test('every regular file of an unsupported type is yielded by name only, nothing else is', async () => {
    const { files, names, summary } = await run(
      {
        '.gitignore': 'ignored.java\n',
        'App.java': 'class App {}',
        'ignored.java': 'x',
        'node_modules/dep/index.go': 'x',
        'link.go': { symlink: true },
        'big.ts': 'x'.repeat(40),
        'bin.ts': new Uint8Array([0, 1]),
        'deploy/prod.tfvars': 'x',
        'main.go': 'package main',
        'src/a.ts': 'x',
      },
      { ...DEFAULT_WALK_LIMITS, maxFileBytes: 20 },
    );
    expect(files.map((f) => f.relativePath)).toEqual(['src/a.ts']);
    expect(names).toEqual(['App.java', 'deploy/prod.tfvars', 'main.go']);
    expect(summary.filesRead).toBe(1);
    expect(summary.skipped).toEqual({
      excludedDirectory: 1,
      gitignored: 1,
      tooLarge: 1,
      binary: 1,
      symlink: 1,
      unsupportedType: 3,
    });
    expect(summary.productionMarker).toBe(true);
  });

  test('name-only entries do not count toward the file cap', async () => {
    const { files, names, summary } = await run(
      { 'a.md': 'x', 'b.ts': 'x', 'c.md': 'x', 'd.ts': 'x', 'e.md': 'x' },
      { ...DEFAULT_WALK_LIMITS, maxFiles: 1 },
    );
    expect(files.map((f) => f.relativePath)).toEqual(['b.ts']);
    expect(names).toEqual(['a.md', 'c.md']);
    expect(summary).toMatchObject({ filesRead: 1, truncated: true });
    const many = await run(
      { 'a.md': 'x', 'b.md': 'x', 'c.md': 'x', 'd.ts': 'x' },
      { ...DEFAULT_WALK_LIMITS, maxFiles: 1 },
    );
    expect(many.names).toHaveLength(3);
    expect(many.summary).toMatchObject({ filesRead: 1, truncated: false });
  });
});

describe('productionMarkerFor', () => {
  test('matches the production tfvars names and a prod folder inside an environments folder', () => {
    for (const path of [
      'prod.tfvars',
      'production.tfvars',
      'deploy/app.prod.tfvars',
      'envs/prod/main.tf',
      'infra/environments/production/vars.tf',
      'stages/prod/a/b.tf',
    ]) {
      expect(productionMarkerFor(path)).toBe(true);
    }
  });

  test('does not match other names, a prod folder at the root or a file named prod', () => {
    for (const path of [
      '',
      'dev.tfvars',
      'prod.tf',
      'prod/main.tf',
      'envs/staging/main.tf',
      'other/prod/main.tf',
      'envs/prod',
      'prod.tfvars/readme.md',
    ]) {
      expect(productionMarkerFor(path)).toBe(false);
    }
  });

  test('agrees with the walker on every path of a tree', async () => {
    const trees: MemoryTree[] = [
      { 'envs/prod/main.tf': 'x' },
      { 'a/app.prod.tfvars': 'x' },
      { 'prod/main.tf': 'x', 'envs/dev/main.tf': 'x' },
    ];
    for (const tree of trees) {
      const { summary } = await run(tree);
      expect(Object.keys(tree).some(productionMarkerFor)).toBe(summary.productionMarker);
    }
  });
});

describe('walk discovery', () => {
  test('reads supported files in sorted order and reports the summary', async () => {
    const { files, names, summary } = await run({
      'b.ts': 'b',
      'a.tf': 'a',
      'sub/c.py': 'c',
      'sub/notes.md': 'skip',
    });
    expect(files.map((f) => f.relativePath)).toEqual(['a.tf', 'b.ts', 'sub/c.py']);
    expect(names).toEqual(['sub/notes.md']);
    expect(summary.filesRead).toBe(3);
    expect(summary.skipped.unsupportedType).toBe(1);
    expect(summary.truncated).toBe(false);
  });

  test('an empty tree gives an empty summary', async () => {
    const { files, summary } = await run({ 'empty/': '' });
    expect(files).toEqual([]);
    expect(summary).toMatchObject({ filesRead: 0, truncated: false, productionMarker: false });
  });

  test('a missing path and a file path give folder not found without echoing the path', async () => {
    const fs = new MemoryScanFs({ 'a.ts': 'x' });
    for (const target of ['/repo/missing-secret-name', '/repo/a.ts']) {
      let caught: unknown;
      try {
        await drain(walk(target, fs));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(FolderNotFoundError);
      expect((caught as Error).message).toBe('That folder could not be found.');
      expect((caught as Error).message).not.toContain('secret');
    }
  });

  test('skips excluded directories without entering them', async () => {
    const { files, summary, fs } = await run({
      'node_modules/x/index.js': 'new S3Client()',
      '.git/config': 'x',
      'src/a.ts': 'a',
    });
    expect(files.map((f) => f.relativePath)).toEqual(['src/a.ts']);
    expect(summary.skipped.excludedDirectory).toBe(2);
    expect(fs.calls.some((c) => c.path.includes('node_modules') && c.method === 'readdir')).toBe(
      false,
    );
  });

  test('counts symbolic links as skipped and never reads them', async () => {
    const { files, summary, fs } = await run({
      'real.ts': 'a',
      'link.ts': { symlink: true },
      linkdir: { symlink: true },
    });
    expect(files.map((f) => f.relativePath)).toEqual(['real.ts']);
    expect(summary.skipped.symlink).toBe(2);
    expect(fs.calls.filter((c) => c.method === 'readFile')).toHaveLength(1);
  });

  test('honours nested gitignore files, negation and ignored directories', async () => {
    const { files, summary, fs } = await run({
      '.gitignore': '*.gen.ts\nignored/\n',
      'a.gen.ts': 'x',
      'ignored/deep.ts': 'x',
      'keep.ts': 'x',
      'pkg/.gitignore': '!a.gen.ts\nlocal.ts\n',
      'pkg/a.gen.ts': 'x',
      'pkg/local.ts': 'x',
      'pkg/ok.ts': 'x',
    });
    expect(files.map((f) => f.relativePath)).toEqual(['keep.ts', 'pkg/a.gen.ts', 'pkg/ok.ts']);
    expect(summary.skipped.gitignored).toBe(3);
    expect(fs.calls.some((c) => c.method === 'readdir' && c.path.includes('ignored'))).toBe(false);
  });

  test('ignores a gitignore that is a link, a directory or too large', async () => {
    for (const node of [{ symlink: true } as const, 'x'.repeat(40)]) {
      const fs = new MemoryScanFs({ '.gitignore': node, 'a.ts': 'x' });
      const { files } = await drain(
        walk(fs.root, fs, { maxFiles: 10, maxFileBytes: 20, binaryProbeBytes: 8 }),
      );
      expect(files.map((f) => f.relativePath)).toEqual(['a.ts']);
    }
    const { files } = await run({ '.gitignore/inner.ts': 'x', 'a.ts': 'x' });
    expect(files.map((f) => f.relativePath)).toEqual(['.gitignore/inner.ts', 'a.ts']);
  });

  test('skips files over the size limit by size and by what was read', async () => {
    const limits = { maxFiles: 10, maxFileBytes: 10, binaryProbeBytes: 8 };
    const { files, summary } = await run(
      {
        'small.ts': 'tiny',
        'big.ts': 'x'.repeat(11),
        'liar.ts': { bytes: 'y'.repeat(11), size: 3 },
      },
      limits,
    );
    expect(files.map((f) => f.relativePath)).toEqual(['small.ts']);
    expect(summary.skipped.tooLarge).toBe(2);
  });

  test('skips files with a NUL byte in the probe window', async () => {
    const withNul = new Uint8Array([97, 0, 98]);
    const lateNul = new Uint8Array(12).fill(97);
    lateNul[10] = 0;
    const { files, summary } = await run(
      { 'bin.ts': withNul, 'late.ts': lateNul, 'text.ts': 'abc' },
      { maxFiles: 10, maxFileBytes: 100, binaryProbeBytes: 8 },
    );
    expect(files.map((f) => f.relativePath)).toEqual(['late.ts', 'text.ts']);
    expect(summary.skipped.binary).toBe(1);
  });

  test('records the repository production marker from names only', async () => {
    const dirMarker = await run({ 'envs/prod/main.tf': 'x', 'envs/dev/main.tf': 'x' });
    expect(dirMarker.summary.productionMarker).toBe(true);
    const fileMarker = await run({ 'deploy/app.prod.tfvars': 'x' });
    expect(fileMarker.summary.productionMarker).toBe(true);
    expect((await run({ 'prod.tfvars': 'x' })).summary.productionMarker).toBe(true);
    expect((await run({ 'production.tfvars': 'x' })).summary.productionMarker).toBe(true);
    expect((await run({ 'prod/main.tf': 'x' })).summary.productionMarker).toBe(false);
    expect((await run({ 'envs/staging/main.tf': 'x' })).summary.productionMarker).toBe(false);
    expect((await run({ 'dev.tfvars': 'x' })).summary.productionMarker).toBe(false);
  });

  test('an ignored production folder does not set the marker', async () => {
    const { summary } = await run({ '.gitignore': 'prod/\n', 'envs/prod/main.tf': 'x' });
    expect(summary.productionMarker).toBe(false);
  });
});

// Feature: compass-power, Property 3: The scanner never writes
describe('Property 3: the scanner never writes', () => {
  const nameArb = fc.constantFrom('a', 'b', 'c', 'node_modules', 'sub');
  const fileArb = fc.constantFrom('x.ts', 'y.tf', 'z.md', 'w.py', 'package.json');

  test('only read calls are made and every read is bounded', async () => {
    expect(Object.keys(createNodeScanFs()).sort()).toEqual([
      'lstat',
      'readFile',
      'readdir',
      'realpath',
    ]);
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.array(nameArb, { maxLength: 3 }), fileArb), { maxLength: 12 }),
        async (entries) => {
          const tree: MemoryTree = {};
          for (const [dirs, file] of entries) {
            tree[[...dirs, file].join('/')] = 'new S3Client()';
          }
          const fs = new MemoryScanFs(tree);
          await drain(walk(fs.root, fs));
          for (const call of fs.calls) {
            expect(['realpath', 'lstat', 'readdir', 'readFile']).toContain(call.method);
            if (call.method === 'readFile') {
              expect(call.maxBytes).toBeLessThanOrEqual(1048577);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: compass-power, Property 4: The file cap is exact
describe('Property 4: the file cap is exact', () => {
  test('reads min(N, C) files and truncates exactly when N exceeds C', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 1, max: 14 }),
        fc.integer({ min: 0, max: 3 }),
        async (count, cap, unreadable) => {
          const tree: MemoryTree = {};
          for (let i = 0; i < count; i += 1) {
            tree[`d${i % 3}/f${String(i).padStart(2, '0')}.ts`] = 'x';
          }
          for (let i = 0; i < unreadable; i += 1) {
            tree[`d0/skip${i}.md`] = 'x';
          }
          const { files, summary } = await run(tree, { ...DEFAULT_WALK_LIMITS, maxFiles: cap });
          expect(summary.filesRead).toBe(Math.min(count, cap));
          expect(files).toHaveLength(Math.min(count, cap));
          expect(summary.truncated).toBe(count > cap);
        },
      ),
      { numRuns: 100 },
    );
  });
});
