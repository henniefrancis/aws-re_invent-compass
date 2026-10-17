// The spec writer's file system seam (design, Component 4; CTO review M3).
//
// The writer checks every path against the allowed write set and every existing path
// component under the root with `isSymlink` before it writes. Files are created with the
// exclusive flag (`wx`), so an existing file or link is never overwritten, and appends go
// only to an existing regular file. The Node implementation re-checks these rules as a
// second layer.

/** File access for the spec writer. */
export interface SpecFs {
  exists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  /** True when the path itself is a symbolic link (lstat). A missing path is not a link. */
  isSymlink(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  /** Creates a new file with the exclusive flag. Rejects when the path already exists. */
  createExclusive(path: string, text: string): Promise<void>;
  /** Appends to an existing regular file. Refuses a symbolic link. */
  appendText(path: string, text: string): Promise<void>;
  /** Creates a directory and its parents. */
  mkdirp(path: string): Promise<void>;
}
