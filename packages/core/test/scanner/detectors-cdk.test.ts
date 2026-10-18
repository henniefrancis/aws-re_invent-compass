import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { cdkTypescriptDetector } from '../../src/scanner/detectors/cdk-typescript.js';
import { parseImports } from '../../src/scanner/detectors/imports.js';
import type { DetectorHit } from '../../src/scanner/detectors/types.js';

function count(hits: DetectorHit[], kind: string, identifier?: string): number {
  return hits
    .filter((h) => h.kind === kind && (identifier === undefined || h.identifier === identifier))
    .reduce((sum, h) => sum + h.count, 0);
}

describe('parseImports', () => {
  test('reads default, namespace, named, aliased and type imports', () => {
    const statements = parseImports(
      [
        "import React, { useState as us, type Foo, 9bad } from 'react';",
        "import * as s3 from 'aws-cdk-lib/aws-s3';",
        "import type { A } from 'x';",
        "import {\n  B,\n  C as D,\n} from 'y';",
        "import { broken from 'z';",
        "const x = 'import nothing';",
      ].join('\n'),
    );
    expect(statements.map((s) => s.specifier)).toEqual([
      'react',
      'aws-cdk-lib/aws-s3',
      'x',
      'y',
      'z',
    ]);
    expect(statements[0]?.named).toEqual([
      { imported: 'useState', local: 'us' },
      { imported: 'Foo', local: 'Foo' },
    ]);
    expect(statements[1]?.namespace).toBe('s3');
    expect(statements[3]?.named).toEqual([
      { imported: 'B', local: 'B' },
      { imported: 'C', local: 'D' },
    ]);
    expect(statements[4]?.named).toEqual([]);
  });
});

describe('cdk typescript detector', () => {
  test('accepts TypeScript files only', () => {
    for (const name of ['a.ts', 'a.tsx', 'a.mts', 'a.cts']) {
      expect(cdkTypescriptDetector.accepts(name)).toBe(true);
    }
    expect(cdkTypescriptDetector.accepts('a.js')).toBe(false);
  });

  test('counts imports and constructs for every import style', () => {
    const text = [
      "import * as cdk from 'aws-cdk-lib';",
      "import { Construct } from 'constructs';",
      "import { Stack, aws_lambda as lambda, aws_sqs, Duration } from 'aws-cdk-lib';",
      "import * as s3 from 'aws-cdk-lib/aws-s3';",
      "import { Table } from 'aws-cdk-lib/aws-dynamodb';",
      "// import * as ignored from 'aws-cdk-lib/aws-sns';",
      'const stack = new Stack(app, "x");',
      'new s3.Bucket(stack, "b");',
      'new lambda.Function(stack, "f");',
      'new aws_sqs.Queue(stack, "q");',
      'new Table(stack, "t");',
      'new cdk.aws_s3.Bucket(stack, "c");',
      'new cdk.Duration(1);',
      'new other.Thing(1);',
      'new Unrelated();',
      'new cdk.aws_s3.deep.Thing();',
      'new other.deep.Thing();',
      '// new s3.Bucket(stack, "commented");',
    ].join('\n');
    const hits = cdkTypescriptDetector.detect(text, 'stack.ts');
    expect(count(hits, 'cdkImports')).toBe(4);
    expect(count(hits, 'cdkImports', 'aws-lambda')).toBe(1);
    expect(count(hits, 'cdkConstructs', 'aws-s3')).toBe(2);
    expect(count(hits, 'cdkConstructs', 'aws-lambda')).toBe(1);
    expect(count(hits, 'cdkConstructs', 'aws-sqs')).toBe(1);
    expect(count(hits, 'cdkConstructs', 'aws-dynamodb')).toBe(1);
    expect(count(hits, 'cdkConstructs')).toBe(5);
  });

  test('a non-namespace export from aws-cdk-lib is not a module', () => {
    const hits = cdkTypescriptDetector.detect(
      "import { Stack } from 'aws-cdk-lib';\nnew Stack();",
      'a.ts',
    );
    expect(hits).toEqual([]);
  });
});

// Feature: compass-power, Property 6: The CDK detector counts imports and constructs from CDK modules only
describe('Property 6: the CDK detector counts imports and constructs from CDK modules only', () => {
  type Style = 'subpathNamespace' | 'subpathNamed' | 'libraryAlias';
  const modules = ['aws-s3', 'aws-lambda', 'aws-made-up'];
  const importArb = fc.record({
    style: fc.constantFrom<Style>('subpathNamespace', 'subpathNamed', 'libraryAlias'),
    module: fc.constantFrom(...modules),
    uses: fc.integer({ min: 0, max: 3 }),
    commentedUses: fc.integer({ min: 0, max: 2 }),
  });

  test('counts match the generated imports and instantiations', () => {
    fc.assert(
      fc.property(
        fc.array(importArb, { maxLength: 6 }),
        fc.integer({ min: 0, max: 4 }),
        (imports, noise) => {
          const lines: string[] = ["import { Stack } from 'aws-cdk-lib';"];
          const expectedConstructs = new Map<string, number>();
          let expectedImports = 0;
          imports.forEach((item, index) => {
            const alias = `Alias${index}`;
            const cls = `Cls${index}`;
            const namespaceName = `aws_${item.module.slice(4).replace(/-/g, '_')}`;
            let useExpression: string;
            if (item.style === 'subpathNamespace') {
              lines.push(`import * as ${alias} from 'aws-cdk-lib/${item.module}';`);
              useExpression = `new ${alias}.Thing(stack);`;
            } else if (item.style === 'subpathNamed') {
              lines.push(`import { Thing as ${cls} } from 'aws-cdk-lib/${item.module}';`);
              useExpression = `new ${cls}(stack);`;
            } else {
              lines.push(`import { ${namespaceName} as ${alias} } from 'aws-cdk-lib';`);
              useExpression = `new ${alias}.Thing(stack);`;
            }
            expectedImports += 1;
            for (let i = 0; i < item.uses; i += 1) lines.push(useExpression);
            for (let i = 0; i < item.commentedUses; i += 1) lines.push(`// ${useExpression}`);
            expectedConstructs.set(
              item.module,
              (expectedConstructs.get(item.module) ?? 0) + item.uses,
            );
          });
          for (let i = 0; i < noise; i += 1) {
            lines.push('new Stack(app, "x");', 'new Unrelated.Thing();', 'new Plain();');
          }
          const hits = cdkTypescriptDetector.detect(lines.join('\n'), 'x.ts');
          expect(count(hits, 'cdkImports')).toBe(expectedImports);
          expect(count(hits, 'cdkConstructs')).toBe(
            [...expectedConstructs.values()].reduce((a, b) => a + b, 0),
          );
          for (const [module, total] of expectedConstructs) {
            expect(count(hits, 'cdkConstructs', module)).toBe(total);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
