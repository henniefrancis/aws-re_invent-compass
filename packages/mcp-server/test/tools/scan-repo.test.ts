import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { mcpTools } from '@compass/contracts';
import {
  createNodeScanFs,
  DEFAULT_DETECTORS,
  depthToNumber,
  scanRepo,
} from '@compass/core/scanner';
import { CompassError } from '../../src/ports/errors.js';
import { scanRepoTool } from '../../src/tools/scan-repo.js';
import { DATA_PREAMBLE } from '../../src/safety/labelled-data.js';
import { buildCatalogView, repoRoot, wireSession } from '../support/fake-catalog.js';
import { contextFor } from '../support/context.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { MemoryScanFs } from '../support/memory-scan-fs.js';
import type { MemoryTree } from '../support/memory-scan-fs.js';
import { connect, textOf } from '../support/connect.js';
import { join } from 'node:path';

const TF = (type: string, count = 1): string =>
  Array.from({ length: count }, (_, i) => `resource "${type}" "r${i}" {}`).join('\n');
const SDK = "import { SQSClient } from '@aws-sdk/client-sqs';\nnew SQSClient({});";

function runtimeFor(tree: MemoryTree, withCatalog = true) {
  const fs = new MemoryScanFs(tree);
  const fake = createFakeRuntime({
    scanFs: fs,
    ...(withCatalog
      ? { catalog: buildCatalogView([wireSession('a', { services: ['storage'] })]) }
      : {}),
  });
  return { fake, fs };
}

