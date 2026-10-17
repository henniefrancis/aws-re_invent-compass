// File system seams. The scanner and the spec writer define their own interfaces in
// @compass/core; this module re-exports them and adds the small interface the schedule
// snapshot store needs.

export type { ScanFs } from '@compass/core/scanner';
export type { SpecFs } from '@compass/core/spec';

/** The few operations the snapshot store needs, so tests can use a recording fake. */
export interface FsLike {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<void>;
  writeFile(path: string, data: string, options: { mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readFile(path: string): Promise<string>;
  /** Removes a file. A missing file is not an error. */
  remove(path: string): Promise<void>;
}
