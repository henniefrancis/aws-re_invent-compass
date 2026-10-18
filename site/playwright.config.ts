import { defineConfig } from '@playwright/test';
import { PROFILES, optionsOf } from './e2e/support/profiles';

// Browser tests (showcase-site, Requirement 22). Run on demand only:
//   npx playwright test -c playwright.config.ts          (from site/, after the build)
// The Static_Server serves the build output under the Required_CSP, the hand-off routes are
// mocked with contract-shaped fixtures, and no test calls a deployed API. No retries: a failure
// is a failure.

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  retries: 0,
  fullyParallel: true,
  forbidOnly: true,
  // CI also writes the HTML report that the e2e workflow uploads as an artifact.
  reporter: process.env['CI']
    ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    serviceWorkers: 'block',
    acceptDownloads: true,
  },
  webServer: {
    command: `node scripts/serve-static.mjs ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: PROFILES.map((profile) => ({ name: profile.name, use: optionsOf(profile) })),
});
