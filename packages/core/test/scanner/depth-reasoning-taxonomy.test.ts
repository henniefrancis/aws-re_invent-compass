import { DASH_PATTERN } from '../support/dashes.js';
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { classifyDepth, depthToNumber, score, suggestLevel } from '../../src/scanner/depth.js';
import type { DepthName } from '../../src/scanner/depth.js';
import { EVIDENCE_KINDS, aggregateHits, emptyEvidence } from '../../src/scanner/evidence.js';
import type { Evidence } from '../../src/scanner/evidence.js';
import { explain } from '../../src/scanner/reasoning.js';
import { SERVICE_TABLE, entryFor } from '../../src/scanner/service-table.js';
import { mapToTaxonomy } from '../../src/scanner/taxonomy.js';

const countArb = fc.oneof(fc.constant(0), fc.constant(0), fc.integer({ min: 1, max: 15 }));
const evidenceArb: fc.Arbitrary<Evidence> = fc.record({
  terraformResources: countArb,
  cdkConstructs: countArb,
  cdkImports: countArb,
  sdkImports: countArb,
  sdkClients: countArb,
  sdkCommands: countArb,
  boto3Clients: countArb,
  dependencyDeclarations: countArb,
});

const RANK: Record<DepthName, number> = { none: 0, exploring: 1, building: 2, production: 3 };

function oracleDepth(e: Evidence, marker: boolean): DepthName {
  const all = Object.values(e).reduce((a, b) => a + b, 0);
  if (all === 0) return 'none';
  const buildingSignal =
    e.terraformResources + e.cdkConstructs + e.sdkClients + e.sdkCommands + e.boto3Clients > 0;
  if (!buildingSignal) return 'exploring';
  const weighted =
    2 * (e.terraformResources + e.cdkConstructs + e.sdkClients + e.boto3Clients) +
    e.sdkCommands +
    e.cdkImports +
    e.sdkImports +
    e.dependencyDeclarations;
  const infrastructure = e.terraformResources + e.cdkConstructs >= 1;
  const code = e.sdkClients + e.sdkCommands + e.boto3Clients >= 1;
  return infrastructure && code && (weighted >= 12 || marker) ? 'production' : 'building';
}

describe('depth rules', () => {
  test('score weights infrastructure and clients double', () => {
    expect(score({ ...emptyEvidence(), terraformResources: 3, sdkCommands: 2 })).toBe(8);
  });

  test('worked examples from the documented tables', () => {
    expect(classifyDepth(emptyEvidence(), false)).toBe('none');
    expect(classifyDepth({ ...emptyEvidence(), sdkImports: 1 }, false)).toBe('exploring');
    expect(classifyDepth({ ...emptyEvidence(), terraformResources: 1 }, true)).toBe('building');
    const prod = { ...emptyEvidence(), terraformResources: 1, sdkClients: 1 };
    expect(classifyDepth(prod, false)).toBe('building');
    expect(classifyDepth(prod, true)).toBe('production');
    expect(suggestLevel({ ...emptyEvidence(), sdkImports: 1 }, 'exploring')).toBe(100);
    expect(suggestLevel({ ...emptyEvidence(), sdkImports: 2 }, 'exploring')).toBe(200);
    expect(suggestLevel(prod, 'building')).toBe(300);
    expect(suggestLevel(prod, 'production')).toBe(400);
    expect(suggestLevel(emptyEvidence(), 'none')).toBeUndefined();
    expect(
      ['none', 'exploring', 'building', 'production'].map((d) => depthToNumber(d as DepthName)),
    ).toEqual([0, 1, 2, 3]);
  });
});