describe('scan_repo', () => {
  test('reports services with depth and level, keeps the result and sets the workspace root', async () => {
    const { fake, fs } = runtimeFor({
      'infra/main.tf': TF('aws_s3_bucket', 2),
      'src/q.ts': SDK,
      'a.tf': TF('aws_made_up'),
    });
    fake.runtime.scanDetectors = DEFAULT_DETECTORS.filter((d) => d.id !== 'boto3');
    const ctx = contextFor(fake);
    const outcome = await scanRepoTool({ path: fs.root }, ctx);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(mcpTools.scan_repo.output.parse(outcome.structured)).toEqual({
        services: ['Amazon S3', 'Amazon SQS'],
        depthByService: [
          { service: 'Amazon S3', depth: 2 },
          { service: 'Amazon SQS', depth: 2 },
        ],
      });
      expect(outcome.text).toContain('Amazon S3: building (depth 2), suggested level 300.');
      expect(outcome.text).toContain('Python files were not analysed.');
      expect(outcome.text).toContain('1 AWS references did not match a known service');
      expect(outcome.text).toContain('Catalog service labels');
      expect(outcome.text).toContain(DATA_PREAMBLE);
      expect(outcome.text).not.toContain('infra');
    }
    expect(ctx.state.lastScan?.root).toBe(fs.root);
    expect(ctx.state.lastScan?.taxonomy.find((m) => m.key === 's3')).toMatchObject({
      labels: ['storage'],
      inCatalog: true,
    });
    expect(ctx.state.workspaceRoot('/cwd')).toBe(fs.root);
    expect(fake.events.writeCalls).toEqual([]);
  });

  test('python files are analysed by default, and the note appears only when no boto3 detector is registered', async () => {
    const { fake, fs } = runtimeFor({ 'a.py': "import boto3\nboto3.client('s3')" });
    const outcome = await scanRepoTool({ path: fs.root }, contextFor(fake));
    expect(outcome.ok && outcome.text).not.toContain('Python files were not analysed.');
    expect(outcome.ok && outcome.text).toContain('Amazon S3: building');
  });

  test('registering a Python detector removes the Python note', async () => {
    const { fake, fs } = runtimeFor({ 'a.py': 'x' });
    fake.runtime.scanDetectors = [
      {
        id: 'boto3',
        accepts: (name) => name.endsWith('.py'),
        detect: () => [
          { identifierKind: 'boto3Name', identifier: 's3', kind: 'boto3Clients', count: 1 },
        ],
      },
    ];
    const outcome = await scanRepoTool({ path: fs.root }, contextFor(fake));
    expect(outcome.ok && outcome.text).not.toContain('Python files were not analysed.');
    expect(outcome.ok && outcome.text).toContain('Amazon S3: building');
  });

  test('a missing catalog is noted and does not fail the scan', async () => {
    const { fake, fs } = runtimeFor({ 'a.tf': TF('aws_s3_bucket') }, false);
    const outcome = await scanRepoTool({ path: fs.root }, contextFor(fake));
    expect(outcome.ok && outcome.text).toContain('run refresh_catalog');
  });

  test('another catalog failure is not swallowed', async () => {
    const { fake, fs } = runtimeFor({ 'a.tf': TF('aws_s3_bucket') });
    fake.events.failWith.set('catalog', new CompassError('Server'));
    await expect(scanRepoTool({ path: fs.root }, contextFor(fake))).rejects.toMatchObject({
      code: 'Server',
    });
  });

  test('a missing folder gives the fixed message without echoing the path', async () => {
    const { fake } = runtimeFor({});
    const connection = await connect(fake.runtime);
    const result = await connection.call('scan_repo', { path: '/repo/very-secret-folder' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('That folder could not be found.');
    await connection.close();
  });

  test('a file path is refused the same way', async () => {
    const { fake, fs } = runtimeFor({ 'a.tf': TF('aws_s3_bucket') });
    await expect(scanRepoTool({ path: `${fs.root}/a.tf` }, contextFor(fake))).rejects.toThrow();
  });

  test('a truncated scan says so', async () => {
    const tree: MemoryTree = {};
    for (let i = 0; i < 20001; i += 1) tree[`d${i % 50}/f${i}.ts`] = 'x';
    const { fake, fs } = runtimeFor(tree);
    const outcome = await scanRepoTool({ path: fs.root }, contextFor(fake));
    expect(outcome.ok && outcome.text).toContain('stopped at 20,000 files');
  });

  test('scans the real sample repo through the MCP client', async () => {
    const fake = createFakeRuntime({ scanFs: createNodeScanFs() });
    const connection = await connect(fake.runtime);
    const result = await connection.call('scan_repo', {
      path: join(repoRoot(), 'fixtures', 'sample-repo'),
    });
    expect(mcpTools.scan_repo.output.parse(result.structuredContent).services).toEqual([
      'Amazon DynamoDB',
      'AWS Lambda',
      'Amazon S3',
      'Amazon SNS',
      'Amazon SQS',
    ]);
    await connection.close();
  });
});

// Feature: compass-power, Property 14: scan_repo output encodes depth as the contract expects
describe('Property 14: scan_repo output encodes depth as the contract expects', () => {
  const pieces = [
    TF('aws_s3_bucket'),
    TF('aws_lambda_function', 3),
    SDK,
    "import { S3Client } from '@aws-sdk/client-s3';",
    '{"dependencies":{"@aws-sdk/client-dynamodb":"3"}}',
    'plain text',
  ];

  test('services are the non-none findings and depths are 0 to 3', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 5 }),
            fc.constantFrom('main.tf', 'a.ts', 'package.json', 'b.mts'),
          ),
          { maxLength: 8 },
        ),
        async (files) => {
          const tree: MemoryTree = {};
          files.forEach(([piece, name], index) => {
            tree[`d${index}/${name}`] = pieces[piece] ?? '';
          });
          const { fake, fs } = runtimeFor(tree);
          const outcome = await scanRepoTool({ path: fs.root }, contextFor(fake));
          const expected = await scanRepo(fs.root, { fs });
          expect(outcome.ok).toBe(true);
          if (outcome.ok) {
            const parsed = mcpTools.scan_repo.output.parse(outcome.structured);
            const findings = expected.services.filter((s) => s.depth !== 'none');
            expect(parsed.services).toEqual(findings.map((s) => s.displayName));
            expect(parsed.depthByService).toEqual(
              findings.map((s) => ({ service: s.displayName, depth: depthToNumber(s.depth) })),
            );
            for (const entry of parsed.depthByService ?? []) {
              expect([0, 1, 2, 3]).toContain(entry.depth);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
