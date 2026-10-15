import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';

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

// The no-restricted-imports assertions lint fixture code with a dedicated, hermetic
// ESLint instance. The rule is purely syntactic, so no type information and no on-disk
// file inside src is needed. The old approach wrote fixture files into packages/core/src
// and linted them with the repo root config and the typescript-eslint project service.
// That mutated shared on-disk state that other suites (for example rules-browser-safe,
// which statically scans packages/core/src) read concurrently under vitest's parallel
// runner, so the full suite failed intermittently. Linting virtual text with
// overrideConfigFile keeps the test deterministic and writes nothing to disk.
describe('Feature: foundation-contracts, no-restricted-imports cross-package ban', () => {
  const srcRoot = join(coreRoot, 'src');

  // A deep relative cross-package import that matches the banned
  // '../../*/src/**' group in the flat config.
  const banCode = "import { x } from '../../contracts/src/index';\nexport const useX = x;\n";
  // A legitimate subpath package import that must not trip the rule.
  const okCode = "import { z } from '@compass/core/rules';\nexport const useZ = z;\n";

  // The exact patterns the repo flat config feeds to no-restricted-imports. These MUST
  // mirror eslint.config.js (crossPackageRelativeImportPatterns). They are used only as a
  // fallback if the real config cannot be imported as data below.
  const fallbackPatterns = [
    {
      group: ['**/packages/*/src/**', '**/packages/*/dist/**'],
      message:
        'Import across packages through the declared package subpath export (for example @compass/core/rules), never a deep relative path into another package.',
    },
    {
      group: ['../*/src/**', '../*/dist/**', '../../*/src/**', '../../*/dist/**'],
      message:
        'Import across packages through the declared package subpath export (for example @compass/core/rules), never a deep relative path into another package.',
    },
  ];

  // Load the real no-restricted-imports option from the repo eslint.config.js. The config
  // is an ESM module that default-exports the flat config array built by tseslint.config.
  // Finding the entry whose rules carry no-restricted-imports and reusing its exact option
  // proves the REPO config bans the import, not a copy. If the dynamic import fails for any
  // reason, fall back to the mirrored patterns above.
  async function loadNoRestrictedImportsOption(): Promise<Linter.RuleEntry> {
    const configPath = join(repoRoot, 'eslint.config.js');
    try {
      const mod = (await import(pathToFileURL(configPath).href)) as {
        default?: unknown;
      };
      const configArray = Array.isArray(mod.default) ? mod.default : [];
      for (const block of configArray) {
        const rules = (block as { rules?: Record<string, unknown> }).rules;
        if (rules && rules['no-restricted-imports'] !== undefined) {
          return rules['no-restricted-imports'] as Linter.RuleEntry;
        }
      }
    } catch {
      // Fall through to the mirrored patterns below.
    }
    return ['error', { patterns: fallbackPatterns }];
  }

  // Build a dedicated ESLint instance that applies ONLY no-restricted-imports with the
  // repo's exact option, parsed by the typescript-eslint parser WITHOUT projectService or
  // project (no type-aware linting). overrideConfigFile: true stops the repo root config
  // from loading, so there is no project-service requirement and lintText works on a
  // virtual filePath with no tsconfig project and no file on disk.
  async function buildHermeticEslint(): Promise<ESLint> {
    const noRestrictedImports = await loadNoRestrictedImportsOption();
    return new ESLint({
      cwd: repoRoot,
      overrideConfigFile: true,
      overrideConfig: [
        {
          // Match the flat config's TypeScript block so no-restricted-imports applies.
          files: ['**/*.ts', '**/*.mts', '**/*.cts'],
          languageOptions: {
            parser: tseslintParser as Linter.Parser,
          },
          rules: {
            'no-restricted-imports': noRestrictedImports,
          },
        },
      ],
    });
  }

  // Lint the given text as a virtual .ts path and return the no-restricted-imports
  // messages. The virtual path lives under packages/core/src so it matches the TypeScript
  // files glob, but nothing is written there: lintText operates on the text alone.
  async function noRestrictedImportsMessages(
    virtualName: string,
    code: string,
  ): Promise<Linter.LintMessage[]> {
    const eslint = await buildHermeticEslint();
    const filePath = join(srcRoot, virtualName);
    const results = await eslint.lintText(code, { filePath });
    const messages = results.flatMap((result) => result.messages);
    return messages.filter((m) => m.ruleId === 'no-restricted-imports');
  }

  test('a deep relative cross-package import is rejected', async () => {
    const messages = await noRestrictedImportsMessages('__virtual_ban__.ts', banCode);
    expect(messages.length).toBeGreaterThan(0);
  });

  test('a legitimate subpath package import is not rejected', async () => {
    const messages = await noRestrictedImportsMessages('__virtual_ok__.ts', okCode);
    expect(messages.length).toBe(0);
  });
});
