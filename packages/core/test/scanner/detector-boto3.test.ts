import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { boto3Detector, maskPython } from '../../src/scanner/detectors/boto3.js';
import type { DetectorHit } from '../../src/scanner/detectors/types.js';
import { DEFAULT_DETECTORS } from '../../src/scanner/scan-repo.js';
import { resolveService } from '../../src/scanner/service-table.js';

const total = (hits: DetectorHit[]): number => hits.reduce((sum, h) => sum + h.count, 0);
const byName = (hits: DetectorHit[]): Record<string, number> =>
  Object.fromEntries(hits.map((h) => [h.identifier, h.count]));
const detect = (...lines: string[]): Record<string, number> =>
  byName(boto3Detector.detect(lines.join('\n'), 'a.py'));

describe('boto3 detector', () => {
  test('accepts only Python files and is registered by default', () => {
    expect(boto3Detector.accepts('a.py')).toBe(true);
    expect(boto3Detector.accepts('a.ts')).toBe(false);
    expect(boto3Detector.accepts('requirements.txt')).toBe(false);
    expect(DEFAULT_DETECTORS.map((d) => d.id)).toContain('boto3');
  });

  test('counts client and resource calls with single or double quotes', () => {
    const hits = boto3Detector.detect(
      [
        'import boto3',
        "s3 = boto3.client('s3')",
        'table = boto3.resource("dynamodb").Table("t")',
        "queue = boto3.client(service_name='sqs')",
        "again = boto3.client('s3', region_name='us-east-1')",
      ].join('\n'),
      'a.py',
    );
    expect(byName(hits)).toEqual({ s3: 2, dynamodb: 1, sqs: 1 });
    expect(hits.every((h) => h.kind === 'boto3Clients' && h.identifierKind === 'boto3Name')).toBe(
      true,
    );
  });

  test('counts calls on a boto3 session, in either session form, and not on other names', () => {
    expect(
      detect(
        'import boto3',
        "session = boto3.Session(profile_name='dev')",
        'other = boto3.session.Session()',
        "a = session.client('lambda')",
        'b = other.resource("sns")',
        "c = unrelated.client('s3')",
        "d = client('s3')",
        "e = mysession.client('s3')",
      ),
    ).toEqual({ lambda: 1, sns: 1 });
  });

  test('counts a call chained straight onto a session, even with nested parentheses in its arguments', () => {
    expect(
      detect(
        'import boto3',
        "a = boto3.Session(profile_name='dev').client('s3')",
        'b = boto3.session.Session(region_name=region(), profile_name=name()).resource("dynamodb")',
        "c = boto3.Session(\n    region_name='eu-west-1',\n).client(\n    'sqs'\n)",
      ),
    ).toEqual({ s3: 1, dynamodb: 1, sqs: 1 });
  });

  test('a chained call does not make its target a session, and an unfinished one is skipped', () => {
    expect(
      detect(
        "s3 = boto3.Session().client('s3')",
        "s3.client('sns')",
        `boto3.Session(${'x('.repeat(300)}`,
      ),
    ).toEqual({ s3: 1 });
  });

  test('counts calls imported from boto3, with aliases, and a Session imported by name', () => {
    expect(
      detect(
        'from boto3 import client, resource as res',
        "a = client('s3')",
        'b = res("dynamodb")',
        "c = obj.client('sns')",
        'def client(): pass',
      ),
    ).toEqual({ s3: 1, dynamodb: 1 });
    expect(
      detect(
        'from boto3 import (client as c, Session as S,\n    resource)',
        "x = c('kms')",
        "y = S(profile_name='p').client('ecs')",
        "sess = S()\nz = sess.resource('sqs')",
        "q = resource('glue')",
      ),
    ).toEqual({ kms: 1, ecs: 1, sqs: 1, glue: 1 });
    expect(detect('from boto3.session import Session', "Session().client('iam')")).toEqual({
      iam: 1,
    });
  });

  test('counts calls through an alias of the module', () => {
    expect(
      detect('import boto3 as b3', "b3.client('s3')", "boto3.client('sns')", "b2.client('x')"),
    ).toEqual({
      s3: 1,
      sns: 1,
    });
  });

  test('ignores comments, docstrings, long strings and calls that sit inside ordinary strings', () => {
    const text = [
      "# s3 = boto3.client('s3')",
      "x = boto3.client('kms')  # boto3.client('iam')",
      'def f():',
      '    """',
      "    Example: boto3.client('lambda')",
      '    """',
      "    q = '''boto3.resource('sns')'''",
      '    print("boto3.client(\'ecs\')")',
      '    print(\'use boto3.client("glue") here\')',
      "    return boto3.client('sqs')",
      `    note = "boto3.Session().client('rds')"`,
    ].join('\n');
    expect(byName(boto3Detector.detect(text, 'a.py'))).toEqual({ kms: 1, sqs: 1 });
  });

  test('an unterminated triple-quoted string hides the rest of the file, and a hash in a string is not a comment', () => {
    expect(detect("a = boto3.client('s3')", '"""never closed', "boto3.client('sns')")).toEqual({
      s3: 1,
    });
    expect(detect("y = boto3.client('a#b-c')", "z = boto3.client('ecs')")).toEqual({
      '': 1,
      ecs: 1,
    });
  });

  test('a service name that is not a literal is counted with an empty identifier', () => {
    expect(detect('x = boto3.client(name)', 'y = boto3.resource(SERVICE)')).toEqual({ '': 2 });
  });

  test('a call over several lines and escapes inside strings are read correctly', () => {
    expect(
      detect(
        'z = boto3.client(',
        "    'ecs',",
        ')',
        String.raw`w = "a\"b"; v = boto3.client('kms')`,
      ),
    ).toEqual({ ecs: 1, kms: 1 });
  });
});

