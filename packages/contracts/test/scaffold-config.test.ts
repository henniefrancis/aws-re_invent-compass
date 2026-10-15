import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Configuration smoke tests for the workspace scaffold (foundation-contracts, S0).
//
// These are ordinary unit assertions over the committed root configuration, not a
// property test. They lock the facts that every parallel stream relies on the next day:
// the five workspaces, the Node engine range, the Node version pin, strict TypeScript in
// the base config (and in any workspace tsconfig that already exists), and the vitest
// coverage thresholds at 100 percent.
//
// Validates: Requirements 1.1, 1.2, 1.5, 1.11, 1.12.

// Find the monorepo root by walking up from the current working directory until a
// package.json that declares a workspaces field is found. Falls back to process.cwd().
// This mirrors the resolution used by the dependency pinning property test.
function findRepoRoot(): string {
  let current = resolve(process.cwd());
  for (;;) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
          workspaces?: unknown;
        };
        if (parsed.workspaces !== undefined) {
          return current;
        }
      } catch {
        // Ignore an unparseable manifest and keep walking up.
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(process.cwd());
    }
    current = parent;
  }
}

// Read a plain JSON file at an absolute path and parse it. The scaffold config files are
// plain JSON, so no comment stripping is needed here.
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

const repoRoot = findRepoRoot();

// The five workspaces the scaffold must declare, in the exact expected order.
const EXPECTED_WORKSPACES = [
  'packages/contracts',
  'packages/core',
  'packages/mcp-server',
  'packages/pass-service',
  'site',
] as const;

// Every workspace tsconfig the scaffold will eventually own. These are created in a
// later task, so each is checked only when it already exists.
const WORKSPACE_TSCONFIGS = [
  join(repoRoot, 'packages', 'contracts', 'tsconfig.json'),
  join(repoRoot, 'packages', 'core', 'tsconfig.json'),
  join(repoRoot, 'packages', 'mcp-server', 'tsconfig.json'),
  join(repoRoot, 'packages', 'pass-service', 'tsconfig.json'),
  join(repoRoot, 'site', 'tsconfig.json'),
] as const;

const COVERAGE_METRICS = ['lines', 'branches', 'functions', 'statements'] as const;

describe('Feature: foundation-contracts, scaffold configuration smoke tests', () => {
  test('root package.json workspaces equals exactly the five expected entries', () => {
    const manifest = readJson(join(repoRoot, 'package.json'));
    expect(manifest.workspaces).toEqual(EXPECTED_WORKSPACES);
  });

  test('root package.json engines.node is ">=24"', () => {
    const manifest = readJson(join(repoRoot, 'package.json'));
    const engines = manifest.engines as { node?: unknown } | undefined;
    expect(engines?.node).toBe('>=24');
  });

  test('.nvmrc content trimmed is "24"', () => {
    const nvmrc = readFileSync(join(repoRoot, '.nvmrc'), 'utf8');
    expect(nvmrc.trim()).toBe('24');
  });

  test('tsconfig.base.json compilerOptions.strict is true', () => {
    const base = readJson(join(repoRoot, 'tsconfig.base.json'));
    const compilerOptions = base.compilerOptions as
      | { strict?: unknown }
      | undefined;
    expect(compilerOptions?.strict).toBe(true);
  });

  test('base and every existing workspace tsconfig carry strict true', () => {
    // The base config must assert strict true itself.
    const base = readJson(join(repoRoot, 'tsconfig.base.json'));
    const baseCompilerOptions = base.compilerOptions as
      | { strict?: unknown }
      | undefined;
    expect(baseCompilerOptions?.strict).toBe(true);

    // For each workspace tsconfig that already exists, it must either set strict true
    // directly or extend the base config, which carries strict true. Workspace tsconfigs
    // that do not exist yet are created in a later task and are skipped here, so this
    // smoke test stays green now and still meaningful once they appear.
    for (const tsconfigPath of WORKSPACE_TSCONFIGS) {
      if (!existsSync(tsconfigPath)) {
        continue;
      }
      const config = readJson(tsconfigPath);
      const compilerOptions = config.compilerOptions as
        | { strict?: unknown }
        | undefined;
      const extendsField = config.extends;
      const setsStrictDirectly = compilerOptions?.strict === true;
      const extendsBase =
        typeof extendsField === 'string' &&
        extendsField.includes('tsconfig.base.json');
      expect(
        setsStrictDirectly || extendsBase,
        `${tsconfigPath} must set compilerOptions.strict true or extend tsconfig.base.json`,
      ).toBe(true);
    }
  });

  test('vitest coverage thresholds are 100 for lines, branches, functions and statements', () => {
    // vitest.config.ts is a TypeScript module, not JSON, and dynamically importing it
    // forces the config loader to resolve the solution tsconfig whose project references
    // point at per-workspace tsconfigs created in a later task. To keep this smoke test
    // self contained now, read the config text and assert each threshold value directly.
    // Each metric is matched on its own so the assertion genuinely checks all four.
    const configText = readFileSync(join(repoRoot, 'vitest.config.ts'), 'utf8');
    for (const metric of COVERAGE_METRICS) {
      const pattern = new RegExp(`${metric}\\s*:\\s*(\\d+)`);
      const match = pattern.exec(configText);
      expect(match, `vitest coverage threshold for ${metric} must be present`).not.toBeNull();
      expect(
        Number(match?.[1]),
        `vitest coverage threshold for ${metric} must be 100`,
      ).toBe(100);
    }
  });
});
