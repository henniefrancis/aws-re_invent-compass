// The FsLike implementation over node:fs/promises (used by the snapshot store). Files are
// written with the mode asked for. POSIX modes are ignored on Windows, so the per-user
// app-data location is what protects the file there.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { FsLike } from '../ports/fs-ports.js';

/** The real file system. */
export function createNodeFsLike(): FsLike {
  return {
    mkdir: async (path, options) => {
      await mkdir(path, options);
    },
    writeFile: (path, data, options) => writeFile(path, data, { mode: options.mode }),
    rename: (from, to) => rename(from, to),
    readFile: (path) => readFile(path, 'utf8'),
    remove: (path) => rm(path, { force: true }),
  };
}
