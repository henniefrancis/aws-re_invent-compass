import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';

// Property test for deterministic catalog generation (foundation-contracts, S0).
//
// Property 7: Catalog generation is deterministic.
// Validates: Requirements 6.1, 6.6.
//
// Generating the catalog from the same seed always yields byte-identical output,
// regardless of how many times it runs, and that output equals the committed
// fixtures/synthetic/catalog.json. Different seeds yield different output (so the
// seed genuinely drives the content), while the structure stays valid.
//
// The generator is TypeScript imported at runtime via the file URL so Node's
// native type stripping loads it (the same mechanism catalog-check.mjs uses).

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');
const syntheticDir = resolve(repoRoot, 'fixtures', 'synthetic');
const generatorUrl = pathToFileURL(resolve(syntheticDir, 'generate.ts')).href;
const catalogPath = resolve(syntheticDir, 'catalog.json');

const NUM_RUNS = 120;

interface Generator {
  SEED: number;
  generateCatalog: (opts?: { seed?: number; count?: number }) => Array<{ sessionId: string }>;
  stableStringify: (value: unknown) => string;
  mulberry32: (seed: number) => () => number;
}

const gen = (await import(generatorUrl)) as unknown as Generator;

describe('Feature: foundation-contracts, Property 7: Catalog generation is deterministic', () => {
  test('Feature: foundation-contracts, Property 7: the same seed yields byte-identical output every run', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (runs) => {
        const outputs = new Set<string>();
        for (let i = 0; i < runs; i += 1) {
          outputs.add(gen.stableStringify(gen.generateCatalog()));
        }
        // No matter how many times it runs, there is exactly one distinct output.
        expect(outputs.size).toBe(1);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('Feature: foundation-contracts, Property 7: generator output equals the committed catalog', () => {
    const committed = readFileSync(catalogPath, 'utf8');
    const regenerated = gen.stableStringify(gen.generateCatalog());
    expect(regenerated).toBe(committed);
  });

  test('Feature: foundation-contracts, Property 7: a different seed yields different content', () => {
    const base = gen.stableStringify(gen.generateCatalog({ seed: gen.SEED }));
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0x7fffffff }).filter((s) => s !== gen.SEED),
        (seed) => {
          const other = gen.stableStringify(gen.generateCatalog({ seed }));
          // A different seed should produce different content. (Collisions are
          // astronomically unlikely for this generator, but assert inequality to
          // prove the seed actually drives the output.)
          expect(other).not.toBe(base);
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });

  test('Feature: foundation-contracts, Property 7: mulberry32 is a pure function of its seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x7fffffff }), (seed) => {
        const a = gen.mulberry32(seed);
        const b = gen.mulberry32(seed);
        // Two generators from the same seed yield the same sequence.
        for (let i = 0; i < 8; i += 1) {
          expect(a()).toBe(b());
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
