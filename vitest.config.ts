import { defineConfig } from 'vitest/config';

// Root vitest configuration for the re:Invent Compass monorepo (foundation-contracts, S0).
//
// Coverage is v8 at 100 percent for lines, branches, functions and statements, with
// named exclusions only (build plan section 11.2). The run includes every workspace
// test plus the spike modules under spikes/src, so spike logic is covered at 100 percent
// with no new named exclusions.
//
// resolve.conditions includes @compass/source so npm test resolves @compass/core subpaths
// to their TypeScript source, letting a fresh clone run with no build step.
//
// COMPASS_MODE is set to simulated so no test can reach a live transport.
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'spikes/test/**/*.test.ts'],
    env: {
      COMPASS_MODE: 'simulated',
    },
    coverage: {
      provider: 'v8',
      all: true,
      include: [
        'packages/*/src/**/*.ts',
        'spikes/src/**/*.ts',
        '.github/scripts/*.mjs',
        'fixtures/synthetic/generate.ts',
      ],
      exclude: [
        'packages/mcp-server/src/bin.ts',
        'packages/pass-service/src/lambda-entry/*.ts',
        '**/generated/**',
      ],
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