// Feature: compass-power, Property 10: Depth follows the documented rules and never drops as evidence grows
describe('Property 10: depth follows the rules and never drops as evidence grows', () => {
  test('classifyDepth equals the rule table and the level is defined exactly when depth is not none', () => {
    fc.assert(
      fc.property(evidenceArb, fc.boolean(), (e, marker) => {
        const depth = classifyDepth(e, marker);
        expect(depth).toBe(oracleDepth(e, marker));
        const level = suggestLevel(e, depth);
        if (depth === 'none') {
          expect(level).toBeUndefined();
        } else {
          expect([100, 200, 300, 400]).toContain(level);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('more evidence never lowers depth or level', () => {
    fc.assert(
      fc.property(
        evidenceArb,
        evidenceArb,
        fc.boolean(),
        fc.boolean(),
        (a, delta, markerA, markerExtra) => {
          const b = emptyEvidence();
          for (const kind of EVIDENCE_KINDS) b[kind] = a[kind] + delta[kind];
          const markerB = markerA || markerExtra;
          const depthA = classifyDepth(a, markerA);
          const depthB = classifyDepth(b, markerB);
          expect(RANK[depthB]).toBeGreaterThanOrEqual(RANK[depthA]);
          const levelA = suggestLevel(a, depthA);
          const levelB = suggestLevel(b, depthB);
          if (levelA !== undefined) {
            expect(levelB).toBeDefined();
            expect(levelB ?? 0).toBeGreaterThanOrEqual(levelA);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// Feature: compass-power, Property 13: Reasoning is plain English that states the counts
describe('Property 13: reasoning is plain English that states the counts', () => {
  test('names the service, every count, the depth and the level in short sentences', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SERVICE_TABLE),
        evidenceArb,
        fc.boolean(),
        (entry, e, marker) => {
          const depth = classifyDepth(e, marker);
          const level = suggestLevel(e, depth);
          const text = explain(entry, e, depth, level);
          expect(text).toContain(entry.displayName);
          expect(text).toContain(depth);
          expect(text).not.toMatch(DASH_PATTERN);
          for (const sentence of text.split(/(?<=\.) /)) {
            expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(25);
          }
          if (level !== undefined) {
            expect(text).toContain(`level ${level}`);
            for (const kind of EVIDENCE_KINDS) {
              if (e[kind] > 0) {
                expect(text).toMatch(new RegExp(`\\b${e[kind]}\\b`));
              }
            }
          } else {
            expect(text).toContain('no level');
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test('uses singular forms for a count of one', () => {
    const entry = entryFor('s3');
    if (entry === undefined) throw new Error('s3 missing');
    const everything = Object.fromEntries(EVIDENCE_KINDS.map((k) => [k, 1]));
    const text = explain(entry, everything, 'production', 400);
    expect(text).toContain('1 Amazon S3 resource in Terraform');
    expect(text).toContain('1 time');
    expect(text).toContain('1 Amazon S3 dependency');
    const plural = Object.fromEntries(EVIDENCE_KINDS.map((k) => [k, 2]));
    expect(explain(entry, plural, 'production', 400)).toContain('2 Amazon S3 dependencies');
  });
});

describe('evidence aggregation', () => {
  test('groups hits by service and counts unmapped identifiers', () => {
    const { byService, unmappedCount } = aggregateHits([
      {
        identifierKind: 'terraformType',
        identifier: 'aws_s3_bucket',
        kind: 'terraformResources',
        count: 2,
      },
      { identifierKind: 'sdkClientName', identifier: 'S3', kind: 'sdkClients', count: 1 },
      {
        identifierKind: 'terraformType',
        identifier: 'aws_made_up',
        kind: 'terraformResources',
        count: 4,
      },
    ]);
    expect(byService.get('s3')).toMatchObject({ terraformResources: 2, sdkClients: 1 });
    expect(unmappedCount).toBe(4);
  });

  test('the service table is sorted by key', () => {
    const keys = SERVICE_TABLE.map((e) => e.key);
    expect([...keys].sort()).toEqual(keys);
  });
});

// Feature: compass-power, Property 15: Taxonomy labels are always taken from the catalog
describe('Property 15: taxonomy labels are always taken from the catalog', () => {
  const caseArb = fc.constantFrom('same', 'upper', 'lower');
  test('every label is a catalog element and inCatalog is exact', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...SERVICE_TABLE.map((e) => e.key)), { maxLength: 8 }),
        fc.array(
          fc.tuple(fc.constantFrom(...SERVICE_TABLE.flatMap((e) => e.taxonomyCandidates)), caseArb),
          { maxLength: 12 },
        ),
        fc.array(fc.constantFrom('Other', 'misc', 'Totally Different'), { maxLength: 3 }),
        (keys, picks, others) => {
          const labels = [
            ...picks.map(([label, how]) =>
              how === 'upper' ? label.toUpperCase() : how === 'lower' ? label.toLowerCase() : label,
            ),
            ...others,
          ];
          const matches = mapToTaxonomy(
            keys.map((key) => ({ key })),
            labels,
          );
          expect(matches.map((m) => m.key)).toEqual(keys);
          const lowered = new Set(labels.map((l) => l.toLowerCase()));
          for (const match of matches) {
            const candidates = (entryFor(match.key)?.taxonomyCandidates ?? []).map((c) =>
              c.toLowerCase(),
            );
            for (const label of match.labels) {
              expect(labels).toContain(label);
              expect(candidates).toContain(label.toLowerCase());
            }
            expect(match.inCatalog).toBe(candidates.some((c) => lowered.has(c)));
            expect(match.inCatalog).toBe(match.labels.length > 0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test('an unknown key has no candidates', () => {
    expect(mapToTaxonomy([{ key: 'unknown' }], ['Amazon S3'])).toEqual([
      { key: 'unknown', labels: [], inCatalog: false },
    ]);
  });
});
