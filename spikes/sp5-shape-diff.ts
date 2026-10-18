// SP5 spike: shape diff of real recordings against the synthetic catalog
// (foundation-contracts, S0).
//
// This is a thin, operator-run wrapper. It is NOT a CI or test action: the test
// suite exercises the diff logic in spikes/src/shape-diff.ts directly and never
// needs a real recording. Real recordings live in the git-ignored fixtures/.raw/.
//
// Run directly under Node 24 with type stripping (no build step):
//   node spikes/sp5-shape-diff.ts
//
// Behaviour (all in runShapeDiff, which this wrapper only wires to files):
//   - If fixtures/.raw/ is absent or contains no .json recordings, print
//     "no recordings present" and exit 0 (Requirement 10.4).
//   - Otherwise diff each recording's shape against the first synthetic catalog
//     session and print FIELD-LEVEL differences only (names and type descriptors).
//     No recorded value is ever printed (Requirement 10.6).
//
// This file contains no em dash or en dash.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runShapeDiff } from './src/shape-diff.ts';

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, '..');
const rawDir = resolve(repoRoot, 'fixtures', '.raw');
const catalogPath = resolve(repoRoot, 'fixtures', 'synthetic', 'catalog.json');

async function main(): Promise<void> {
  // The reference shape is the first synthetic catalog session.
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as unknown[];
  const reference = catalog[0];

  const { lines, exitCode } = await runShapeDiff({ rawDir, reference });
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  process.exitCode = exitCode;
}

await main();
