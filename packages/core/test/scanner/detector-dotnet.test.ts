import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { dotnetDetector, maskCSharp } from '../../src/scanner/detectors/dotnet.js';
import type { DetectorHit } from '../../src/scanner/detectors/types.js';
import { resolveService } from '../../src/scanner/service-table.js';

/** The hits as `kind identifier count` lines, sorted. */
function lines(hits: DetectorHit[]): string[] {
  return hits.map((h) => `${h.kind} ${h.identifierKind}:${h.identifier} ${h.count}`).sort();
}

describe('dotnet detector', () => {
  test('accepts C# source and .NET project files only', () => {
    for (const name of ['Program.cs', 'Api.csproj', 'Lib.fsproj']) {
      expect(dotnetDetector.accepts(name)).toBe(true);
    }
    for (const name of ['All.sln', 'script.csx', 'App.vbproj', 'a.ts']) {
      expect(dotnetDetector.accepts(name)).toBe(false);
    }
  });

  test('counts AWSSDK and Amazon.Lambda package references in a project file', () => {
    const text = [
      '<Project Sdk="Microsoft.NET.Sdk">',
      '  <ItemGroup>',
      '    <PackageReference Include="AWSSDK.S3" Version="4.0.0" />',
      '    <PackageReference Include="awssdk.dynamodbv2" Version="4.0.0" />',
      '    <PackageReference Include="Amazon.Lambda.Core" Version="2.5.0" />',
      '    <PackageReference Include="AWSSDK.Core" Version="4.0.0" />',
      '    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />',
      '    <!-- <PackageReference Include="AWSSDK.SQS" /> -->',
      '    <PackageReference Include="AWSSDK.S3" Version="4.0.0" />',
      '  </ItemGroup>',
      '</Project>',
    ].join('\n');
    expect(lines(dotnetDetector.detect(text, 'Api.csproj'))).toEqual([
      'dependencyDeclarations nugetPackage:AWSSDK.Core 1',
      'dependencyDeclarations nugetPackage:AWSSDK.S3 2',
      'dependencyDeclarations nugetPackage:Amazon.Lambda.Core 1',
      'dependencyDeclarations nugetPackage:awssdk.dynamodbv2 1',
    ]);
    expect(resolveService('nugetPackage', 'awssdk.dynamodbv2')).toBe('dynamodb');
    expect(resolveService('nugetPackage', 'AWSSDK.Core')).toBeUndefined();
    expect(dotnetDetector.detect('<Project />', 'Lib.fsproj')).toEqual([]);
  });

  test('counts new Amazon<Name>Client( in C#, plain or with its namespace', () => {
    const text = [
      'using Amazon.S3;',
      'var s3 = new AmazonS3Client();',
      'var s3b = new AmazonS3Client\n  (RegionEndpoint.USEast1);',
      'var ddb = new Amazon.DynamoDBv2.AmazonDynamoDBClient(config);',
      'var sns = new  AmazonSimpleNotificationServiceClient( );',
      'var x = new AmazonMadeUpClient();',
      'var renewed = renew AmazonS3Client();',
      'var notCall = new AmazonS3ClientConfig();',
      'IAmazonS3 typed = new();',
    ].join('\n');
    expect(lines(dotnetDetector.detect(text, 'Program.cs'))).toEqual([
      'sdkClients dotnetClientName:DynamoDB 1',
      'sdkClients dotnetClientName:MadeUp 1',
      'sdkClients dotnetClientName:S3 2',
      'sdkClients dotnetClientName:SimpleNotificationService 1',
    ]);
    expect(resolveService('dotnetClientName', 'SimpleNotificationService')).toBe('sns');
    expect(resolveService('dotnetClientName', 'MadeUp')).toBeUndefined();
  });

  test('a client inside a comment, a string or a character literal is not counted', () => {
    const text = [
      '// var a = new AmazonS3Client();',
      '/* var b = new AmazonS3Client();',
      '   still a comment */ var real = new AmazonSQSClient();',
      'var c = "new AmazonS3Client()";',
      'var d = "escaped \\" new AmazonS3Client()";',
      'var e = @"verbatim "" new AmazonS3Client()',
      '  across lines";',
      'var f = $@"new AmazonS3Client() {x}";',
      'var g = @$"new AmazonS3Client()";',
      'var h = """',
      '  new AmazonS3Client()',
      '  """;',
      'var i = """"has """ inside new AmazonS3Client()"""";',
      "var j = '\"'; var k = new AmazonSNSClientless(); var l = '\\'';",
      'var m = "unterminated new AmazonS3Client()',
      'var after = new AmazonLambdaClient();',
    ].join('\n');
    expect(lines(dotnetDetector.detect(text, 'Program.cs'))).toEqual([
      'sdkClients dotnetClientName:Lambda 1',
      'sdkClients dotnetClientName:SQS 1',
    ]);
  });
});

describe('maskCSharp', () => {
  test('blanks comments and literals, keeps code and every line break', () => {
    expect(maskCSharp('a // b\nc')).toBe('a     \nc');
    expect(maskCSharp('a /* b\nc */ d')).toBe('a     \n     d');
    expect(maskCSharp('x = "s"; y')).toBe('x =    ; y');
    expect(maskCSharp("c = 'q';")).toBe('c =    ;');
    expect(maskCSharp('v = @"a""b";')).toBe('v = @      ;');
    expect(maskCSharp('r = """a"b""";')).toBe('r =          ;');
    expect(maskCSharp('plain code')).toBe('plain code');
  });

  test('unclosed comments and literals run to the end of the text, or of the line', () => {
    const spaces = (n: number): string => ' '.repeat(n);
    expect(maskCSharp('a // tail')).toBe(`a${spaces(8)}`);
    expect(maskCSharp('a /* tail')).toBe(`a${spaces(8)}`);
    expect(maskCSharp('a @"tail\nmore')).toBe(`a @${spaces(5)}\n${spaces(4)}`);
    expect(maskCSharp('a """tail')).toBe(`a${spaces(8)}`);
    expect(maskCSharp('a "tail\nb')).toBe(`a${spaces(6)}\nb`);
    expect(maskCSharp('a "ends \\')).toBe(`a${spaces(8)}`);
  });

  test('keeps the length of any text', () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom('a', ' ', '\n', '"', "'", '@', '$', '/', '*', '\\', 'new'),
          maxLength: 80,
        }),
        (text) => {
          const masked = maskCSharp(text);
          expect(masked).toHaveLength(text.length);
          expect(masked.split('\n')).toHaveLength(text.split('\n').length);
        },
      ),
      { numRuns: 300 },
    );
  });
});
