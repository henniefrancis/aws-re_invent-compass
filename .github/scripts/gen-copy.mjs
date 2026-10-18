// gen:copy (foundation-contracts, S0). Byte-copy the single-source Compass API
// OpenAPI document to its two consumers so all three stay identical:
//   contracts/compass-api.openapi.yaml  (the single source)
//     -> packages/contracts/openapi.yaml        (TypeScript types are generated)
//     -> infra/modules/api/openapi.yaml          (fed to the API Gateway body)
//
// The copy is a raw byte copy (no reformatting) so the SHA-256 hash check in CI
// can prove the three files are identical. Destination directories are created
// if missing. Dependency free: Node builtins only.

import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maybeRunCli } from './cli.mjs';

const thisDir = dirname(fileURLToPath(import.meta.url));
// This script lives at .github/scripts/, so the repo root is two levels up.
const repoRoot = resolve(thisDir, '..', '..');

export const SOURCE = resolve(repoRoot, 'contracts', 'compass-api.openapi.yaml');
export const COPIES = [
  resolve(repoRoot, 'packages', 'contracts', 'openapi.yaml'),
  resolve(repoRoot, 'infra', 'modules', 'api', 'openapi.yaml'),
];

/**
 * Copy the source document byte for byte to each destination, writing atomically
 * (temp file then rename) and creating destination directories as needed.
 *
 * @param {object} [options]
 * @param {string} [options.source] The single-source document path.
 * @param {string[]} [options.copies] The destination paths.
 * @returns {Promise<{ source: string, copies: string[], bytes: number }>}
 */
export async function genCopy({ source = SOURCE, copies = COPIES } = {}) {
  const bytes = await readFile(source);
  for (const dest of copies) {
    await mkdir(dirname(dest), { recursive: true });
    const tempPath = `${dest}.tmp-${process.pid}`;
    try {
      await writeFile(tempPath, bytes);
      await rename(tempPath, dest);
    } catch (cause) {
      await removeQuietly(tempPath);
      throw cause;
    }
  }
  return { source, copies, bytes: bytes.byteLength };
}

/**
 * Remove a file, ignoring any error (best-effort cleanup). Named and exported so
 * both its success and its ignored-error paths are covered by tests.
 *
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function removeQuietly(path) {
  try {
    await unlink(path);
  } catch {
    // Best effort: a missing temp file is fine.
  }
}

/**
 * Pure CLI driver: returns the exit code and the lines to print without touching
 * the process. Covers the success and error branches in-process.
 *
 * @param {object} [options]
 * @param {string} [options.source]
 * @param {string[]} [options.copies]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function runCli({ source = SOURCE, copies = COPIES } = {}) {
  try {
    const result = await genCopy({ source, copies });
    return {
      code: 0,
      stdout: `Copied ${result.bytes} bytes from ${result.source} to ${result.copies.length} destinations\n`,
      stderr: '',
    };
  } catch (error) {
    return { code: 1, stdout: '', stderr: `${error.message}\n` };
  }
}

await maybeRunCli({ runCli, argv1: process.argv[1], metaUrl: import.meta.url });
