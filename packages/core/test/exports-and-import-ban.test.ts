import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

// Unit tests for the @compass/core exports map and the cross-package import ban
// (foundation-contracts, S0).
//
// These are ordinary unit assertions, not property tests. They lock the facts that the
// parallel streams rely on:
//   - the core exports map exposes exactly the eight subpath keys, each with a
//     @compass/source condition, and no "." root export (Requirements 2.1, 2.2);
//   - there is no src/index.ts barrel file under packages/core/src (Requirement 2.3);
//   - the flat eslint config rejects a deep relative cross-package import through
//     no-restricted-imports, while a legitimate subpath package import does not trip
//     that rule, and no eslint-plugin-import dependency exists (Requirement 2.6).

// Find the monorepo root by walking up until a package.json that declares a workspaces
// field is found. Falls back to resolving relative to this test file. This mirrors the
// resolution used by the other core and contracts tests.
function findRepoRoot(): string {
  let current = resolve(dirname(fileURLToPath(import.meta.url)));
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
      return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    }
    current = parent;
  }
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

const repoRoot = findRepoRoot();
const coreRoot = join(repoRoot, 'packages', 'core');

// The eight subpath keys the core package must export, as declared in the design and
// the structure steering (no shared barrel file).
const EXPECTED_SUBPATHS = [
  './auth',
  './api',
  './catalog',
  './simulated',
  './rules',
  './scanner',
  './spec',
  './passes',
] as const;

describe('Feature: foundation-contracts, @compass/core exports map', () => {
  const manifest = readJson(join(coreRoot, 'package.json'));
  const exportsMap = manifest.exports as Record<
    string,
    Record<string, unknown>
  >;

  test('exports map has exactly the eight expected subpath keys', () => {
    expect(exportsMap).toBeDefined();
    expect(Object.keys(exportsMap).sort()).toEqual([...EXPECTED_SUBPATHS].sort());
  });

  test('every subpath lists a @compass/source condition', () => {
    for (const subpath of EXPECTED_SUBPATHS) {
      const entry = exportsMap[subpath];
      expect(entry, `subpath ${subpath} must be present`).toBeDefined();
      expect(
        entry['@compass/source'],
        `subpath ${subpath} must list a @compass/source condition`,
      ).toBeDefined();
      expect(typeof entry['@compass/source']).toBe('string');
    }
  });

  test('exports map has no "." root export', () => {
    expect(Object.prototype.hasOwnProperty.call(exportsMap, '.')).toBe(false);
  });
});

describe('Feature: foundation-contracts, @compass/core has no barrel file', () => {
  test('packages/core/src/index.ts does not exist', () => {
    expect(existsSync(join(coreRoot, 'src', 'index.ts'))).toBe(false);
  });
});

describe('Feature: foundation-contracts, no eslint-plugin-import dependency', () => {
  const rootManifest = readJson(join(repoRoot, 'package.json'));

  function allDependencyNames(manifest: Record<string, unknown>): string[] {
    const sections = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ] as const;
    const names: string[] = [];
    for (const section of sections) {
      const block = manifest[section];
      if (block && typeof block === 'object') {
        names.push(...Object.keys(block as Record<string, unknown>));
      }
    }
    return names;
  }

  test('root package.json declares no eslint-plugin-import dependency', () => {
    expect(allDependencyNames(rootManifest)).not.toContain('eslint-plugin-import');
  });

  test('eslint-plugin-import is not installed under node_modules', () => {
    expect(
      existsSync(join(repoRoot, 'node_modules', 'eslint-plugin-import')),
    ).toBe(false);
  });
});

// The no-restricted-imports assertions run the real flat config from the repo root over
// temporary fixture files written inside packages/core/src, so the typescript-eslint
// project service can resolve them. The fixtures are removed after the suite, even if an
// assertion fails.
describe('Feature: foundation-contracts, no-restricted-imports cross-package ban', () => {
  const srcRoot = join(coreRoot, 'src');
  const banFixture = join(srcRoot, '__import_ban_fixture__.ts');
  const okFixture = join(srcRoot, '__import_ok_fixture__.ts');

  // A deep relative cross-package import that matches the banned
  // '../../*/src/**' group in the flat config.
  const banCode = "import { x } from '../../contracts/src/index';\nexport const useX = x;\n";
  // A legitimate subpath package import that must not trip the rule.
  const okCode = "import { z } from '@compass/core/rules';\nexport const useZ = z;\n";

  // Lint the given text as the given fixture file and return the no-restricted-imports
  // messages. The ESLint instance loads the repo root flat config automatically.
  async function noRestrictedImportsMessages(
    filePath: string,
    code: string,
  ): Promise<ESLint.LintMessage[]> {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintText(code, { filePath });
    const messages = results.flatMap((result) => result.messages);
    return messages.filter((m) => m.ruleId === 'no-restricted-imports');
  }

  beforeAll(() => {
    writeFileSync(banFixture, banCode, 'utf8');
    writeFileSync(okFixture, okCode, 'utf8');
  });

  afterAll(() => {
    // Remove the temporary fixtures so they are never committed, even on failure.
    rmSync(banFixture, { force: true });
    rmSync(okFixture, { force: true });
  });

  test('a deep relative cross-package import is rejected', async () => {
    const messages = await noRestrictedImportsMessages(banFixture, banCode);
    expect(messages.length).toBeGreaterThan(0);
  });

  test('a legitimate subpath package import is not rejected', async () => {
    const messages = await noRestrictedImportsMessages(okFixture, okCode);
    expect(messages.length).toBe(0);
  });
});
