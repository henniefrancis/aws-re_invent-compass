// Which directories the scanner never enters and which files it may read
// (Requirements 1.3 and 1.8).

/** Directory names the scanner skips entirely. */
export const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'cdk.out',
  '.terraform',
  'coverage',
  '.next',
  'target',
  '__pycache__',
  '.venv',
  'venv',
]);

/** File extensions the scanner reads. */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  '.tf',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
];

/** Exact file names the scanner reads. */
export const SUPPORTED_NAMES: ReadonlySet<string> = new Set(['package.json', 'requirements.txt']);

/** True when a directory with this name is never entered. */
export function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORIES.has(name);
}

/** True when a file with this name may be read: a supported extension or an exact name. */
export function isSupportedFile(name: string): boolean {
  return SUPPORTED_NAMES.has(name) || SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}
