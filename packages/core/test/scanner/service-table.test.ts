import { describe, expect, test } from 'vitest';
import { SERVICE_TABLE, entryFor, resolveService } from '../../src/scanner/service-table.js';
import type { IdentifierKind } from '../../src/scanner/service-table.js';

describe('SERVICE_TABLE structure', () => {
  test('keys are unique and entries are complete', () => {
    const keys = SERVICE_TABLE.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SERVICE_TABLE.length).toBeGreaterThanOrEqual(25);
    for (const entry of SERVICE_TABLE) {
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.taxonomyCandidates.length).toBeGreaterThan(0);
      expect(entry.taxonomyCandidates).toContain(entry.displayName);
      const identifiers =
        entry.terraformPrefixes.length +
        entry.cdkModules.length +
        entry.sdkPackages.length +
        entry.sdkClientNames.length +
        entry.boto3Names.length;
      expect(identifiers).toBeGreaterThan(0);
    }
  });

  test('display names are unique and contain no dash character', () => {
    const names = SERVICE_TABLE.map((entry) => entry.displayName);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).not.toMatch(/[–—]/);
    }
  });

  test('every identifier resolves to exactly its own entry', () => {
    const seen = new Map<string, string>();
    for (const entry of SERVICE_TABLE) {
      const lists: [IdentifierKind, string[]][] = [
        ['terraformType', entry.terraformPrefixes],
        ['cdkModule', entry.cdkModules],
        ['sdkPackage', entry.sdkPackages],
        ['sdkClientName', entry.sdkClientNames],
        ['boto3Name', entry.boto3Names],
      ];
      for (const [kind, identifiers] of lists) {
        for (const identifier of identifiers) {
          expect(resolveService(kind, identifier)).toBe(entry.key);
          const id = `${kind}:${identifier}`;
          expect(seen.get(id)).toBeUndefined();
          seen.set(id, entry.key);
        }
      }
    }
  });

  test('official names are used for a few well known services', () => {
    expect(entryFor('s3')?.displayName).toBe('Amazon S3');
    expect(entryFor('lambda')?.displayName).toBe('AWS Lambda');
    expect(entryFor('sagemaker')?.displayName).toBe('Amazon SageMaker AI');
    expect(entryFor('nothing')).toBeUndefined();
  });
});

describe('resolveService', () => {
  test('Terraform types use the longest matching prefix', () => {
    expect(resolveService('terraformType', 'aws_s3_bucket')).toBe('s3');
    expect(resolveService('terraformType', 'aws_cloudwatch_event_rule')).toBe('eventbridge');
    expect(resolveService('terraformType', 'aws_cloudwatch_log_group')).toBe('cloudwatch');
    expect(resolveService('terraformType', 'aws_route53_zone')).toBe('route53');
    expect(resolveService('terraformType', 'aws_route')).toBe('vpc');
    expect(resolveService('terraformType', 'aws_instance')).toBe('ec2');
    expect(resolveService('terraformType', 'aws_vpc_endpoint')).toBe('vpc');
  });

  test('a prefix without a trailing underscore matches only the exact type', () => {
    expect(resolveService('terraformType', 'aws_instance_profile')).toBeUndefined();
    expect(resolveService('terraformType', 'aws_vpclattice_service')).toBeUndefined();
    expect(resolveService('terraformType', 'aws_route53resolver_endpoint')).toBeUndefined();
  });

  test('unknown identifiers resolve to nothing', () => {
    expect(resolveService('terraformType', 'aws_made_up_thing')).toBeUndefined();
    expect(resolveService('cdkModule', 'aws-nothing')).toBeUndefined();
    expect(resolveService('sdkPackage', '@aws-sdk/client-nothing')).toBeUndefined();
    expect(resolveService('sdkClientName', 'Nothing')).toBeUndefined();
    expect(resolveService('boto3Name', 'nothing')).toBeUndefined();
  });

  test('SDK lib packages map to their service', () => {
    expect(resolveService('sdkPackage', '@aws-sdk/lib-dynamodb')).toBe('dynamodb');
    expect(resolveService('sdkPackage', '@aws-sdk/lib-storage')).toBe('s3');
  });
});
