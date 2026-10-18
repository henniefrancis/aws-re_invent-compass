// Path containment for the scan (security M2). The two paths are real paths, so a link has already
// been resolved. `relative` is the host's own by default; tests pass `posix` and `win32` explicitly.

import { isAbsolute, relative } from 'node:path';

/** The two path functions `isInside` uses. */
export interface PathApi {
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
}

const HOST: PathApi = { relative, isAbsolute };

/** True when `candidate` is `base` or a folder or file below it. */
export function isInside(candidate: string, base: string, api: PathApi = HOST): boolean {
  const path = api.relative(base, candidate);
  return path === '' || (!path.startsWith('..') && !api.isAbsolute(path));
}
