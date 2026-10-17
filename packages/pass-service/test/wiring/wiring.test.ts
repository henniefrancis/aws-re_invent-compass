import { describe, expect, test, vi } from 'vitest';
import { ConfigError } from '../../src/config/config.js';
import { DependencyError } from '../../src/http/problem.js';
import {
  newJwksCache,
  productionApiDeps,
  productionPasskitDeps,
} from '../../src/wiring/production-deps.js';
import { BASE_ENV } from '../helpers/api-fixture.js';

describe('Feature: pass-service, production wiring', () => {
  test('builds both dependency sets from a valid environment without touching the network', () => {
    const api = productionApiDeps(BASE_ENV);
    expect(api.config.tableName).toBe('compass-test');
    expect(api.console).toBe(globalThis.console);
    for (const name of [
      'verifier',
      'limiter',
      'passes',
      'registrations',
      'handoffs',
      'signer',
      'apns',
      'google',
    ]) {
      expect(api[name as keyof typeof api], name).toBeDefined();
    }
    const passkit = productionPasskitDeps(BASE_ENV);
    expect(passkit.config.eventTimezone).toBe('America/Los_Angeles');
    expect('google' in passkit).toBe(false);
    expect('verifier' in passkit).toBe(false);
  });

  test('the passkit wiring cannot read the google-wallet secret', async () => {
    const passkit = productionPasskitDeps(BASE_ENV);
    await expect(passkit.secrets.google()).rejects.toBeInstanceOf(DependencyError);
  });

  test('an invalid or missing variable fails closed and names the variable only', () => {
    for (const name of ['TABLE_NAME', 'ORIGIN_VERIFY_SECRET_ID', 'PUBLIC_BASE_URL']) {
      const env = { ...BASE_ENV, [name]: undefined };
      expect(() => productionApiDeps(env)).toThrow(ConfigError);
      expect(() => productionPasskitDeps(env)).toThrow(ConfigError);
    }
    expect(() =>
      productionApiDeps({ ...BASE_ENV, PUBLIC_BASE_URL: 'http://insecure.example' }),
    ).toThrow(ConfigError);
  });

  test('the JWKS cache is a fresh aws-jwt-verify cache each time', () => {
    expect(newJwksCache()).not.toBe(newJwksCache());
  });

  test('log lines go to stdout, one JSON line each', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      productionApiDeps(BASE_ENV).logSink('{"a":1}');
      expect(write).toHaveBeenCalledWith('{"a":1}\n');
    } finally {
      write.mockRestore();
    }
  });
});
