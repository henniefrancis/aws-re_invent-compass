import { defineConfig } from 'vitest/config';

// Site vitest configuration (showcase-site, S7).
//
// Every decision on the site lives in Site_Logic: src/lib/**/*.ts and scripts/**/*.mjs.
// Coverage is v8 at 100 percent for lines, branches, functions and statements, with no
// exclusion and no ignore comment. Angular components under src/app are decision free and
// are covered by the Playwright suite in e2e/.
//
// root is pinned to this folder so the run works from the repository root:
//   npx vitest run --coverage --config site/vitest.config.ts
//
// resolve.conditions includes @compass/source so @compass/core subpaths resolve to their
// TypeScript source, with no build step.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: {
      COMPASS_MODE: 'simulated',
    },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'scripts/**/*.mjs'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
  resolve: {
    conditions: ['@compass/source'],
  },
});
