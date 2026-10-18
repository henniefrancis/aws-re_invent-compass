import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeScanFs } from '../../src/scanner/scan-fs.js';

describe('createNodeScanFs', () => {
  let root: string;
  let canSymlink = true;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'compass-scanfs-'));
    await mkdir(join(root, 'dir'));
    await writeFile(join(root, 'dir', 'a.ts'), 'hello world');
    await writeFile(join(root, 'empty.ts'), '');
    try {
      await symlink(join(root, 'dir'), join(root, 'link'), 'junction');
    } catch {
      canSymlink = false;
    }
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('exposes only read operations', () => {
    expect(Object.keys(createNodeScanFs()).sort()).toEqual([
      'lstat',
      'readFile',
      'readdir',
      'realpath',
    ]);
  });

  test('realpath, lstat and readdir describe the tree', async () => {
    const fs = createNodeScanFs();
    expect((await fs.realpath(root)).length).toBeGreaterThan(0);
    expect(await fs.lstat(root)).toMatchObject({ isDirectory: true, isFile: false });
    expect(await fs.lstat(join(root, 'dir', 'a.ts'))).toMatchObject({
      isFile: true,
      isSymbolicLink: false,
      size: 11,
    });
    expect((await fs.readdir(root)).sort()).toEqual(
      canSymlink ? ['dir', 'empty.ts', 'link'] : ['dir', 'empty.ts'],
    );
  });

  test('lstat reports a link as a link without following it', async () => {
    if (!canSymlink) {
      return;
    }
    const stat = await createNodeScanFs().lstat(join(root, 'link'));
    expect(stat.isSymbolicLink).toBe(true);
    expect(stat.isDirectory).toBe(false);
  });

  test('readFile returns at most the bytes asked for', async () => {
    const fs = createNodeScanFs();
    const path = join(root, 'dir', 'a.ts');
    expect(new TextDecoder().decode(await fs.readFile(path, 5))).toBe('hello');
    expect(new TextDecoder().decode(await fs.readFile(path, 1000))).toBe('hello world');
    expect((await fs.readFile(join(root, 'empty.ts'), 10)).length).toBe(0);
  });

  test('readFile on a missing file rejects', async () => {
    await expect(createNodeScanFs().readFile(join(root, 'nope.ts'), 10)).rejects.toThrow();
  });
});
