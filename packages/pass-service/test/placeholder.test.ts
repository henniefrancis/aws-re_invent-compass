import { describe, expect, test } from 'vitest';

// Placeholder test for the @compass/pass-service workspace (foundation-contracts, S0).
//
// On day 1 the pass-service ships a manifest, a stub index and this placeholder test,
// owned day-to-day by S5. This trivial passing test keeps the pass-service workspace in
// the vitest run (picked up by test.include packages/**/test/**/*.test.ts) until S5
// fills the package with the Compass API Lambdas and real tests.
describe('Feature: foundation-contracts, @compass/pass-service placeholder', () => {
  test('pass-service workspace is present in the test run', () => {
    expect(true).toBe(true);
  });
});
