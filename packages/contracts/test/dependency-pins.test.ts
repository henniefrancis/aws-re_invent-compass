import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Property test for exact dependency pinning (foundation-contracts, S0).
//
// Property 1: Every declared dependency is an exact pin.
// Validates: Requirements 1.7, 1.8, 1.16.
//
// Requirement 1.7 and 1.8 require every declared dependency to be pinned to an exact
// version. Requirement 1.16 says that if any dependency is declared with a version range
// rather than an exact pin, the scaffold is non-compliant and must be corrected to an
// exact pin. This test reads every package.json that the monorepo owns or declares (the
// root manifest plus any existing per-workspace manifests), collects all dependency maps,
// and asserts that each declared version is a bare exact semver with no range operators.

// A dependency map keyed by package name to its declared version specifier.
type DependencyMap = Record<string, string>;

// One collected entry: where the dependency came from, its name and its version specifier.
interface DependencyEntry {
  readonly manifest: string;
  readonly scope: string;
  readonly name: string;
  readonly version: string;
}

// Find the monorepo root by walking up from the current working directory until a
// package.json that declares a workspaces field is found. Falls back to process.cwd().
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

// The dependency map keys that npm treats as declared dependencies.
const DEPENDENCY_SCOPES = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

// Build the list of manifest paths the monorepo owns or declares: the root package.json
// plus every per-workspace manifest that currently exists (packages/* and site). Right
// now only the root exists; the per-workspace manifests are created in a later task, so
// the test enumerates whatever is present and stays correct as they appear.
function collectManifestPaths(repoRoot: string): string[] {
  const paths: string[] = [join(repoRoot, 'package.json')];
  const workspaceGuesses = [
    join(repoRoot, 'packages', 'contracts', 'package.json'),
    join(repoRoot, 'packages', 'core', 'package.json'),
    join(repoRoot, 'packages', 'mcp-server', 'package.json'),
    join(repoRoot, 'packages', 'pass-service', 'package.json'),
    join(repoRoot, 'site', 'package.json'),
  ];
  for (const guess of workspaceGuesses) {
    if (existsSync(guess)) {
      paths.push(guess);
    }
  }
  return paths;
}

// Read one manifest and flatten every dependency scope into a list of entries.
function readEntries(manifestPath: string): DependencyEntry[] {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const entries: DependencyEntry[] = [];
  for (const scope of DEPENDENCY_SCOPES) {
    const map = parsed[scope];
    if (map === undefined || map === null || typeof map !== 'object') {
      continue;
    }
    for (const [name, version] of Object.entries(map as DependencyMap)) {
      entries.push({ manifest: manifestPath, scope, name, version });
    }
  }
  return entries;
}

// An exact pin is a plain semver: MAJOR.MINOR.PATCH, optionally with a prerelease tag
// and build metadata, and nothing else. No range operators (caret, tilde, comparators,
// hyphen ranges, logical or), no wildcards (x or star), no "latest" tag, and no non
// registry protocol (git, url, file, workspace). For the S0 scaffold every dependency is
// a registry exact pin, so anything that is not a bare exact semver is flagged.
const EXACT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

function isExactPin(version: string): boolean {
  return EXACT_SEMVER.test(version);
}

const repoRoot = findRepoRoot();
const manifestPaths = collectManifestPaths(repoRoot);
const allEntries: DependencyEntry[] = manifestPaths.flatMap(readEntries);

describe('Feature: foundation-contracts, Property 1: Every declared dependency is an exact pin', () => {
  test('at least one dependency is declared across the owned manifests', () => {
    // Guard so the property is never vacuously true against an empty manifest set.
    expect(allEntries.length).toBeGreaterThan(0);
  });

  test('Feature: foundation-contracts, Property 1: Every declared dependency is an exact pin', async () => {
    const fc = await import('fast-check');
    // Sample across the real declared dependency entries. fc.constantFrom draws uniformly
    // from the collected entries, so fast-check exercises the actual package.json contents
    // rather than synthetic data. Validates Requirements 1.7, 1.8, 1.16.
    fc.assert(
      fc.property(fc.constantFrom(...allEntries), (entry: DependencyEntry) => {
        expect(
          isExactPin(entry.version),
          `${entry.manifest} ${entry.scope}.${entry.name} is "${entry.version}", which is not an exact pin`,
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
