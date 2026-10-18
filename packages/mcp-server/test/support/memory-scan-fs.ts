import type { ScanFs, ScanStat } from '@compass/core/scanner';

/** A file in the in-memory tree. `size` lets a test make `lstat` report a different size. */
export type MemoryFile = string | Uint8Array | { bytes: string | Uint8Array; size?: number };

/** A symbolic link in the in-memory tree. */
export interface MemorySymlink {
  symlink: true;
}

/** A tree keyed by path relative to the root. A key ending in `/` is an (empty) directory. */
export type MemoryTree = Record<string, MemoryFile | MemorySymlink>;

/** One recorded file system call. */
export interface FsCall {
  method: string;
  path: string;
  maxBytes?: number;
}

function isSymlink(node: MemoryFile | MemorySymlink): node is MemorySymlink {
  return typeof node === 'object' && !(node instanceof Uint8Array) && 'symlink' in node;
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

/** An in-memory, recording, read-only ScanFs rooted at `/repo`. */
export class MemoryScanFs implements ScanFs {
  readonly calls: FsCall[] = [];
  private readonly files = new Map<string, MemoryFile | MemorySymlink>();
  private readonly dirs = new Set<string>(['']);

  constructor(
    tree: MemoryTree,
    private readonly order: (names: string[]) => string[] = (names) => names,
    readonly root = '/repo',
  ) {
    for (const [key, node] of Object.entries(tree)) {
      const clean = key.replace(/\/+$/, '');
      const parts = clean.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        this.dirs.add(parts.slice(0, i).join('/'));
      }
      if (key.endsWith('/')) {
        this.dirs.add(clean);
      } else {
        this.files.set(clean, node);
      }
    }
  }

  private relative(path: string): string {
    const normal = path.replace(/\\/g, '/');
    const stripped = normal === this.root ? '' : normal.slice(this.root.length + 1);
    return stripped;
  }

  realpath(path: string): Promise<string> {
    this.calls.push({ method: 'realpath', path });
    const rel = this.relative(path);
    return this.dirs.has(rel) || this.files.has(rel)
      ? Promise.resolve(path)
      : Promise.reject(new Error('ENOENT'));
  }

  lstat(path: string): Promise<ScanStat> {
    this.calls.push({ method: 'lstat', path });
    const rel = this.relative(path);
    if (this.dirs.has(rel)) {
      return Promise.resolve({ isDirectory: true, isFile: false, isSymbolicLink: false, size: 0 });
    }
    const node = this.files.get(rel);
    if (node === undefined) {
      return Promise.reject(new Error('ENOENT'));
    }
    if (isSymlink(node)) {
      return Promise.resolve({ isDirectory: false, isFile: false, isSymbolicLink: true, size: 0 });
    }
    const bytes = typeof node === 'string' || node instanceof Uint8Array ? node : node.bytes;
    const reported =
      typeof node === 'object' && !(node instanceof Uint8Array) && node.size !== undefined
        ? node.size
        : toBytes(bytes).length;
    return Promise.resolve({
      isDirectory: false,
      isFile: true,
      isSymbolicLink: false,
      size: reported,
    });
  }

  readdir(path: string): Promise<string[]> {
    this.calls.push({ method: 'readdir', path });
    const rel = this.relative(path);
    if (!this.dirs.has(rel)) {
      return Promise.reject(new Error('ENOTDIR'));
    }
    const prefix = rel === '' ? '' : `${rel}/`;
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (key !== '' && key.startsWith(prefix)) {
        const first = key.slice(prefix.length).split('/')[0];
        if (first !== undefined && first !== '') {
          names.add(first);
        }
      }
    }
    return Promise.resolve(this.order([...names]));
  }

  readFile(path: string, maxBytes: number): Promise<Uint8Array> {
    this.calls.push({ method: 'readFile', path, maxBytes });
    const node = this.files.get(this.relative(path));
    if (node === undefined || isSymlink(node)) {
      return Promise.reject(new Error('ENOENT'));
    }
    const bytes = toBytes(
      typeof node === 'string' || node instanceof Uint8Array ? node : node.bytes,
    );
    return Promise.resolve(bytes.subarray(0, maxBytes));
  }
}
