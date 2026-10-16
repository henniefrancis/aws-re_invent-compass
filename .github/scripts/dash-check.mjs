// dash-check (foundation-contracts, S0). Enforce the house rule that no em dash
// (U+2014) or en dash (U+2013) appears anywhere in the repository (product.md,
// tech.md and the workflow steering). LICENSE is the single named exception,
// because its upstream text is reproduced verbatim.
//
// The scanner enumerates tracked files with `git ls-files` (so untracked and
// git-ignored files are not scanned), reads each as UTF-8, and reports every
// offending file and line with the dash kind named (em dash or en dash). It
// never prints the surrounding line text. Dependency free: Node builtins only.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maybeRunCli } from './cli.mjs';

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, '..', '..');

// The single named exclusion. Compared against the git-relative path with forward
// slashes, which is how `git ls-files` prints paths on every platform.
export const EXCLUDED = new Set(['LICENSE']);

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

/**
 * List the repository's tracked files as git-relative POSIX paths.
 *
 * @param {string} [cwd] the repository root
 * @returns {string[]}
 */
export function listTrackedFiles(cwd = repoRoot) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' });
  // git ls-files -z separates entries with a NUL and prints no trailing newline.
  return out.split('\0').filter((p) => p.length > 0);
}

/**
 * Scan the given text for em and en dashes, returning one finding per occurrence
 * with the 1-based line and column and the dash kind. Never returns line text.
 *
 * @param {string} text
 * @returns {Array<{ line: number, column: number, kind: string }>}
 */
export function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    for (let col = 0; col < line.length; col += 1) {
      const ch = line[col];
      if (ch === EM_DASH) {
        findings.push({ line: lineIndex + 1, column: col + 1, kind: 'em dash' });
      } else if (ch === EN_DASH) {
        findings.push({ line: lineIndex + 1, column: col + 1, kind: 'en dash' });
      }
    }
  });
  return findings;
}

/**
 * Scan every tracked file except the named exclusion.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {string[]} [options.files] an explicit file list (git-relative), for tests
 * @returns {{ ok: boolean, findings: Array<{file: string, line: number, column: number, kind: string}> }}
 */
export function dashCheck({ cwd = repoRoot, files } = {}) {
  const tracked = files ?? listTrackedFiles(cwd);
  const findings = [];
  for (const file of tracked) {
    if (EXCLUDED.has(file)) {
      continue;
    }
    let text;
    try {
      text = readFileSync(resolve(cwd, file), 'utf8');
    } catch {
      // A listed path that cannot be read as text (for example a deleted but still
      // staged entry) is skipped rather than failing the whole scan.
      continue;
    }
    for (const hit of scanText(text)) {
      findings.push({ file, ...hit });
    }
  }
  return { ok: findings.length === 0, findings };
}

/**
 * Pure CLI driver: returns the exit code and the lines to print without touching
 * the process. Covers the ok, findings and error branches in-process.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {string[]} [options.files]
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
export function runCli({ cwd = repoRoot, files, dashCheckFn = dashCheck } = {}) {
  try {
    const { ok, findings } = dashCheckFn({ cwd, files });
    if (ok) {
      return {
        code: 0,
        stdout: 'dash check ok: no em or en dashes in tracked files\n',
        stderr: '',
      };
    }
    let stderr = 'dash check FAILED: em or en dashes found\n';
    for (const f of findings) {
      stderr += `  ${f.file}:${f.line}:${f.column} (${f.kind})\n`;
    }
    return { code: 1, stdout: '', stderr };
  } catch (error) {
    return { code: 1, stdout: '', stderr: `${error.message}\n` };
  }
}

await maybeRunCli({ runCli, argv1: process.argv[1], metaUrl: import.meta.url });
