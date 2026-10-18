import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DETECTORS, scanRepo } from '../../src/scanner/scan-repo.js';
import type { ScanDeps } from '../../src/scanner/scan-repo.js';
import { FolderNotFoundError } from '../../src/scanner/walker.js';
import type { Detector } from '../../src/scanner/detectors/types.js';
import { MemoryScanFs } from '../support/memory-scan-fs.js';
import type { MemoryTree } from '../support/memory-scan-fs.js';

const TERRAFORM = (count: number): string =>
  Array.from({ length: count }, (_, i) => `resource "aws_s3_bucket" "b${i}" {\n}`).join('\n');
const SDK = (clients: number): string =>
  [
    "import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';",
    ...Array.from({ length: clients }, () => 'const c = new SQSClient({});'),
  ].join('\n');

async function scan(tree: MemoryTree, options: Partial<ScanDeps> = {}) {
  const fs = new MemoryScanFs(tree);
  return scanRepo(fs.root, { fs, ...options });
}

describe('scanRepo', () => {
  test('finds services across detectors and reports depth, level and reasoning', async () => {
    const result = await scan({
      'infra/main.tf': TERRAFORM(3),
      'src/app.ts': SDK(2),
      'package.json': JSON.stringify({
        dependencies: { '@aws-sdk/client-sqs': '3', 'aws-cdk-lib': '2' },
      }),
      'notes.md': 'resource "aws_s3_bucket" "x" {',
      'other.tf': 'resource "aws_made_up" "x" {}',
    });
    expect(result.services.map((s) => s.key)).toEqual(['s3', 'sqs']);
    const s3 = result.services[0];
    expect(s3).toMatchObject({ displayName: 'Amazon S3', depth: 'building', suggestedLevel: 300 });
    expect(s3?.evidence.terraformResources).toBe(3);
    expect(result.services[1]).toMatchObject({ key: 'sqs', depth: 'building' });
    expect(result.services[1]?.evidence).toMatchObject({
      sdkImports: 1,
      sdkClients: 2,
      dependencyDeclarations: 1,
    });
    expect(result.unmappedCount).toBe(2);
    expect(result.pythonAnalysed).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.skipped.unsupportedType).toBe(1);
    expect(result.filesRead).toBe(4);
    expect(JSON.stringify(result)).not.toContain('infra');
    expect(JSON.stringify(result)).not.toContain('main.tf');
  });

  test('an empty tree gives no services and the folder error does not echo the path', async () => {
    const result = await scan({ 'readme.md': 'x' });
    expect(result.services).toEqual([]);
    const fs = new MemoryScanFs({});
    await expect(scanRepo('/repo/very-secret-folder', { fs })).rejects.toBeInstanceOf(
      FolderNotFoundError,
    );
  });

  test('a production marker lifts a building service to production', async () => {
    const tree = { 'envs/prod/main.tf': TERRAFORM(1), 'src/a.ts': SDK(1) };
    const sqsTree = { ...tree, 'envs/prod/q.tf': 'resource "aws_sqs_queue" "q" {}' };
    const result = await scan(sqsTree);
    expect(result.services.find((s) => s.key === 'sqs')).toMatchObject({
      depth: 'production',
      suggestedLevel: 400,
    });
  });

  test('custom limits and detectors are honoured and registering boto3 sets pythonAnalysed', async () => {
    const boto3: Detector = {
      id: 'boto3',
      accepts: (name) => name.endsWith('.py'),
      detect: () => [
        { identifierKind: 'boto3Name', identifier: 's3', kind: 'boto3Clients', count: 1 },
      ],
    };
    const result = await scan(
      { 'a.py': 'x', 'b.py': 'y', 'c.tf': TERRAFORM(1) },
      { detectors: [boto3], limits: { maxFiles: 1 } },
    );
    expect(result.pythonAnalysed).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.filesRead).toBe(1);
    expect(result.services[0]).toMatchObject({ key: 's3', depth: 'building' });
  });

  test('without the boto3 detector Python files are not analysed and python is reported as such', async () => {
    const result = await scan(
      { 'a.py': "import boto3\nboto3.client('s3')", 'c.tf': TERRAFORM(1) },
      { detectors: DEFAULT_DETECTORS.filter((d) => d.id !== 'boto3') },
    );
    expect(result.pythonAnalysed).toBe(false);
    expect(result.services[0]?.evidence.boto3Clients).toBe(0);
    const analysed = await scan({ 'a.py': "import boto3\nboto3.client('s3')" });
    expect(analysed.pythonAnalysed).toBe(true);
    expect(analysed.services[0]).toMatchObject({ key: 's3' });
    expect(analysed.services[0]?.evidence.boto3Clients).toBe(1);
  });
});

