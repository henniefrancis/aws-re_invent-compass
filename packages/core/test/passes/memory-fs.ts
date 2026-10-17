// An in-memory FileSystem for the boarding-passes suite (S4). Not a test file: it records
// every operation, the mode each file was written with and the directories created, and
// any operation can be made to fail with an error that names a secret path and email, so
// tests can prove nothing from a thrown error reaches a PassError. Failures reject the
// returned promise, as a real adapter's would.
import type { FileSystem } from '../../src/passes/interfaces.js';

/** The filesystem operations a test can make fail. */
export type FsOperation =
  'readFile' | 'writeFile' | 'rename' | 'remove' | 'ensureDir' | 'createExclusive' | 'mtimeMs';

export interface MemoryFs extends FileSystem {
  files: Map<string, string>;
  modes: Map<string, number>;
  dirs: string[];
  dirModes: Map<string, number>;
  /** Last-modified time per file. Files given up front start at 0; written files get `nowMs`. */
  mtimes: Map<string, number>;
  /** The time stamped on files as they are written. */
  nowMs: number;
  ops: string[];
  /** Operations listed here reject. */
  failing: Set<FsOperation>;
  /** Text added to the error a failing operation throws, so a test can plant a secret in it. */
  failureText: string;
}

export function memoryFs(initial: Record<string, string> = {}): MemoryFs {
  const files = new Map<string, string>(Object.entries(initial));
  const modes = new Map<string, number>();
  const dirs: string[] = [];
  const dirModes = new Map<string, number>();
  const mtimes = new Map<string, number>();
  const ops: string[] = [];
  const failing = new Set<FsOperation>();
  const state = { failureText: 'secret.user@example.com', nowMs: 1_000_000 };

  /** Run an operation, recording it, rejecting when it is set to fail. */
  function run<T>(op: FsOperation, path: string, action: () => T): Promise<T> {
    ops.push(`${op} ${path}`);
    if (failing.has(op)) {
      return Promise.reject(new Error(`disk failure at ${path} for ${state.failureText}`));
    }
    return Promise.resolve(action());
  }

  return {
    files,
    modes,
    dirs,
    dirModes,
    mtimes,
    get nowMs() {
      return state.nowMs;
    },
    set nowMs(value: number) {
      state.nowMs = value;
    },
    ops,
    failing,
    get failureText() {
      return state.failureText;
    },
    set failureText(value: string) {
      state.failureText = value;
    },
    readFile(path) {
      return run('readFile', path, () => files.get(path));
    },
    writeFile(path, data, mode) {
      return run('writeFile', path, () => {
        files.set(path, data);
        modes.set(path, mode);
        mtimes.set(path, state.nowMs);
      });
    },
    rename(from, to) {
      return run('rename', `${from} ${to}`, () => {
        files.set(to, files.get(from) ?? '');
        mtimes.set(to, state.nowMs);
        modes.set(to, modes.get(from) ?? 0);
        files.delete(from);
        modes.delete(from);
      });
    },
    remove(path) {
      return run('remove', path, () => {
        // A folder goes with everything under it, as the seam documents.
        for (const key of [...files.keys()]) {
          if (key === path || key.startsWith(`${path}/`) || key.startsWith(`${path}\\`)) {
            files.delete(key);
          }
        }
      });
    },
    ensureDir(path, mode) {
      return run('ensureDir', path, () => {
        dirs.push(path);
        dirModes.set(path, mode);
      });
    },
    mtimeMs(path) {
      return run('mtimeMs', path, () => (files.has(path) ? (mtimes.get(path) ?? 0) : undefined));
    },
    createExclusive(path, data, mode) {
      return run('createExclusive', path, () => {
        if (files.has(path)) {
          return false;
        }
        files.set(path, data);
        modes.set(path, mode);
        mtimes.set(path, state.nowMs);
        return true;
      });
    },
  };
}