describe('maskPython', () => {
  test('blanks comments and triple-quoted strings, keeps positions, and marks ordinary strings', () => {
    const text = "a = 'x' # note\nb = '''doc\nmore''' + \"y\"\n";
    const { code, inString } = maskPython(text);
    expect(code).toHaveLength(text.length);
    expect(code.includes('note') || code.includes('doc') || code.includes('more')).toBe(false);
    expect(code.includes("'x'") && code.includes('"y"')).toBe(true);
    expect(code.split('\n')).toHaveLength(text.split('\n').length);
    expect(inString.filter(Boolean)).toHaveLength(6);
    expect(inString[text.indexOf("'x'")]).toBe(true);
    expect(inString[text.indexOf('#')]).toBe(false);
  });

  test('an escaped quote does not end a string and a string ends at a line break', () => {
    const { inString, code } = maskPython(String.raw`s = 'it\'s' ; t = 'open` + '\nnext = 1');
    expect(inString[code.indexOf('it')]).toBe(true);
    expect(inString[code.indexOf('next')]).toBe(false);
  });
});

describe('the new services in the table (QA M7)', () => {
  test('each is reachable from every kind of identifier', () => {
    const cases: [string, Record<string, string[]>][] = [
      [
        'efs',
        {
          terraformType: ['aws_efs_file_system'],
          cdkModule: ['aws-efs'],
          sdkPackage: ['@aws-sdk/client-efs'],
          sdkClientName: ['EFS'],
          boto3Name: ['efs'],
        },
      ],
      [
        'ssm',
        {
          terraformType: ['aws_ssm_parameter'],
          cdkModule: ['aws-ssm'],
          sdkPackage: ['@aws-sdk/client-ssm'],
          sdkClientName: ['SSM'],
          boto3Name: ['ssm'],
        },
      ],
      [
        'opensearch',
        {
          terraformType: ['aws_opensearch_domain', 'aws_opensearchserverless_collection'],
          cdkModule: ['aws-opensearchservice'],
          sdkPackage: ['@aws-sdk/client-opensearch'],
          sdkClientName: ['OpenSearch'],
          boto3Name: ['opensearch', 'opensearchserverless', 'es'],
        },
      ],
      [
        'redshift',
        {
          terraformType: ['aws_redshift_cluster', 'aws_redshiftserverless_namespace'],
          cdkModule: ['aws-redshift'],
          sdkPackage: ['@aws-sdk/client-redshift'],
          sdkClientName: ['Redshift'],
          boto3Name: ['redshift', 'redshift-data', 'redshift-serverless'],
        },
      ],
      [
        'msk',
        {
          terraformType: ['aws_msk_cluster', 'aws_mskconnect_connector'],
          cdkModule: ['aws-msk'],
          sdkPackage: ['@aws-sdk/client-kafka'],
          sdkClientName: ['Kafka'],
          boto3Name: ['kafka', 'kafkaconnect'],
        },
      ],
      [
        'appsync',
        {
          terraformType: ['aws_appsync_graphql_api'],
          cdkModule: ['aws-appsync'],
          sdkPackage: ['@aws-sdk/client-appsync'],
          sdkClientName: ['AppSync'],
          boto3Name: ['appsync'],
        },
      ],
    ];
    for (const [key, kinds] of cases) {
      for (const [kind, ids] of Object.entries(kinds)) {
        for (const id of ids) {
          expect(
            resolveService(
              kind as 'terraformType' | 'cdkModule' | 'sdkPackage' | 'sdkClientName' | 'boto3Name',
              id,
            ),
            `${kind} ${id}`,
          ).toBe(key);
        }
      }
    }
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
  const form = fc.constantFrom('direct', 'session', 'chained', 'imported');
  const call = fc.record({
    form,
    method: fc.constantFrom('client', 'resource'),
    service,
    quote,
    keyword: fc.boolean(),
  });
  const noise = fc.constantFrom(
    "# boto3.client('s3')",
    "client_x('s3')",
    "other.client('sns')",
    'x = 1',
    "boto3.upload('s3')",
    '"""\nboto3.client(\'s3\')\n"""',
    'print("boto3.client(\'s3\')")',
    "q = '''session.client('sns')'''",
    '',
  );

  const render = (c: {
    form: string;
    method: string;
    service: string;
    quote: string;
    keyword: boolean;
  }): string => {
    const arg = `${c.keyword ? 'service_name=' : ''}${c.quote}${c.service}${c.quote}`;
    switch (c.form) {
      case 'direct':
        return `v = boto3.${c.method}(${arg})`;
      case 'session':
        return `v = session.${c.method}(${arg})`;
      case 'chained':
        return `v = boto3.Session(region_name=region()).${c.method}(${arg})`;
      default:
        return `v = ${c.method}_imported(${arg})`.replace(
          `${c.method}_imported`,
          c.method === 'client' ? 'client' : 'resource',
        );
    }
  };

  test('one hit per boto3 or session call and nothing for comments, docstrings, strings or unrelated calls', () => {
    fc.assert(
      fc.property(
        fc.array(call, { maxLength: 12 }),
        fc.array(noise, { maxLength: 8 }),
        (calls, noises) => {
          const lines = [
            'import boto3',
            'from boto3 import client, resource',
            "session = boto3.Session(region_name='us-west-2')",
            ...calls.map(render),
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
