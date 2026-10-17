// An in-memory FileSystem for the boarding-passes suite (S4). Not a test file: it records
// every operation, the mode each file was written with and the directories created, and
// any operation can be made to fail with an error that names a secret path and email, so
// tests can prove nothing from a thrown error reaches a PassError.
import type { FileSystem } from '../../src/passes/interfaces.js';

/** The filesystem operations a test can make fail. */
export type FsOperation = 'readFile' | 'writeFile' | 'remove' | 'ensureDir';

export interface MemoryFs extends FileSystem {
  files: Map<string, string>;
  modes: Map<string, number>;
  dirs: string[];
  ops: string[];
  /** Operations listed here reject. */
  failing: Set<FsOperation>;
}

export function memoryFs(initial: Record<string, string> = {}): MemoryFs {
  const files = new Map<string, string>(Object.entries(initial));
  const modes = new Map<string, number>();
  const dirs: string[] = [];
  const ops: string[] = [];
  const failing = new Set<FsOperation>();

  function check(op: FsOperation, path: string): void {
    ops.push(`${op} ${path}`);
    if (failing.has(op)) {
      throw new Error(`disk failure at ${path} for secret.user@example.com`);
    }
  }

  return {
    files,
    modes,
    dirs,
    ops,
    failing,
    readFile(path) {
      check('readFile', path);
      return Promise.resolve(files.get(path));
    },
    writeFile(path, data, mode) {
      check('writeFile', path);
      files.set(path, data);
      modes.set(path, mode);
      return Promise.resolve();
    },
    remove(path) {
      check('remove', path);
      files.delete(path);
      return Promise.resolve();
    },
    ensureDir(path) {
      check('ensureDir', path);
      dirs.push(path);
      return Promise.resolve();
    },
  };
}
