import { describe, expect, test } from 'vitest';
import { systemClock, systemRandom } from '../src/seams.js';

describe('Feature: pass-service, production seams', () => {
  test('the system clock reads the current time', () => {
    const before = Date.now();
    const value = systemClock.now();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });

  test('the system random returns fresh bytes and uuid v4 values', () => {
    expect(systemRandom.bytes(16)).toHaveLength(16);
    expect(Buffer.from(systemRandom.bytes(16)).equals(Buffer.from(systemRandom.bytes(16)))).toBe(
      false,
    );
    expect(systemRandom.uuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
