import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { SessionWireSchema } from '../src/index.js';

// Property test for the synthetic catalog validating against the live schema
// (foundation-contracts, S0).
//
// Property 6: The synthetic catalog validates against the live schemas.
// Validates: Requirements 6.5, 12.6.
//
// Every committed session in fixtures/synthetic/catalog.json parses against the
// live SessionWireSchema, and parsing is a safe projection (unknown fields would
// be stripped, required fields are present). The property draws random sessions
// from the committed catalog and asserts each one validates, and that the sampled
// session's required fields survive the parse unchanged.

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');
const catalogPath = resolve(repoRoot, 'fixtures', 'synthetic', 'catalog.json');

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Array<Record<string, unknown>>;

const NUM_RUNS = 200;

describe('Feature: foundation-contracts, Property 6: The synthetic catalog validates against the live schemas', () => {
  test('Feature: foundation-contracts, Property 6: the committed catalog is non-empty and about 120 sessions', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(100);
    expect(catalog.length).toBeLessThanOrEqual(140);
  });

  test('Feature: foundation-contracts, Property 6: every committed session validates', () => {
    // Deterministic full pass: every session validates. This is the core guarantee.
    catalog.forEach((session, index) => {
      const result = SessionWireSchema.safeParse(session);
      expect(result.success, `session index ${index} failed to validate`).toBe(true);
    });
  });

  test('Feature: foundation-contracts, Property 6: a randomly sampled session validates and keeps its required fields', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: catalog.length - 1 }), (index) => {
        const session = catalog[index];
        const result = SessionWireSchema.safeParse(session);
        expect(result.success).toBe(true);
        if (result.success) {
          // sessionId and title are the two required fields and must survive parsing.
          expect(result.data.sessionId).toBe(session.sessionId);
          expect(result.data.title).toBe(session.title);
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