// Feature: compass-power, Property 2: Excluded paths never contribute evidence
describe('Property 2: excluded paths never contribute evidence', () => {
  const LIMITS = { maxFileBytes: 200 };
  const usage = `${TERRAFORM(2)}\n${SDK(1)}`;
  const counts = fc.integer({ min: 0, max: 2 });

  test('decoys change nothing but the skip counts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          real: fc.integer({ min: 1, max: 3 }),
          excluded: counts,
          gitignored: counts,
          tooLarge: counts,
          binary: counts,
          symlink: counts,
          unsupported: counts,
        }),
        async (spec) => {
          const base: MemoryTree = { '.gitignore': '*.gen.ts\n' };
          for (let i = 0; i < spec.real; i += 1) base[`real/r${i}.ts`] = `${TERRAFORM(1)}`;
          base['real/sdk.ts'] = SDK(1);
          const withDecoys: MemoryTree = { ...base };
          for (let i = 0; i < spec.excluded; i += 1)
            withDecoys[`pkg${i}/node_modules/x.ts`] = usage;
          for (let i = 0; i < spec.gitignored; i += 1) withDecoys[`g${i}.gen.ts`] = usage;
          for (let i = 0; i < spec.tooLarge; i += 1)
            withDecoys[`big${i}.ts`] = usage.padEnd(300, ' ');
          for (let i = 0; i < spec.binary; i += 1) {
            withDecoys[`bin${i}.ts`] = new Uint8Array([0, ...new TextEncoder().encode(usage)]);
          }
          for (let i = 0; i < spec.symlink; i += 1) withDecoys[`link${i}.ts`] = { symlink: true };
          for (let i = 0; i < spec.unsupported; i += 1) withDecoys[`doc${i}.md`] = usage;

          const clean = await scan(base, { limits: LIMITS });
          const dirty = await scan(withDecoys, { limits: LIMITS });
          expect({ ...dirty, skipped: clean.skipped }).toEqual(clean);
          expect(dirty.skipped).toEqual({
            excludedDirectory: spec.excluded,
            gitignored: spec.gitignored,
            tooLarge: spec.tooLarge,
            binary: spec.binary,
            symlink: spec.symlink,
            unsupportedType: spec.unsupported,
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: compass-power, Property 11: Scan results do not depend on listing order
describe('Property 11: scan results do not depend on listing order', () => {
  function hash(text: string): number {
    let h = 7;
    for (const char of text) h = (h * 31 + char.charCodeAt(0)) % 100003;
    return h;
  }

  test('any permutation of directory listings gives deeply equal results', async () => {
    const dirs = ['a', 'b', 'c/d', ''];
    const contents = [TERRAFORM(1), SDK(1), 'plain text', '{"dependencies":{"boto3":"1"}}'];
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(
            fc.constantFrom(...dirs),
            fc.integer({ min: 0, max: 9 }),
            fc.constantFrom(...contents),
          ),
          {
            maxLength: 14,
          },
        ),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 16 }),
        async (files, seed, cap) => {
          const tree: MemoryTree = {};
          for (const [dir, n, content] of files) {
            tree[`${dir === '' ? '' : `${dir}/`}f${n}.ts`] = content;
          }
          const options = { limits: { maxFiles: cap } };
          const plain = await scan(tree, options);
          const fs = new MemoryScanFs(tree, (names) =>
            [...names].sort((x, y) => hash(x + seed) - hash(y + seed) || (x < y ? -1 : 1)),
          );
          const shuffled = await scanRepo(fs.root, { fs, ...options });
          expect(shuffled).toEqual(plain);
        },
      ),
      { numRuns: 100 },
    );
  });
});
