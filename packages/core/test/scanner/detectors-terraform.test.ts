import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { terraformDetector } from '../../src/scanner/detectors/terraform.js';
import { addHit, codeLines } from '../../src/scanner/detectors/text.js';
import { resolveService } from '../../src/scanner/service-table.js';

describe('terraform detector', () => {
  test('accepts only .tf files', () => {
    expect(terraformDetector.accepts('main.tf')).toBe(true);
    expect(terraformDetector.accepts('main.tfvars')).toBe(false);
  });

  test('counts resource and data blocks, ignoring comments and other providers', () => {
    const text = [
      'resource "aws_s3_bucket" "a" {',
      '  bucket = "x"',
      '}',
      '# resource "aws_s3_bucket" "commented" {',
      '  // data "aws_vpc" "commented" {',
      'data "aws_vpc" "default" {',
      '}',
      'resource "google_storage_bucket" "other" {',
      'resource "aws_s3_bucket" "b" {',
    ].join('\n');
    const hits = terraformDetector.detect(text, 'main.tf');
    expect(hits).toEqual([
      {
        identifierKind: 'terraformType',
        identifier: 'aws_s3_bucket',
        kind: 'terraformResources',
        count: 2,
      },
      {
        identifierKind: 'terraformType',
        identifier: 'aws_vpc',
        kind: 'terraformResources',
        count: 1,
      },
    ]);
  });
});

describe('text helpers', () => {
  test('codeLines drops whole-line comments only', () => {
    expect(codeLines('a\n  # b\n// c\nd # e\r\nf', ['#', '//'])).toEqual(['a', 'd # e', 'f']);
  });

  test('addHit merges identical hits and keeps different ones apart', () => {
    const hits = [] as Parameters<typeof addHit>[0];
    const base = {
      identifierKind: 'terraformType',
      identifier: 'x',
      kind: 'terraformResources',
      count: 1,
    } as const;
    addHit(hits, base);
    addHit(hits, base);
    addHit(hits, { ...base, identifier: 'y' });
    addHit(hits, { ...base, kind: 'cdkImports' });
    addHit(hits, { ...base, identifierKind: 'cdkModule' });
    expect(hits.map((h) => h.count)).toEqual([2, 1, 1, 1]);
  });
});

// Feature: compass-power, Property 5: The Terraform detector counts exactly the declared AWS blocks
describe('Property 5: the Terraform detector counts exactly the declared AWS blocks', () => {
  const awsTypes = [
    'aws_s3_bucket',
    'aws_lambda_function',
    'aws_iam_role',
    'aws_cloudwatch_event_rule',
    'aws_cloudwatch_log_group',
    'aws_instance',
    'aws_route53_zone',
    'aws_made_up_thing',
    'aws_vpclattice_service',
  ];
  const blockArb = fc.record({
    type: fc.constantFrom(...awsTypes),
    keyword: fc.constantFrom('resource', 'data'),
    indent: fc.constantFrom('', '  ', '\t'),
  });
  const noiseArb = fc.constantFrom(
    'resource "google_storage_bucket" "x" {',
    '# resource "aws_s3_bucket" "c" {',
    '// data "aws_vpc" "d" {',
    'provider "aws" {',
    '  name = "resource aws_s3_bucket"',
    'variable "region" {}',
    '',
  );
  const lineArb = fc.oneof(
    blockArb.map((b) => ({ block: b })),
    noiseArb.map((noise) => ({ noise })),
  );

  test('total, per type and per service counts match the declared blocks', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: 30 }), (items) => {
        const lines: string[] = [];
        const expectedByType = new Map<string, number>();
        let total = 0;
        for (const item of items) {
          if ('block' in item) {
            const { type, keyword, indent } = item.block;
            lines.push(`${indent}${keyword} "${type}" "name" {`, `${indent}  x = 1`, `${indent}}`);
            expectedByType.set(type, (expectedByType.get(type) ?? 0) + 1);
            total += 1;
          } else {
            lines.push(item.noise);
          }
        }
        const hits = terraformDetector.detect(lines.join('\n'), 'main.tf');
        expect(hits.reduce((sum, h) => sum + h.count, 0)).toBe(total);
        for (const [type, count] of expectedByType) {
          expect(hits.find((h) => h.identifier === type)?.count).toBe(count);
        }
        const byService = new Map<string, number>();
        let unmapped = 0;
        for (const hit of hits) {
          const key = resolveService('terraformType', hit.identifier);
          if (key === undefined) unmapped += hit.count;
          else byService.set(key, (byService.get(key) ?? 0) + hit.count);
        }
        const expectedUnmapped =
          (expectedByType.get('aws_made_up_thing') ?? 0) +
          (expectedByType.get('aws_vpclattice_service') ?? 0);
        expect(unmapped).toBe(expectedUnmapped);
        expect(byService.get('eventbridge') ?? 0).toBe(
          expectedByType.get('aws_cloudwatch_event_rule') ?? 0,
        );
      }),
      { numRuns: 150 },
    );
  });
});
