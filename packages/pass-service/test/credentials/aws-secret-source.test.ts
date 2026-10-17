import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { describe, expect, test, vi } from 'vitest';
import { DependencyError } from '../../src/http/problem.js';
import { awsSecretSource } from '../../src/credentials/secrets-provider.js';

describe('Feature: pass-service, AWS secret source', () => {
  test('sends GetSecretValue for the id and returns the SecretString', async () => {
    const send = vi.fn<(command: GetSecretValueCommand) => Promise<{ SecretString?: string }>>(() =>
      Promise.resolve({ SecretString: '{"a":1}' }),
    );
    const text = await awsSecretSource({ send }).get('compass/dev/app');
    expect(text).toBe('{"a":1}');
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetSecretValueCommand);
    expect(command?.input).toEqual({ SecretId: 'compass/dev/app' });
  });

  test('a secret without a SecretString is a dependency error with no value', async () => {
    const send = vi.fn(() => Promise.resolve({}));
    await expect(awsSecretSource({ send }).get('x')).rejects.toBeInstanceOf(DependencyError);
  });

  test('a failing send is a dependency error with no cause', async () => {
    const send = vi.fn(() => Promise.reject(new Error('AccessDenied for arn:secret')));
    const error = await awsSecretSource({ send })
      .get('x')
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(DependencyError);
    expect((error as Error).message).not.toContain('arn');
    expect((error as Error).cause).toBeUndefined();
  });
});
