// Shared helpers for the static scans of the infra stream (S6).
//
// The scans run offline with Node builtins only: node --test infra/tests/static
// They read the files this stream owns (infra/**, scripts/**, docs/runbooks/**)
// and never touch AWS, HCP Terraform or any credential.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..', '..');

const OWNED_PREFIXES = ['infra/', 'scripts/', 'docs/runbooks/'];
const BINARY_EXTENSIONS = new Set(['.zip', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf']);

/**
 * Files owned by this stream that are committed or about to be: tracked files
 * plus untracked files that are not git-ignored. Paths use forward slashes.
 *
 * @returns {string[]}
 */
export function listOwnedFiles() {
  const out = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'infra',
      'scripts',
      'docs/runbooks',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return [...new Set(out.split('\0').filter((p) => p.length > 0))]
    .filter((p) => OWNED_PREFIXES.some((prefix) => p.startsWith(prefix)))
    .filter((p) => existsSync(resolve(repoRoot, p)))
    .filter((p) => !BINARY_EXTENSIONS.has(extname(p).toLowerCase()))
    .sort();
}

/**
 * @param {string} relativePath path from the repository root
 * @returns {string}
 */
export function readOwned(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

/**
 * Terraform source files owned by this stream, excluding the native test files.
 *
 * @returns {string[]}
 */
export function listTerraformSources() {
  return listOwnedFiles().filter((p) => p.endsWith('.tf'));
}

/**
 * Split a Terraform file into its top-level output blocks.
 *
 * @param {string} source
 * @returns {Array<{ name: string, body: string }>}
 */
export function parseOutputs(source) {
  const blocks = [];
  const header = /^output\s+"([^"]+)"\s*\{/gm;
  let match = header.exec(source);
  while (match !== null) {
    let depth = 1;
    let index = header.lastIndex;
    while (depth > 0 && index < source.length) {
      const ch = source[index];
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      index += 1;
    }
    blocks.push({ name: match[1], body: source.slice(header.lastIndex, index - 1) });
    header.lastIndex = index;
    match = header.exec(source);
  }
  return blocks;
}

/**
 * Remove whole-line and trailing comments from Terraform or shell text so scans
 * look at code only.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripHashComments(source) {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}
