// The Node implementation of SpecFs (design, Component 4; CTO review M3). Files are
// created with the exclusive flag (`wx`) and mode 0o600, directories with 0o700 (POSIX
// modes are ignored on Windows, where the per-user location is relied on). An append opens
// the file with `O_NOFOLLOW` where the platform defines it and refuses a link either way.
// As a second layer behind the writer's own check, any path that is not a `.gitignore` or
// a Week_Spec file is refused.

import { constants } from 'node:fs';
import { lstat, mkdir, open, stat } from 'node:fs/promises';
import { basename, dirname, sep } from 'node:path';
import { SpecWriteRefusedError } from './spec-errors.js';
import type { SpecFs } from './spec-fs.js';

/** The most bytes read from an existing spec document or `.gitignore`: 256 KiB. */
export const SPEC_READ_LIMIT = 256 * 1024;

/** What the safe read needs to know about a path or an open file. */
export interface FileInfo {
  isSymbolicLink(): boolean;
  isFile(): boolean;
  nlink: number;
  size: number;
  ino: number;
  dev: number;
}

/** An open file, as far as the safe read uses it. */
export interface OpenedFile {
  stat(): Promise<FileInfo>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/** The calls the safe read makes; tests replace them to report anomalies. */
export interface ReadDeps {
  stat(path: string): Promise<FileInfo>;
  open(path: string, flags: number): Promise<OpenedFile>;
}

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

/** A regular file, not a link, with one name, of a size that may be read. */
function isPlainFile(info: FileInfo): boolean {
  return !info.isSymbolicLink() && info.isFile() && info.nlink <= 1 && info.size <= SPEC_READ_LIMIT;
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
  read: ReadDeps = { stat: lstat, open },
): SpecFs {
  /**
   * Reads an existing spec document or `.gitignore` safely (security review H2): only a name in the
   * allowed set, only a regular file that is not a link and has no second hard link, opened without
   * following a link, checked again through the open handle, and at most 256 KiB. Any anomaly is a
   * refusal with the fixed text, and nothing is returned.
   */
  const safeRead = async (path: string): Promise<string> => {
    if (!hasAllowedShape(path)) {
      throw new SpecWriteRefusedError();
    }
    let before: FileInfo;
    let handle: OpenedFile;
    try {
      before = await read.stat(path);
      if (!isPlainFile(before)) {
        throw new SpecWriteRefusedError();
      }
      handle = await read.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw new SpecWriteRefusedError();
    }
    try {
      const after = await handle.stat();
      if (!isPlainFile(after) || after.ino !== before.ino || after.dev !== before.dev) {
        throw new SpecWriteRefusedError();
      }
      const buffer = Buffer.alloc(after.size);
      const { bytesRead } = await handle.read(buffer, 0, after.size, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } catch {
      throw new SpecWriteRefusedError();
    } finally {
      await handle.close();
    }
  };

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
    readText: safeRead,
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
