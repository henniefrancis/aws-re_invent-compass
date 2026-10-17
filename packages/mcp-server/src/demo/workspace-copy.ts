// A throwaway copy of the folder the demo scans. Scanning the copy keeps the demo from writing the
// week spec into the sample repo (which may sit in a read-only package folder) or into a folder the
// attendee pointed `--repo` at. The copy skips links, `.git`, `node_modules` and large files, and
// stops at a fixed number of files, so a big folder is never copied whole.

import { cp, lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { CompassError } from '../ports/errors.js';

/** The most files copied. */
export const MAX_COPIED_FILES = 2000;
/** The largest file copied, in bytes. */
export const MAX_COPIED_FILE_BYTES = 1024 * 1024;

const SKIPPED_FOLDERS = new Set(['node_modules', '.git']);

/** A temporary workspace and the way to remove it. */
export interface Workspace {
  path: string;
  cleanup(): Promise<void>;
}

/** What the copy can be told. The defaults are the real ones; tests replace them. */
export interface CopyOptions {
  tempRoot?: string;
  /** Looks at a path without following a link (default `lstat`). */
  look?: (path: string) => Promise<PathLook>;
  maxFiles?: number;
  maxFileBytes?: number;
}

/** What the copy needs to know about a path. */
export interface PathLook {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
  size: number;
}

/** Copies `source` into a fresh temporary folder. Throws FolderNotFound when it is not a folder. */
export async function prepareWorkspace(
  source: string,
  options: CopyOptions = {},
): Promise<Workspace> {
  const tempRoot = options.tempRoot ?? tmpdir();
  const look = options.look ?? lstat;
  const maxFiles = options.maxFiles ?? MAX_COPIED_FILES;
  const maxFileBytes = options.maxFileBytes ?? MAX_COPIED_FILE_BYTES;
  let isFolder = false;
  try {
    isFolder = (await lstat(source)).isDirectory();
  } catch {
    isFolder = false;
  }
  if (!isFolder) {
    throw new CompassError('FolderNotFound');
  }
  const root = await mkdtemp(join(tempRoot, 'reinvent-compass-demo-'));
  const path = join(root, 'workspace');
  let copied = 0;
  try {
    await cp(source, path, {
      recursive: true,
      dereference: false,
      filter: async (from) => {
        const info = await look(from);
        if (info.isSymbolicLink() || SKIPPED_FOLDERS.has(basename(from))) {
          return false;
        }
        if (info.isDirectory()) {
          return true;
        }
        if (!info.isFile() || info.size > maxFileBytes || copied >= maxFiles) {
          return false;
        }
        copied += 1;
        return true;
      },
    });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return { path, cleanup: () => rm(root, { recursive: true, force: true }) };
}
