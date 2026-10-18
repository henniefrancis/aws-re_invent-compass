import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { prepareWorkspace } from '../../src/demo/workspace-copy.js';
import type { PathLook } from '../../src/demo/workspace-copy.js';

let temp: string;
let source: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'compass-copy-'));
  source = join(temp, 'source');
  await mkdir(join(source, 'src'), { recursive: true });
  await mkdir(join(source, 'node_modules', 'dep'), { recursive: true });
  await mkdir(join(source, '.git'), { recursive: true });
  await writeFile(join(source, 'src', 'a.ts'), 'export const a = 1;');
  await writeFile(join(source, 'b.txt'), 'b');
  await writeFile(join(source, 'node_modules', 'dep', 'x.js'), 'x');
  await writeFile(join(source, '.git', 'HEAD'), 'ref');
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

const fileLook = (over: Partial<PathLook> = {}): PathLook => ({
  isSymbolicLink: () => false,
  isDirectory: () => false,
  isFile: () => true,
  size: 1,
  ...over,
});

describe('prepareWorkspace', () => {
  test('copies files, skips node_modules and .git, and cleanup removes the copy', async () => {
    const workspace = await prepareWorkspace(source, { tempRoot: temp });
    expect((await readdir(workspace.path)).sort()).toEqual(['b.txt', 'src']);
    expect(existsSync(join(workspace.path, 'src', 'a.ts'))).toBe(true);
    expect(workspace.path.startsWith(temp)).toBe(true);
    await workspace.cleanup();
    expect(existsSync(workspace.path)).toBe(false);
  });

  test('works with the system temporary folder by default', async () => {
    const workspace = await prepareWorkspace(source);
    expect(existsSync(join(workspace.path, 'b.txt'))).toBe(true);
    await workspace.cleanup();
  });

  test('never copies a link, an oversize file, something that is not a file, or past the file cap', async () => {
    const real = await import('node:fs/promises');
    const kinds: Record<string, Partial<PathLook>> = {
      'a.ts': { isSymbolicLink: () => true },
      'b.txt': { size: 50 },
    };
    const workspace = await prepareWorkspace(source, {
      tempRoot: temp,
      maxFileBytes: 10,
      look: async (path) => {
        const info = await real.lstat(path);
        const name = path.split(/[\\/]/).at(-1) ?? '';
        return {
          isSymbolicLink: kinds[name]?.isSymbolicLink ?? (() => info.isSymbolicLink()),
          isDirectory: () => info.isDirectory(),
          isFile: () => info.isFile(),
          size: kinds[name]?.size ?? info.size,
        };
      },
    });
    expect(existsSync(join(workspace.path, 'src', 'a.ts'))).toBe(false);
    expect(existsSync(join(workspace.path, 'b.txt'))).toBe(false);
    await workspace.cleanup();

    const special = await prepareWorkspace(source, {
      tempRoot: temp,
      look: async (path) => {
        const info = await real.lstat(path);
        return info.isDirectory()
          ? fileLook({ isDirectory: () => true })
          : fileLook({ isFile: () => false });
      },
    });
    expect(existsSync(join(special.path, 'b.txt'))).toBe(false);
    await special.cleanup();

    const capped = await prepareWorkspace(source, { tempRoot: temp, maxFiles: 1 });
    const copied = [
      existsSync(join(capped.path, 'b.txt')),
      existsSync(join(capped.path, 'src', 'a.ts')),
    ].filter(Boolean);
    expect(copied).toHaveLength(1);
    await capped.cleanup();
  });

  test('a source that is missing or is a file is a FolderNotFound error', async () => {
    await expect(prepareWorkspace(join(temp, 'nope'), { tempRoot: temp })).rejects.toMatchObject({
      code: 'FolderNotFound',
    });
    await expect(prepareWorkspace(join(source, 'b.txt'), { tempRoot: temp })).rejects.toMatchObject(
      {
        code: 'FolderNotFound',
      },
    );
  });

  test('a failed copy removes the partial copy and rethrows', async () => {
    const before = (await readdir(temp)).sort();
    await expect(
      prepareWorkspace(source, {
        tempRoot: temp,
        look: () => Promise.reject(new Error('disk problem')),
      }),
    ).rejects.toThrow('disk problem');
    expect((await readdir(temp)).sort()).toEqual(before);
  });
});
