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
import { fileURLToPath, pathToFileURL } from 'node:url';

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
      await unlink(tempPath).catch(() => {});
      throw cause;
    }
  }
  return { source, copies, bytes: bytes.byteLength };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  genCopy()
    .then((result) => {
      process.stdout.write(
        `Copied ${result.bytes} bytes from ${result.source} to ${result.copies.length} destinations\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
