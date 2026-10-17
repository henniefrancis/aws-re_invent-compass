// The spec writer's file system seam (design, Component 4).
//
// Writes are limited to the Week_Spec folder and `.gitignore`: the writer checks every
// path against the allowed write set before it calls `writeText`, and the Node
// implementation refuses anything outside that set as a second layer.

/** File access for the spec writer. */
export interface SpecFs {
  exists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  /** Writes a file. Refuses any path outside the allowed write set. */
  writeText(path: string, text: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
}
