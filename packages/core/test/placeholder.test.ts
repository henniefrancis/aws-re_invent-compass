import { describe, expect, test } from 'vitest';

// Placeholder test for the @compass/core workspace (foundation-contracts, S0).
//
// On day 1 the eight core subpaths ship empty compiling stubs (export {};), owned
// day-to-day by streams S1 to S4. This trivial passing test keeps the core workspace
// in the vitest run (picked up by test.include packages/**/test/**/*.test.ts) until a
// stream fills its own subpath folder with real logic and real tests.
describe('Feature: foundation-contracts, @compass/core placeholder', () => {
  test('core workspace is present in the test run', () => {
    expect(true).toBe(true);
  });
});
