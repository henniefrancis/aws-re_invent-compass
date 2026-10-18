// hash-check (foundation-contracts, S0). Prove the three Compass API OpenAPI
// files are byte-identical by comparing their SHA-256 hashes:
//   contracts/compass-api.openapi.yaml   (the single source)
//   packages/contracts/openapi.yaml       (generated-types input copy)
//   infra/modules/api/openapi.yaml         (API Gateway body copy)
//
// On a mismatch the script reports which file differs, using SHA-256 prefixes
// only (never the file contents), and exits non-zero. On a match it exits zero.
// Dependency free: Node builtins only.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maybeRunCli } from './cli.mjs';

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, '..', '..');

export const FILES = [
  resolve(repoRoot, 'contracts', 'compass-api.openapi.yaml'),
  resolve(repoRoot, 'packages', 'contracts', 'openapi.yaml'),
  resolve(repoRoot, 'infra', 'modules', 'api', 'openapi.yaml'),
];

/**
 * Hash each file and compare. Returns the per-file hashes and whether they all
 * match. Never returns or logs file contents.
 *
 * @param {object} [options]
 * @param {string[]} [options.files]
 * @returns {Promise<{ ok: boolean, hashes: Array<{file: string, sha256: string}> }>}
 */
export async function hashCheck({ files = FILES } = {}) {
  const hashes = [];
  for (const file of files) {
    const bytes = await readFile(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    hashes.push({ file, sha256 });
  }
  const first = hashes[0]?.sha256;
  const ok = hashes.every((h) => h.sha256 === first);
  return { ok, hashes };
}

/**
 * Pure CLI driver: compute the result and return the exit code and the lines to
 * print, without touching process. Testable in-process so every branch (ok,
 * mismatch, error) is covered without a subprocess.
 *
 * @param {object} [options]
 * @param {string[]} [options.files]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function runCli({ files = FILES } = {}) {
  try {
    const { ok, hashes } = await hashCheck({ files });
    if (ok) {
      return {
        code: 0,
        stdout: `hash check ok: ${hashes.length} files share sha256 ${hashes[0].sha256.slice(0, 12)}\n`,
        stderr: '',
      };
    }
    let stderr = 'hash check FAILED: the Compass API copies differ\n';
    for (const h of hashes) {
      stderr += `  ${relative(repoRoot, h.file)}: ${h.sha256.slice(0, 12)}\n`;
    }
    return { code: 1, stdout: '', stderr };
  } catch (error) {
    return { code: 1, stdout: '', stderr: `${error.message}\n` };
  }
}

await maybeRunCli({ runCli, argv1: process.argv[1], metaUrl: import.meta.url });
