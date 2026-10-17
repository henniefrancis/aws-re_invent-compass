// The Node implementation of SpecFs (design, Component 4; CTO review M3). Files are
// created with the exclusive flag (`wx`) and mode 0o600, directories with 0o700 (POSIX
// modes are ignored on Windows, where the per-user location is relied on). An append opens
// the file with `O_NOFOLLOW` where the platform defines it and refuses a link either way.
// As a second layer behind the writer's own check, any path that is not a `.gitignore` or
// a Week_Spec file is refused.

import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, stat } from 'node:fs/promises';
import { basename, dirname, sep } from 'node:path';
import { SpecWriteRefusedError } from './spec-errors.js';
import type { SpecFs } from './spec-fs.js';

const SPEC_FILE = /^(?:requirements|design|tasks)\.md$|^week-\d{4}-\d{2}-\d{2}(?:-\d+)?\.md$/;
const SPEC_DIRECTORY = ['.kiro', 'specs', 'my-reinvent-week'].join(sep);

/** True for the shape of a Week_Spec file or `.gitignore`, whatever the root. */
export function hasAllowedShape(path: string): boolean {
  const name = basename(path);
  return (
    name === '.gitignore' ||
    (SPEC_FILE.test(name) && dirname(path).endsWith(`${sep}${SPEC_DIRECTORY}`))
  );
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * The spec file system over `node:fs/promises`. `linkInfo` (default `lstat`) is injectable
 * so tests can report a symbolic link on platforms where one cannot be created.
 */
export function createNodeSpecFs(
  linkInfo: (path: string) => Promise<{ isSymbolicLink(): boolean }> = lstat,
): SpecFs {
  const linkStatus = async (path: string): Promise<'link' | 'other' | 'missing'> => {
    try {
      return (await linkInfo(path)).isSymbolicLink() ? 'link' : 'other';
    } catch (error) {
      if (isMissing(error)) {
        return 'missing';
      }
      throw error;
    }
  };

  return {
    exists: async (path) => (await linkStatus(path)) !== 'missing',
    isDirectory: async (path) => {
      try {
        return (await stat(path)).isDirectory();
      } catch (error) {
        if (isMissing(error)) {
          return false;
        }
        throw error;
      }
    },
    isSymlink: async (path) => (await linkStatus(path)) === 'link',
    readText: (path) => readFile(path, 'utf8'),
    createExclusive: async (path, text) => {
      if (!hasAllowedShape(path)) {
        throw new SpecWriteRefusedError();
      }
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(text, 'utf8');
      } finally {
        await handle.close();
      }
    },
    appendText: async (path, text) => {
      if (!hasAllowedShape(path) || (await linkStatus(path)) !== 'other') {
        throw new SpecWriteRefusedError();
      }
      const handle = await open(
        path,
        constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
      );
      try {
        await handle.writeFile(text, 'utf8');
      } finally {
        await handle.close();
      }
    },
    mkdirp: async (path) => {
      if (!path.endsWith(SPEC_DIRECTORY)) {
        throw new SpecWriteRefusedError();
      }
      await mkdir(path, { recursive: true, mode: 0o700 });
    },
  };
}
