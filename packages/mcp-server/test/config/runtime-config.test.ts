import { describe, expect, test } from 'vitest';
import { COMPASS_API_BASE_URL } from '../../src/config/compass-api.js';
import { readRuntimeConfig } from '../../src/config/runtime-config.js';
import { CompassError } from '../../src/ports/errors.js';
import { systemClock } from '../../src/ports/clock.js';

const BUILT_IN_HOST = new URL(COMPASS_API_BASE_URL).host;

describe('readRuntimeConfig', () => {
  test('defaults to live mode and the build-time constant, with its own host allowed', () => {
    expect(readRuntimeConfig({})).toEqual({
      mode: 'live',
      readOnly: false,
      compassApiUrl: COMPASS_API_BASE_URL,
      allowedHosts: [BUILT_IN_HOST],
    });
  });

  test('read-only live mode is on only for COMPASS_READ_ONLY=1 (task 37)', () => {
    expect(readRuntimeConfig({ COMPASS_READ_ONLY: '1' }).readOnly).toBe(true);
    expect(readRuntimeConfig({ COMPASS_READ_ONLY: 'true' }).readOnly).toBe(false);
    expect(readRuntimeConfig({ COMPASS_READ_ONLY: '0' }).readOnly).toBe(false);
    const override = readRuntimeConfig({
      COMPASS_READ_ONLY: '1',
      COMPASS_API_URL: 'https://example.test',
      COMPASS_ALLOW_API_OVERRIDE: '1',
    });
    expect(override.readOnly).toBe(true);
  });

  test('reads simulated mode only for the exact value', () => {
    expect(readRuntimeConfig({ COMPASS_MODE: 'simulated' }).mode).toBe('simulated');
    expect(readRuntimeConfig({ COMPASS_MODE: 'Simulated' }).mode).toBe('live');
    expect(readRuntimeConfig({ COMPASS_MODE: '' }).mode).toBe('live');
  });

  test('COMPASS_API_URL alone is ignored', () => {
    const config = readRuntimeConfig({ COMPASS_API_URL: 'https://example.test/base' });
    expect(config.compassApiUrl).toBe(COMPASS_API_BASE_URL);
    expect(config.allowedHosts).toEqual([BUILT_IN_HOST]);
    expect(config.warning).toBeUndefined();
    const flagOnly = readRuntimeConfig({ COMPASS_ALLOW_API_OVERRIDE: '1' });
    expect(flagOnly.compassApiUrl).toBe(COMPASS_API_BASE_URL);
    expect(flagOnly.warning).toBeUndefined();
    expect(
      readRuntimeConfig({
        COMPASS_API_URL: 'https://example.test',
        COMPASS_ALLOW_API_OVERRIDE: 'yes',
      }).compassApiUrl,
    ).toBe(COMPASS_API_BASE_URL);
  });

  test('with both variables the override applies, loses a trailing slash and a warning names the host', () => {
    const config = readRuntimeConfig({
      COMPASS_API_URL: 'https://example.test:8443/base/',
      COMPASS_ALLOW_API_OVERRIDE: '1',
    });
    expect(config.compassApiUrl).toBe('https://example.test:8443/base');
    expect(config.allowedHosts).toEqual(['example.test:8443']);
    expect(config.warning).toContain('example.test:8443');
    expect(config.warning).not.toContain('/base');
  });

  test('an empty override falls back to the constant even when allowed', () => {
    const config = readRuntimeConfig({ COMPASS_API_URL: '', COMPASS_ALLOW_API_OVERRIDE: '1' });
    expect(config.compassApiUrl).toBe(COMPASS_API_BASE_URL);
    expect(config.warning).toBeUndefined();
  });

  test('rejects a non-https or unparseable allowed override without echoing it', () => {
    for (const bad of ['http://example.test', 'not a url']) {
      let caught: unknown;
      try {
        readRuntimeConfig({ COMPASS_API_URL: bad, COMPASS_ALLOW_API_OVERRIDE: '1' });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CompassError);
      expect((caught as CompassError).code).toBe('BadRequest');
      expect((caught as CompassError).message).not.toContain(bad);
    }
  });
});

describe('systemClock and CompassError', () => {
  test('the system clock returns a current date', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(5000);
  });

  test('a CompassError carries its code and details and nothing else', () => {
    const error = new CompassError('RateLimited', { retryAfterSeconds: 7 });
    expect(error.name).toBe('CompassError');
    expect(error.message).toBe('RateLimited');
    expect(error.details).toEqual({ retryAfterSeconds: 7 });
    expect(new CompassError('Internal').details).toEqual({});
  });
});
