import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest configuration for the owner-only live smoke tests (events-client, S1, N3).
//
// The live suite is NOT part of the default run: the root vitest.config.ts includes only
// *.test.ts files, and the live file has a different name. Run it yourself, locally:
//
//   COMPASS_LIVE_TESTS=1 COMPASS_LIVE_CONFIRM=yes COMPASS_LIVE_SESSION_ID=<id> \
//     npx vitest run --config packages/core/test/api/vitest.live.config.ts
//
// Without both opt-ins, or in a CI run, every live test is reported as skipped. No
// COMPASS_MODE override is set here, and there is no coverage.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../../../../', import.meta.url)),
    include: ['packages/core/test/api/live-smoke.live-test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: { enabled: false },
  },
});
