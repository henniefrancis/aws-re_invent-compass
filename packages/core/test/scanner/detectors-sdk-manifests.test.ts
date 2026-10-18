import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { manifestsDetector } from '../../src/scanner/detectors/manifests.js';
import { sdkJsV3Detector } from '../../src/scanner/detectors/sdk-js-v3.js';
import type { DetectorHit } from '../../src/scanner/detectors/types.js';

function total(hits: DetectorHit[], kind: string): number {
  return hits.filter((h) => h.kind === kind).reduce((sum, h) => sum + h.count, 0);
}

describe('sdk-js-v3 detector', () => {
  test('accepts JavaScript and TypeScript files', () => {
    for (const name of ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.mjs', 'a.cjs']) {
      expect(sdkJsV3Detector.accepts(name)).toBe(true);
    }
    expect(sdkJsV3Detector.accepts('a.py')).toBe(false);
  });

  test('counts imports, requires, clients and commands for one service', () => {
    const text = [
      "import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';",
      "const { Upload } = require('@aws-sdk/lib-storage');",
      "// import { SQSClient } from '@aws-sdk/client-sqs';",
      'const client = new S3Client({});',
      'await client.send(new PutObjectCommand({}));',
      'await client.send(new GetObjectCommand({}));',
      'new SomethingElse();',
    ].join('\n');
    const hits = sdkJsV3Detector.detect(text, 'a.ts');
    expect(total(hits, 'sdkImports')).toBe(2);
    expect(total(hits, 'sdkClients')).toBe(1);
    expect(hits.find((h) => h.kind === 'sdkClients')?.identifier).toBe('S3');
    const commands = hits.find((h) => h.kind === 'sdkCommands');
    expect(commands).toMatchObject({
      identifierKind: 'sdkPackage',
      identifier: '@aws-sdk/client-s3',
      count: 2,
    });
  });

  test('commands from a file that imports two services are unattributed', () => {
    const text = [
      "import { S3Client } from '@aws-sdk/client-s3';",
      "import { SQSClient } from '@aws-sdk/client-sqs';",
      'new XCommand();',
    ].join('\n');
    const commands = sdkJsV3Detector.detect(text, 'a.ts').find((h) => h.kind === 'sdkCommands');
    expect(commands?.identifier).toBe('');
  });

  test('dynamodb client plus lib-dynamodb is one service', () => {
    const text = [
      "import { DynamoDBClient } from '@aws-sdk/client-dynamodb';",
      "import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';",
      'new PutCommand({});',
    ].join('\n');
    const commands = sdkJsV3Detector.detect(text, 'a.ts').find((h) => h.kind === 'sdkCommands');
    expect(commands?.identifier).toBe('@aws-sdk/client-dynamodb');
  });

  test('without an SDK import nothing is counted', () => {
    expect(sdkJsV3Detector.detect('new FooClient();\nnew BarCommand();', 'a.ts')).toEqual([]);
  });
});

