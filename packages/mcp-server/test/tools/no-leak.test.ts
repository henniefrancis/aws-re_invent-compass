import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { join } from 'node:path';
import { planWeekTool } from '../../src/tools/plan-week.js';
import { scanRepoTool } from '../../src/tools/scan-repo.js';
import { contextFor } from '../support/context.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { MemoryScanFs } from '../support/memory-scan-fs.js';
import type { MemoryTree } from '../support/memory-scan-fs.js';
import { MemorySpecFs } from '../support/memory-spec-fs.js';

// Feature: compass-power, Property 12: No file name, path or content leaves the scanner
describe('Property 12: no file name, path or content leaves the scanner', () => {
  const USAGE = [
    'resource "aws_s3_bucket" "b" {}',
    "import { SQSClient } from '@aws-sdk/client-sqs';\nnew SQSClient({});",
    '{"dependencies":{"@aws-sdk/client-dynamodb":"3"}}',
  ];

  test('markers in names and contents never appear in the scan result or the week spec', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            dir: fc.integer({ min: 0, max: 99999 }),
            file: fc.integer({ min: 0, max: 99999 }),
            usage: fc.integer({ min: 0, max: 2 }),
            comment: fc.integer({ min: 0, max: 99999 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (files) => {
          const markers: string[] = [];
          const tree: MemoryTree = {};
          for (const [index, spec] of files.entries()) {
            const dirMarker = `DIRMARK${spec.dir}x${index}`;
            const fileMarker = `FILEMARK${spec.file}x${index}`;
            const bodyMarker = `BODYMARK${spec.comment}x${index}`;
            markers.push(dirMarker, fileMarker, bodyMarker);
            const name =
              spec.usage === 2
                ? 'package.json'
                : spec.usage === 1
                  ? `${fileMarker}.ts`
                  : `${fileMarker}.tf`;
            const body =
              spec.usage === 2
                ? (USAGE[2] ?? '')
                : `// ${bodyMarker}\n${USAGE[spec.usage] ?? ''}\n// ${bodyMarker}`;
            tree[`${dirMarker}/${name}`] = body;
          }
          const scanFs = new MemoryScanFs(tree);
          const specFs = new MemorySpecFs();
          const root = join('/', 'workspace');
          specFs.directories.add(root);
          const fake = createFakeRuntime({
            catalog: syntheticCatalogView(),
            scanFs,
            specFs,
            cwd: root,
          });
          const ctx = contextFor(fake);
          const scan = await scanRepoTool({ path: scanFs.root }, ctx);
          // the scanned folder is the workspace root, so make it a directory in the spec fs
          specFs.directories.add(scanFs.root);
          const plan = await planWeekTool({ goals: ['workshop'] }, ctx);
          const everything = JSON.stringify([scan, plan, [...specFs.files.values()]]);
          for (const marker of markers) {
            expect(everything).not.toContain(marker);
          }
        },
      ),
      { numRuns: 30 },
    );
  }, 120000);
});
