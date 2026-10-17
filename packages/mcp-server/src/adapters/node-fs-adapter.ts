// The production file system adapter for the S4 `FileSystem` seam (task 12.4, integrator
// note). Files are written with mode 0o600 and directories created with 0o700. Writes refuse a
// symbolic link twice over: an `lstat` check, and `O_NOFOLLOW` when the platform defines it.
// `createExclusive` uses the `wx` flag so an existing file or link is never replaced, and
// `rename` refuses a link at either end. On Windows POSIX modes are ignored by Node, so the
// per-user app-data location is what protects the files there.

import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { CompassError } from '../ports/errors.js';

/** File access for the pass module and the app-data folder. */
export interface AppFileSystem {
  /** Creates a directory (and parents) with the given mode. */
  ensureDir(path: string, mode: number): Promise<void>;
  /** Reads a file, or returns undefined when it does not exist. */
  readFile(path: string): Promise<Uint8Array | undefined>;
  /** Writes (replaces) a file with mode 0o600. Refuses a symbolic link. */
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  /** Creates a new file with the exclusive flag. Rejects when the path exists. */
  createExclusive(path: string, data: string | Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Removes a file. A missing file is not an error. */
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

type LinkInfo = (path: string) => Promise<{ isSymbolicLink(): boolean }>;

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * The adapter over `node:fs/promises`. `linkInfo` (default `lstat`) is injectable so the
 * symbolic link refusal is tested on platforms that cannot create links.
 */
export function createNodeAppFileSystem(linkInfo: LinkInfo = lstat): AppFileSystem {
  const refuseLink = async (path: string): Promise<void> => {
    try {
      if ((await linkInfo(path)).isSymbolicLink()) {
        throw new CompassError('UnsafePath');
      }
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  };

  const write = async (path: string, data: string | Uint8Array, flags: number): Promise<void> => {
    const handle = await open(path, flags | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  };

  return {
    ensureDir: async (path, mode) => {
      await mkdir(path, { recursive: true, mode });
    },
    readFile: async (path) => {
      try {
        return new Uint8Array(await readFile(path));
      } catch (error) {
        if (isMissing(error)) {
          return undefined;
        }
        throw error;
      }
    },
    writeFile: async (path, data) => {
      await refuseLink(path);
      await write(path, data, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC);
    },
    createExclusive: async (path, data) => {
      await refuseLink(path);
      await write(path, data, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    },
    rename: async (from, to) => {
      await refuseLink(from);
      await refuseLink(to);
      await rename(from, to);
    },
    remove: async (path) => {
      await rm(path, { force: true });
    },
    exists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}