// Feature: compass-power, Property 7: The SDK for JavaScript v3 detector counts client packages, clients and commands
describe('Property 7: the SDK detector counts client packages, clients and commands', () => {
  const packages = [
    '@aws-sdk/client-s3',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/client-unknown-thing',
  ];
  const importArb = fc.record({
    pkg: fc.constantFrom(...packages),
    style: fc.constantFrom('import', 'require', 'commented'),
  });

  test('counts match and commands follow the attribution rule', () => {
    fc.assert(
      fc.property(
        fc.array(importArb, { maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        (imports, clients, commands, commented) => {
          const lines: string[] = [];
          const active: string[] = [];
          for (const item of imports) {
            if (item.style === 'import') {
              lines.push(`import { X } from '${item.pkg}';`);
              active.push(item.pkg);
            } else if (item.style === 'require') {
              lines.push(`const x = require('${item.pkg}');`);
              active.push(item.pkg);
            } else {
              lines.push(`// import { X } from '${item.pkg}';`);
            }
          }
          for (let i = 0; i < clients; i += 1) lines.push(`const c${i} = new S3Client({});`);
          for (let i = 0; i < commands; i += 1) lines.push(`send(new Put${i}Command({}));`);
          for (let i = 0; i < commented; i += 1)
            lines.push('// new S3Client({}); new GetCommand();');
          lines.push('new Other();');

          const hits = sdkJsV3Detector.detect(lines.join('\n'), 'a.ts');
          expect(total(hits, 'sdkImports')).toBe(active.length);
          expect(total(hits, 'sdkClients')).toBe(active.length > 0 ? clients : 0);
          expect(total(hits, 'sdkCommands')).toBe(active.length > 0 ? commands : 0);
          if (active.length > 0 && commands > 0) {
            const serviceOf = (pkg: string): string =>
              pkg.endsWith('dynamodb') ? 'dynamodb' : pkg;
            const single = new Set(active.map(serviceOf)).size === 1;
            const owner = hits.find((h) => h.kind === 'sdkCommands')?.identifier;
            expect(owner === '').toBe(!single);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('manifests detector', () => {
  test('accepts package.json and requirements.txt only', () => {
    expect(manifestsDetector.accepts('package.json')).toBe(true);
    expect(manifestsDetector.accepts('requirements.txt')).toBe(true);
    expect(manifestsDetector.accepts('tsconfig.json')).toBe(false);
  });

  test('a malformed or oddly shaped package.json counts nothing and does not throw', () => {
    for (const text of [
      '{ not json',
      'null',
      '[]',
      '"x"',
      '{"dependencies": 5}',
      '{"dependencies": null}',
    ]) {
      expect(manifestsDetector.detect(text, 'package.json')).toEqual([]);
    }
  });

  test('counts declared AWS dependencies from both sections', () => {
    const text = JSON.stringify({
      dependencies: { 'aws-cdk-lib': '2', '@aws-sdk/client-s3': '3', express: '4' },
      devDependencies: { '@aws-sdk/client-s3': '3', '@aws-sdk/lib-dynamodb': '3' },
    });
    const hits = manifestsDetector.detect(text, 'package.json');
    expect(total(hits, 'dependencyDeclarations')).toBe(3);
  });

  test('reads requirements lines, skipping comments, options and other packages', () => {
    const text = [
      '# comment',
      '-r other.txt',
      'boto3==1.35.0',
      'Boto3>=1 # again',
      'aws_cdk_lib~=2.0',
      'requests',
      '',
      '   ',
    ].join('\n');
    const hits = manifestsDetector.detect(text, 'requirements.txt');
    expect(total(hits, 'dependencyDeclarations')).toBe(3);
  });
});

// Feature: compass-power, Property 9: Dependency declarations are counted from manifests
describe('Property 9: dependency declarations are counted from manifests', () => {
  const names = [
    'aws-cdk-lib',
    'boto3',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-sqs',
    '@aws-sdk/lib-dynamodb',
    'express',
    'react',
    'requests',
  ];
  const qualifies = (name: string): boolean =>
    name === 'aws-cdk-lib' || name === 'boto3' || name.startsWith('@aws-sdk/client-');

  test('package.json maps', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...names)),
        fc.uniqueArray(fc.constantFrom(...names)),
        (deps, devDeps) => {
          const toMap = (list: string[]): Record<string, string> =>
            Object.fromEntries(list.map((name) => [name, '1.0.0']));
          const text = JSON.stringify({
            dependencies: toMap(deps),
            devDependencies: toMap(devDeps),
          });
          const expected = [...deps, ...devDeps].filter(qualifies).length;
          expect(
            total(manifestsDetector.detect(text, 'package.json'), 'dependencyDeclarations'),
          ).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('requirements.txt lines', () => {
    const pyNames = ['boto3', 'aws-cdk-lib', 'requests', 'flask', 'boto3-stubs'];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.constantFrom(...pyNames),
            spec: fc.constantFrom('', '==1.0', '>=2.0,<3', '[extra]==1', ' ; python_version>"3"'),
            comment: fc.boolean(),
          }),
          { maxLength: 10 },
        ),
        (lines) => {
          const text = lines
            .map((l) => (l.comment ? `# ${l.name}${l.spec}` : `${l.name}${l.spec}`))
            .join('\n');
          const expected = lines.filter(
            (l) => !l.comment && (l.name === 'boto3' || l.name === 'aws-cdk-lib'),
          ).length;
          expect(
            total(manifestsDetector.detect(text, 'requirements.txt'), 'dependencyDeclarations'),
          ).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
