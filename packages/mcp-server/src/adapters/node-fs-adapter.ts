// The production file system adapter for S4's `FileSystem` seam (integrator notes). Files are
// written with the mode the caller asks for (S4 asks for 0o600 for files and 0o700 for folders).
// Writes refuse a symbolic link twice over: an `lstat` check, and `O_NOFOLLOW` when the platform
// defines it. `createExclusive` opens with `wx`, so an existing file or link is never replaced,
// and reports `false` when the path already exists. `rename` refuses a link at either end.
// `remove` looks at the path with `lstat` first: a link is unlinked and never followed, a real
// folder is removed recursively, anything else is unlinked. On Windows POSIX modes are ignored
// by Node, so the per-user app-data location is what protects the files there.

import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import type { FileSystem } from '@compass/core/passes';
import { CompassError } from '../ports/errors.js';

/** What the adapter needs to know about a path. Injectable so link handling is testable everywhere. */
export interface PathInfo {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
}

function codeOf(error: unknown): unknown {
  // Object() wraps primitives and null, so any thrown value can be probed without a branch.
  return Reflect.get(Object(error), 'code');
}

/**
 * The adapter over `node:fs/promises`. `pathInfo` (default `lstat`) is injectable so the symbolic
 * link refusal and removal are tested on platforms that cannot create links.
 */
export function createNodeAppFileSystem(
  pathInfo: (path: string) => Promise<PathInfo> = lstat,
): FileSystem {
  /** The path's info, or undefined when it does not exist. */
  const look = async (path: string): Promise<PathInfo | undefined> => {
    try {
      return await pathInfo(path);
    } catch (error) {
      if (codeOf(error) === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  };

  const refuseLink = async (path: string): Promise<void> => {
    if ((await look(path))?.isSymbolicLink() === true) {
      throw new CompassError('UnsafePath');
    }
  };

  const write = async (path: string, data: string, flags: number, mode: number): Promise<void> => {
    const handle = await open(path, flags | constants.O_NOFOLLOW, mode);
    try {
      await handle.writeFile(data, 'utf8');
    } finally {
      await handle.close();
    }
  };

  return {
    readFile: async (path) => {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if (codeOf(error) === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    },
    writeFile: async (path, data, mode) => {
      await refuseLink(path);
      await write(path, data, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, mode);
    },
    createExclusive: async (path, data, mode) => {
      await refuseLink(path);
      try {
        await write(path, data, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
        return true;
      } catch (error) {
        if (codeOf(error) === 'EEXIST') {
          return false;
        }
        throw error;
      }
    },
    rename: async (from, to) => {
      await refuseLink(from);
      await refuseLink(to);
      await rename(from, to);
    },
    remove: async (path) => {
      const info = await look(path);
      if (info === undefined) {
        return;
      }
      if (!info.isSymbolicLink() && info.isDirectory()) {
        await rm(path, { recursive: true, force: true });
      } else {
        await unlink(path);
      }
    },
    ensureDir: async (path, mode) => {
      await mkdir(path, { recursive: true, mode });
    },
    mtimeMs: async (path) => {
      try {
        return (await stat(path)).mtimeMs;
      } catch (error) {
        if (codeOf(error) === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    },
  };
}
