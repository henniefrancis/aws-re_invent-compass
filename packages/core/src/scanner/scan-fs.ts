// Read-only file access for the scanner (design, Component 1).
//
// The interface has no write, rename, delete or mkdir member, so the scanner cannot
// change a file by construction. The Node implementation is added in task 2.1; the
// interface lives here from task 1 because the server's Runtime types against it.

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
