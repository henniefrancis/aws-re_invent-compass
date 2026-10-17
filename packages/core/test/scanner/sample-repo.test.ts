import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeScanFs } from '../../src/scanner/scan-fs.js';
import { scanRepo } from '../../src/scanner/scan-repo.js';
import { repoRoot } from '../support/repo-root.js';

const SAMPLE = join(repoRoot(), 'fixtures', 'sample-repo');

describe('scanner on fixtures/sample-repo', () => {
  test('finds the expected services, evidence, depths and levels', async () => {
    const result = await scanRepo(SAMPLE, { fs: createNodeScanFs() });
    expect(result.services.map((s) => [s.key, s.depth, s.suggestedLevel])).toEqual([
      ['dynamodb', 'building', 300],
      ['lambda', 'building', 300],
      ['s3', 'building', 300],
      ['sqs', 'building', 300],
    ]);
    const byKey = Object.fromEntries(result.services.map((s) => [s.key, s.evidence]));
    expect(byKey.s3).toMatchObject({
      terraformResources: 1,
      sdkImports: 1,
      sdkClients: 1,
      sdkCommands: 1,
      dependencyDeclarations: 1,
    });
    expect(byKey.dynamodb).toMatchObject({ terraformResources: 1, sdkClients: 1, sdkCommands: 1 });
    expect(byKey.lambda).toMatchObject({ terraformResources: 1 });
    expect(byKey.sqs).toMatchObject({ cdkImports: 1, cdkConstructs: 1 });
    expect(result.truncated).toBe(false);
    expect(result.skipped.gitignored).toBe(0);
    expect(result.skipped.unsupportedType).toBe(1);
  });
});

describe('scanner on a temporary copy with decoys', () => {
  let temp: string;
  let canSymlink = true;

  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'compass-sample-'));
    await cp(SAMPLE, temp, { recursive: true });
    const usage = "import { S3Client } from '@aws-sdk/client-s3';\nnew S3Client({});\n";
    await mkdir(join(temp, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(temp, 'node_modules', 'pkg', 'index.ts'), usage);
    await mkdir(join(temp, 'ignored-output'), { recursive: true });
    await writeFile(join(temp, 'ignored-output', 'more.mts'), usage);
    await writeFile(join(temp, 'big.ts'), usage + ' '.repeat(2 * 1024 * 1024));
    await writeFile(join(temp, 'binary.ts'), Buffer.concat([Buffer.from([0]), Buffer.from(usage)]));
    try {
      await symlink(join(temp, 'src'), join(temp, 'link'), 'junction');
    } catch {
      canSymlink = false;
    }
  });

  afterAll(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  test('decoys contribute nothing and are counted as skipped', async () => {
    const fs = createNodeScanFs();
    const clean = await scanRepo(SAMPLE, { fs });
    const dirty = await scanRepo(temp, { fs });
    expect(dirty.services).toEqual(clean.services);
    expect(dirty.filesRead).toBe(clean.filesRead);
    expect(dirty.skipped.excludedDirectory).toBe(1);
    expect(dirty.skipped.tooLarge).toBe(1);
    expect(dirty.skipped.binary).toBe(1);
    expect(dirty.skipped.gitignored).toBe(1);
    expect(dirty.skipped.symlink).toBe(canSymlink ? 1 : 0);
  });
});
