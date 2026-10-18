// File system seams. The scanner and the spec writer define their own interfaces in
// @compass/core; this module re-exports them. The snapshot store uses S4's `FileSystem`.

export type { ScanFs } from '@compass/core/scanner';
export type { SpecFs } from '@compass/core/spec';
