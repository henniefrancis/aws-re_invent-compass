import type { SpecFs } from '@compass/core/spec';

/** One recorded write-side call. */
export interface SpecCall {
  method: 'createExclusive' | 'appendText' | 'mkdirp';
  path: string;
}

/** An in-memory, recording SpecFs. Paths are opaque strings, compared exactly. */
export class MemorySpecFs implements SpecFs {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  readonly links = new Set<string>();
  readonly calls: SpecCall[] = [];

  exists(path: string): Promise<boolean> {
    return Promise.resolve(
      this.files.has(path) || this.directories.has(path) || this.links.has(path),
    );
  }

  isDirectory(path: string): Promise<boolean> {
    return Promise.resolve(this.directories.has(path));
  }

  isSymlink(path: string): Promise<boolean> {
    return Promise.resolve(this.links.has(path));
  }

  readText(path: string): Promise<string> {
    const text = this.files.get(path);
    return text === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(text);
  }

  createExclusive(path: string, text: string): Promise<void> {
    this.calls.push({ method: 'createExclusive', path });
    if (this.files.has(path) || this.links.has(path) || this.directories.has(path)) {
      return Promise.reject(new Error('EEXIST'));
    }
    this.files.set(path, text);
    return Promise.resolve();
  }

  appendText(path: string, text: string): Promise<void> {
    this.calls.push({ method: 'appendText', path });
    const existing = this.files.get(path);
    if (existing === undefined || this.links.has(path)) {
      return Promise.reject(new Error('EACCES'));
    }
    this.files.set(path, existing + text);
    return Promise.resolve();
  }

  mkdirp(path: string): Promise<void> {
    this.calls.push({ method: 'mkdirp', path });
    this.directories.add(path);
    return Promise.resolve();
  }
}
