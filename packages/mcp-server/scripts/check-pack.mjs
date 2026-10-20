// Checks the file list that `npm pack --dry-run --json` reports, before anything is published.
//
//   npm pack --dry-run --json --workspace packages/mcp-server > pack.json
//   node packages/mcp-server/scripts/check-pack.mjs pack.json
//
// The package must hold the bundles, the worker, the data and fixtures, the README and the
// manifest, and nothing else: no source, no tests, no type-check output, no secrets. The check is
// exported so a test runs it against a real dry run.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Files that must be in the package. */
export const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'dist/bin.js',
  'dist/scan-worker.js',
  'dist/github-scan-worker.js',
  'dist/data/venues.json',
  'dist/sample-repo/infra/main.tf',
  'dist/fixtures/api/get-event/success.json',
  'dist/fixtures/synthetic/catalog.json',
];

/** Every file must match one of these. */
export const ALLOWED_FILE =
  /^(?:package\.json|README\.md|dist\/(?:bin\.js|scan-worker\.js|github-scan-worker\.js)|dist\/(?:data|sample-repo|fixtures)\/.+)$/;

/** Returns the problems found in a list of packed file paths (empty when it is fine). */
export function checkPackFiles(paths) {
  const problems = [];
  for (const required of REQUIRED_FILES) {
    if (!paths.includes(required)) {
      problems.push(`missing: ${required}`);
    }
  }
  for (const path of paths) {
    if (!ALLOWED_FILE.test(path) || path.endsWith('.ts') || path.includes('..')) {
      problems.push(`unexpected: ${path}`);
    }
  }
  return problems;
}

/** The file paths in the JSON that `npm pack --json` prints. */
export function pathsFromPackJson(text) {
  const parsed = JSON.parse(text);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return (first?.files ?? []).map((file) => String(file.path));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (file === undefined) {
    console.error('usage: node check-pack.mjs <pack.json>');
    process.exit(2);
  }
  const problems = checkPackFiles(pathsFromPackJson(await readFile(file, 'utf8')));
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('the package file list is as expected');
}
