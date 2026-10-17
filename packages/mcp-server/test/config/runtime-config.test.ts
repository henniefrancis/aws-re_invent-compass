import { describe, expect, test } from 'vitest';
import { COMPASS_API_BASE_URL } from '../../src/config/compass-api.js';
import { readRuntimeConfig } from '../../src/config/runtime-config.js';
import { CompassError } from '../../src/ports/errors.js';
import { systemClock } from '../../src/ports/clock.js';

describe('readRuntimeConfig', () => {
  test('defaults to live mode and the single Compass API constant', () => {
    expect(readRuntimeConfig({})).toEqual({ mode: 'live', compassApiUrl: COMPASS_API_BASE_URL });
  });

  test('reads simulated mode only for the exact value', () => {
    expect(readRuntimeConfig({ COMPASS_MODE: 'simulated' }).mode).toBe('simulated');
    expect(readRuntimeConfig({ COMPASS_MODE: 'Simulated' }).mode).toBe('live');
    expect(readRuntimeConfig({ COMPASS_MODE: '' }).mode).toBe('live');
  });

  test('COMPASS_API_URL overrides the constant and loses a trailing slash', () => {
    expect(readRuntimeConfig({ COMPASS_API_URL: 'https://example.test/base/' }).compassApiUrl).toBe(
      'https://example.test/base',
    );
  });

  test('an empty override falls back to the constant', () => {
    expect(readRuntimeConfig({ COMPASS_API_URL: '' }).compassApiUrl).toBe(COMPASS_API_BASE_URL);
  });

  test('rejects a non-https or unparseable override without echoing it', () => {
    for (const bad of ['http://example.test', 'not a url']) {
      let caught: unknown;
      try {
        readRuntimeConfig({ COMPASS_API_URL: bad });
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
