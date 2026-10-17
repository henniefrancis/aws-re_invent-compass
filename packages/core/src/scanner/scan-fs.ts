// Read-only file access for the scanner (design, Component 1).
//
// The interface has no write, rename, delete or mkdir member, so the scanner cannot
// change a file by construction. The Node implementation uses `lstat` (never `stat`, so
// symbolic links are reported as links and never followed), opens files with the flag
// `r`, and reads at most the number of bytes asked for.

import { lstat, open, readdir, realpath } from 'node:fs/promises';

/** What `lstat` reports. Symbolic links are reported as links, never followed. */
export interface ScanStat {
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  size: number;
}

/** Read-only file system access. */
export interface ScanFs {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<ScanStat>;
  readdir(path: string): Promise<string[]>;
  /** Reads at most `maxBytes` bytes from the start of the file. */
  readFile(path: string, maxBytes: number): Promise<Uint8Array>;
}

/** The scan file system over `node:fs/promises`, read-only. */
export function createNodeScanFs(): ScanFs {
  return {
    realpath: (path) => realpath(path),
    lstat: async (path) => {
      const stat = await lstat(path);
      return {
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        isSymbolicLink: stat.isSymbolicLink(),
        size: stat.size,
      };
    },
    readdir: (path) => readdir(path),
    readFile: async (path, maxBytes) => {
      const handle = await open(path, 'r');
      try {
        const { size } = await handle.stat();
        const buffer = new Uint8Array(Math.min(maxBytes, size + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
  };
}
