// Which directories the scanner never enters and which files it may read
// (Requirements 1.3 and 1.8; compass-power task 41.2 adds the technology manifests, the
// .NET project files and C# source).

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

/** File extensions the scanner reads. `.sln` is read for technology only. */
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
  '.cs',
  '.csproj',
  '.fsproj',
  '.sln',
];

/** Exact file names the scanner reads. All but `package.json` and `requirements.txt` are read for technology only. */
export const SUPPORTED_NAMES: ReadonlySet<string> = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'composer.json',
  'global.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Chart.yaml',
  'kustomization.yaml',
  'kustomization.yml',
]);

/** True when a directory with this name is never entered. */
export function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORIES.has(name);
}

/** True when a file with this name may be read: a supported extension or an exact name. */
export function isSupportedFile(name: string): boolean {
  return SUPPORTED_NAMES.has(name) || SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}
