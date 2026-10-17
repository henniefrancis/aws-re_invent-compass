import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { nextLastUpdated, nextUpdateTag } from '../../src/data/last-updated.js';

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, Last_Updated', () => {
  // Feature: pass-service, Property 16: Last_Updated strictly increases at second precision
  test('Property 16: whole seconds, at least one second after the previous, never before the current second', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000 }).map((s) => s * 1000),
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.integer({ min: 0, max: 999 }),
        (previous, drift, millis) => {
          const now = previous + drift * 1000 + millis;
          const next = nextLastUpdated(previous, now);
          expect(next % 1000).toBe(0);
          expect(next).toBeGreaterThanOrEqual(previous + 1000);
          expect(next).toBeGreaterThanOrEqual(Math.floor(now / 1000) * 1000);
          // A second-precision If-Modified-Since equal to the old value sees the change.
          expect(Math.floor(next / 1000)).toBeGreaterThan(Math.floor(previous / 1000));
        },
      ),
      { numRuns: 200 },
    );
  });

  test('a stalled or backwards clock still moves forward by one second', () => {
    expect(nextLastUpdated(10_000, 10_400)).toBe(11_000);
    expect(nextLastUpdated(10_000, 5_000)).toBe(11_000);
    expect(nextLastUpdated(10_000, 20_900)).toBe(20_000);
  });
});

describe('Feature: pass-service, update tag', () => {
  test('the tag is in milliseconds and strictly increases even when the clock stands still', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        fc.integer({ min: -5000, max: 5000 }),
        (previous, drift) => {
          const next = nextUpdateTag(previous, previous + drift);
          expect(next).toBeGreaterThan(previous);
          expect(next).toBeGreaterThanOrEqual(previous + drift);
        },
      ),
      { numRuns: 200 },
    );
    expect(nextUpdateTag(1000, 1000)).toBe(1001);
    expect(nextUpdateTag(1000, 1500)).toBe(1500);
  });
});
