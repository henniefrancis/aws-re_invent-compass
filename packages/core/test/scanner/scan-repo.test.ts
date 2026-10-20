import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_DETECTORS,
  DEFAULT_TECH_DETECTORS,
  analyseFiles,
  scanRepo,
} from '../../src/scanner/scan-repo.js';
import type { ScanDeps } from '../../src/scanner/scan-repo.js';
import { FolderNotFoundError } from '../../src/scanner/walker.js';
import type { WalkSummary } from '../../src/scanner/walker.js';
import type { SourceFile } from '../../src/scanner/source-file.js';
import type { Detector, TechDetector } from '../../src/scanner/detectors/types.js';
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

describe('technologies (task 41.2)', () => {
  test('counts files by extension and manifests by declaration, scored and sorted', async () => {
    const result = await scan({
      'web/package.json': JSON.stringify({
        dependencies: { react: '18', express: '4' },
        devDependencies: { typescript: '5' },
      }),
      'web/a.ts': 'x',
      'web/b.tsx': 'x',
      'web/c.js': 'x',
      'api/Api.csproj':
        '<Project><ItemGroup><PackageReference Include="Microsoft.AspNetCore.OpenApi" /></ItemGroup></Project>',
      'api/Program.cs': 'var app = 1;',
      'api/Startup.cs': 'var b = 2;',
      'svc/Main.java': 'class Main {}',
      'svc/Other.java': 'class Other {}',
      'go/main.go': 'package main',
      'notes.md': 'x',
      Dockerfile: 'FROM node:24',
    });
    expect(result.technologies.map((t) => [t.key, t.files, t.declarations, t.score])).toEqual([
      ['typescript', 2, 1, 7],
      ['aspnet', 0, 1, 5],
      ['docker', 0, 1, 5],
      ['dotnet', 0, 1, 5],
      ['express', 0, 1, 5],
      ['nodejs', 0, 1, 5],
      ['react', 0, 1, 5],
      ['csharp', 2, 0, 2],
      ['java', 2, 0, 2],
      ['go', 1, 0, 1],
      ['javascript', 1, 0, 1],
    ]);
    expect(result.technologies[0]).toEqual({
      key: 'typescript',
      displayName: 'TypeScript',
      group: 'language',
      files: 2,
      declarations: 1,
      score: 7,
    });
    // Java, Go and Markdown files are counted by name only, never read.
    expect(result.filesRead).toBe(8);
    expect(result.skipped.unsupportedType).toBe(4);
    expect(JSON.stringify(result.technologies)).not.toContain('web');
    expect(JSON.stringify(result.technologies)).not.toContain('Program');
  });

  test('a scan with no technology gives an empty list', async () => {
    expect((await scan({ 'readme.md': 'x' })).technologies).toEqual([]);
  });

  test('custom Tech_Detectors replace the defaults and unknown technology keys are dropped', async () => {
    const custom: TechDetector = {
      id: 'custom',
      accepts: (name) => name === 'package.json',
      detect: () => [
        { tech: 'cobol', kind: 'declarations', count: 3 },
        { tech: 'vue', kind: 'declarations', count: 2 },
      ],
    };
    const result = await scan({ 'package.json': '{}' }, { techDetectors: [custom] });
    expect(result.technologies.map((t) => [t.key, t.score])).toEqual([['vue', 10]]);
    const none = await scan({ 'package.json': '{}', 'a.ts': 'x' }, { techDetectors: [] });
    expect(none.technologies.map((t) => t.key)).toEqual(['typescript']);
  });

  test('a .NET project with the AWS SDK for .NET reaches the building depth', async () => {
    const result = await scan({
      'App.csproj': '<Project><PackageReference Include="AWSSDK.S3" /></Project>',
      'Program.cs': '// new AmazonSQSClient();\nvar s3 = new AmazonS3Client();',
    });
    expect(result.services.map((s) => [s.key, s.depth])).toEqual([['s3', 'building']]);
    expect(result.services[0]?.evidence).toMatchObject({
      dependencyDeclarations: 1,
      sdkClients: 1,
    });
    expect(result.technologies.map((t) => t.key)).toEqual(['dotnet', 'csharp']);
  });

  test('the result survives a structured clone unchanged', async () => {
    const result = await scan({
      'main.tf': TERRAFORM(1),
      'package.json': '{"dependencies":{"react":"18"}}',
      'a.go': 'x',
    });
    expect(structuredClone(result)).toEqual(result);
  });
});

describe('analyseFiles (task 41.1)', () => {
  const SUMMARY: WalkSummary = {
    filesRead: 2,
    skipped: {
      excludedDirectory: 0,
      gitignored: 0,
      tooLarge: 0,
      binary: 0,
      symlink: 0,
      unsupportedType: 1,
    },
    truncated: false,
    productionMarker: false,
  };

  async function* stream(files: SourceFile[]): AsyncGenerator<SourceFile, WalkSummary> {
    for (const file of files) {
      yield await Promise.resolve(file);
    }
    return SUMMARY;
  }

  test('detectors see only files with text; the extension count sees every file', async () => {
    const seen: string[] = [];
    const techSeen: string[] = [];
    const spy: Detector = {
      id: 'terraform',
      accepts: (name) => {
        seen.push(name);
        return true;
      },
      detect: () => [],
    };
    const techSpy: TechDetector = {
      id: 'spy',
      accepts: (name) => {
        techSeen.push(name);
        return false;
      },
      detect: () => [],
    };
    const result = await analyseFiles(
      stream([
        { relativePath: 'src/a.ts', text: 'x' },
        { relativePath: 'src/Main.java' },
        { relativePath: 'b.py', text: '' },
      ]),
      { detectors: [spy], techDetectors: [techSpy] },
    );
    expect(seen).toEqual(['a.ts', 'b.py']);
    expect(techSeen).toEqual(['a.ts', 'b.py']);
    expect(result.technologies.map((t) => t.key)).toEqual(['java', 'python', 'typescript']);
    expect(result.pythonAnalysed).toBe(false);
    expect(result.filesRead).toBe(2);
    expect(result.skipped).toEqual(SUMMARY.skipped);
  });

  test('without options it runs the default detectors', async () => {
    const result = await analyseFiles(
      stream([
        { relativePath: 'app.py', text: "import boto3\nboto3.client('s3')" },
        { relativePath: 'Program.cs', text: 'new AmazonSQSClient();' },
      ]),
    );
    expect(result.services.map((s) => s.key)).toEqual(['s3', 'sqs']);
    expect(result.pythonAnalysed).toBe(true);
    expect(DEFAULT_DETECTORS.map((d) => d.id)).toContain('dotnet');
    expect(DEFAULT_TECH_DETECTORS.length).toBeGreaterThan(0);
  });
});
