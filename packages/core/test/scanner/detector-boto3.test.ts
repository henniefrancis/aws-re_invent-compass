import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { boto3Detector, stripPythonComment } from '../../src/scanner/detectors/boto3.js';
import type { DetectorHit } from '../../src/scanner/detectors/types.js';
import { DEFAULT_DETECTORS } from '../../src/scanner/scan-repo.js';

const total = (hits: DetectorHit[]): number => hits.reduce((sum, h) => sum + h.count, 0);
const byName = (hits: DetectorHit[]): Record<string, number> =>
  Object.fromEntries(hits.map((h) => [h.identifier, h.count]));

describe('boto3 detector', () => {
  test('accepts only Python files and is registered by default', () => {
    expect(boto3Detector.accepts('a.py')).toBe(true);
    expect(boto3Detector.accepts('a.ts')).toBe(false);
    expect(boto3Detector.accepts('requirements.txt')).toBe(false);
    expect(DEFAULT_DETECTORS.map((d) => d.id)).toContain('boto3');
  });

  test('counts client and resource calls with single or double quotes', () => {
    const text = [
      'import boto3',
      "s3 = boto3.client('s3')",
      'table = boto3.resource("dynamodb").Table("t")',
      "queue = boto3.client(service_name='sqs')",
      "again = boto3.client('s3', region_name='us-east-1')",
    ].join('\n');
    const hits = boto3Detector.detect(text, 'a.py');
    expect(byName(hits)).toEqual({ s3: 2, dynamodb: 1, sqs: 1 });
    expect(hits.every((h) => h.kind === 'boto3Clients' && h.identifierKind === 'boto3Name')).toBe(
      true,
    );
  });

  test('counts calls on a boto3 session, in either session form, and not on other names', () => {
    const text = [
      'import boto3',
      "session = boto3.Session(profile_name='dev')",
      'other = boto3.session.Session()',
      "a = session.client('lambda')",
      'b = other.resource("sns")',
      "c = unrelated.client('s3')",
      "d = client('s3')",
      "e = mysession.client('s3')",
    ].join('\n');
    expect(byName(boto3Detector.detect(text, 'a.py'))).toEqual({ lambda: 1, sns: 1 });
  });

  test('ignores comments, keeps a hash inside a string, and handles a call over several lines', () => {
    const text = [
      "# s3 = boto3.client('s3')",
      "x = boto3.client('kms')  # boto3.client('iam')",
      "y = boto3.client('a#b-c')",
      'z = boto3.client(',
      "    'ecs',",
      ')',
    ].join('\n');
    // The hash inside the quotes is not a comment, so the call is seen; its name is not a service name.
    expect(byName(boto3Detector.detect(text, 'a.py'))).toEqual({ kms: 1, '': 1, ecs: 1 });
  });

  test('a service name that is not a literal is counted with an empty identifier', () => {
    const hits = boto3Detector.detect(
      'x = boto3.client(name)\ny = boto3.resource(SERVICE)',
      'a.py',
    );
    expect(byName(hits)).toEqual({ '': 2 });
  });

  test('stripPythonComment cuts at the first hash outside quotes and honours escapes', () => {
    expect(stripPythonComment('a = 1  # note')).toBe('a = 1  ');
    expect(stripPythonComment('a = "x # y"  # z')).toBe('a = "x # y"  ');
    expect(stripPythonComment("a = 'it\\'s # here'")).toBe("a = 'it\\'s # here'");
    expect(stripPythonComment('no comment')).toBe('no comment');
  });
});

// Feature: compass-power, Property 8: The boto3 detector counts client and resource calls
describe('Property 8: the boto3 detector counts client and resource calls', () => {
  const service = fc.constantFrom(
    's3',
    'sqs',
    'sns',
    'dynamodb',
    'lambda',
    'kms',
    'bedrock-runtime',
  );
  const quote = fc.constantFrom("'", '"');
  const call = fc.record({
    owner: fc.constantFrom('boto3', 'session'),
    method: fc.constantFrom('client', 'resource'),
    service,
    quote,
    keyword: fc.boolean(),
  });
  const noise = fc.constantFrom(
    "# boto3.client('s3')",
    "client('s3')",
    "other.client('sns')",
    'x = 1',
    "boto3.upload('s3')",
    '',
  );

  test('one hit per boto3 or session call and nothing for comments or unrelated calls', () => {
    fc.assert(
      fc.property(
        fc.array(call, { maxLength: 12 }),
        fc.array(noise, { maxLength: 8 }),
        (calls, noises) => {
          const lines = [
            'import boto3',
            "session = boto3.Session(region_name='us-west-2')",
            ...calls.map(
              (c) =>
                `v = ${c.owner}.${c.method}(${c.keyword ? 'service_name=' : ''}${c.quote}${c.service}${c.quote})`,
            ),
            ...noises,
          ];
          const hits = boto3Detector.detect(lines.join('\n'), 'x.py');
          expect(total(hits)).toBe(calls.length);
          expect(hits.every((h) => h.kind === 'boto3Clients')).toBe(true);
          const expected: Record<string, number> = {};
          for (const c of calls) {
            expected[c.service] = (expected[c.service] ?? 0) + 1;
          }
          expect(byName(hits)).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
