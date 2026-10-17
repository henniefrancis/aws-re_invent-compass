import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { LIVE_TEST_KEYCHAIN_SERVICE, isLiveEnabled } from './live-gate.js';
import { KEYCHAIN_SERVICE } from '../../src/auth/token-store.js';

// Tests for the live smoke test gate (events-client, S1, security N3). The live tests
// themselves are in live-smoke.live-test.ts, outside the default test include, and run
// only through vitest.live.config.ts.

describe('events-client, N3: the live gate', () => {
  const open = { COMPASS_LIVE_TESTS: '1', COMPASS_LIVE_CONFIRM: 'yes' };

  test('it opens only with both opt-ins and no CI marker', () => {
    expect(isLiveEnabled(open)).toBe(true);
    expect(isLiveEnabled({ ...open, CI: '' })).toBe(true);
    expect(isLiveEnabled({ ...open, CI: '0' })).toBe(true);
    expect(isLiveEnabled({ ...open, CI: 'false' })).toBe(true);
    expect(isLiveEnabled({ ...open, CI: 'FALSE' })).toBe(true);
  });

  test('it is closed unless every condition holds', () => {
    expect(isLiveEnabled({})).toBe(false);
    for (const env of [
      { COMPASS_LIVE_TESTS: '1' },
      { COMPASS_LIVE_CONFIRM: 'yes' },
      { COMPASS_LIVE_TESTS: '0', COMPASS_LIVE_CONFIRM: 'yes' },
      { COMPASS_LIVE_TESTS: 'true', COMPASS_LIVE_CONFIRM: 'yes' },
      { COMPASS_LIVE_TESTS: '1', COMPASS_LIVE_CONFIRM: 'YES' },
      { COMPASS_LIVE_TESTS: '1', COMPASS_LIVE_CONFIRM: 'true' },
      { ...open, CI: 'true' },
      { ...open, CI: '1' },
      { ...open, CI: 'github' },
    ]) {
      expect(isLiveEnabled(env)).toBe(false);
    }
  });

  test('the live tests use their own keychain service, not the real one', () => {
    expect(LIVE_TEST_KEYCHAIN_SERVICE).toBe('reinvent-compass-livetest');
    expect(LIVE_TEST_KEYCHAIN_SERVICE).not.toBe(KEYCHAIN_SERVICE);
  });

  test('the live suite is outside the default test include and has its own config', () => {
    const rootConfig = readFileSync(
      fileURLToPath(new URL('../../../../vitest.config.ts', import.meta.url)),
      'utf8',
    );
    expect(rootConfig).toContain("'packages/**/test/**/*.test.ts'");
    const liveConfig = readFileSync(
      fileURLToPath(new URL('./vitest.live.config.ts', import.meta.url)),
      'utf8',
    );
    expect(liveConfig).toContain("include: ['packages/core/test/api/live-smoke.live-test.ts']");
  });
});
