import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
// The hash-check scanner is an ESM .mjs under .github/scripts, imported by
// relative path. It is not in the coverage include set, so this test checks
// behaviour without affecting coverage thresholds.
import { hashCheck } from '../../../.github/scripts/hash-check.mjs';

// Property test for the three-way hash equality of the Compass API copies
// (foundation-contracts, S0).
//
// Property 8: The three Compass API OpenAPI copies are hash-equal.
// Validates: Requirements 5.4, 5.5, 5.6, 12.3.
//
// The hash check reports ok exactly when all three files are byte-identical, and
// reports a mismatch when any one copy diverges by even a single byte. Hashes are
// SHA-256 and the result never carries file contents.

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');

const NUM_RUNS = 120;

describe('Feature: foundation-contracts, Property 8: The three Compass API OpenAPI copies are hash-equal', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hash-check-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('Feature: foundation-contracts, Property 8: identical content hashes equal; any divergence is detected', async () => {
    const files = [join(dir, 'a.yaml'), join(dir, 'b.yaml'), join(dir, 'c.yaml')];
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 200 }),
        // A mutation applied to exactly one copy, plus which copy to mutate.
        fc.record({
          which: fc.constantFrom(0, 1, 2),
          suffix: fc.string({ minLength: 1, maxLength: 8 }),
        }),
        async (content, mutation) => {
          // 1. Three identical copies hash-equal and the check is ok. Write the
          // three files once for this run.
          await Promise.all(files.map((f) => writeFile(f, content, 'utf8')));
          const okResult = await hashCheck({ files });
          expect(okResult.ok).toBe(true);
          // All three hashes are identical and are 64-hex SHA-256 digests.
          const hashes = okResult.hashes.map((h) => h.sha256);
          expect(new Set(hashes).size).toBe(1);
          expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);

          // 2. Mutating exactly one copy by appending a non-empty suffix makes the
          // check report a mismatch. Only the one differing file is rewritten.
          await writeFile(files[mutation.which], content + mutation.suffix, 'utf8');
          const badResult = await hashCheck({ files });
          expect(badResult.ok).toBe(false);
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
    // Real file I/O across many runs under parallel load: allow generous time.
  }, 30000);

  test('Feature: foundation-contracts, Property 8: the committed copies are hash-equal', async () => {
    const files = [
      resolve(repoRoot, 'contracts', 'compass-api.openapi.yaml'),
      resolve(repoRoot, 'packages', 'contracts', 'openapi.yaml'),
      resolve(repoRoot, 'infra', 'modules', 'api', 'openapi.yaml'),
    ];
    const { ok, hashes } = await hashCheck({ files });
    expect(ok).toBe(true);
    expect(new Set(hashes.map((h) => h.sha256)).size).toBe(1);
  });
});
