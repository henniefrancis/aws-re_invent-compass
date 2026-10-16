import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

// Property test for the browser-safe rules subpath (foundation-contracts, S0).
//
// Property 13: The rules subpath is browser-safe.
// Validates: Requirements 2.4.
//
// Requirement 2.4 says the @compass/core/rules subpath SHALL import no Node runtime
// modules, so that the subpath is importable in a browser. This test statically analyses
// the rules subpath entry (packages/core/src/rules/index.ts) and its transitive LOCAL
// import graph (relative imports that resolve within packages/core/src), and asserts that
// no module in that graph imports a Node builtin (a node: prefixed specifier, or a bare
// specifier whose name is a Node builtin module name).
//
// The rules stub is empty on day 1, so the local graph is just the entry file and no
// builtin is imported. The analysis is written to stay correct once S2 fills in real
// rules code: it follows relative imports, guards against cycles, and never recurses into
// node_modules. Alongside the deterministic graph assertion, fast-check drives the Node
// builtin detector itself so the property stays meaningful (at least 100 runs) even while
// the real graph has no imports yet.

// Find the monorepo root by walking up until a package.json that declares a workspaces
// field is found. Falls back to resolving relative to this test file.
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
      // No workspaces manifest found: fall back to the package src root.
      return resolve(dirname(fileURLToPath(import.meta.url)), '..');
    }
    current = parent;
  }
}

// The authoritative set of Node builtin module names, taken from node:module. Names are
// normalised by stripping an optional node: prefix so both forms are covered.
const BUILTIN_SET: ReadonlySet<string> = new Set(
  builtinModules.map((name) => (name.startsWith('node:') ? name.slice(5) : name)),
);

// A specifier is a Node builtin if it starts with the node: prefix, or if its bare name
// (the part before any subpath, with an optional node: prefix removed) is a known builtin.
function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) {
    return true;
  }
  // A relative or absolute specifier is never a bare builtin name.
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return false;
  }
  // Reduce a scoped or subpath specifier to its first segment for the builtin lookup.
  // Builtins are single segment names (fs, path, node:fs), so only the head matters.
  const head = specifier.split('/')[0];
  return BUILTIN_SET.has(head);
}

// Match static import-from, export-from and dynamic import() specifiers in source text.
// This is a deliberately simple source scan: it finds the quoted specifier string in each
// of the three forms. It is robust enough for the stub today and for ordinary rules code.
const IMPORT_FROM = /\bimport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const EXPORT_FROM = /\bexport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Collect every import or export specifier found in one file's source text.
function extractSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const regex of [IMPORT_FROM, EXPORT_FROM, BARE_IMPORT, DYNAMIC_IMPORT]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      found.push(match[1]);
    }
  }
  return found;
}

// Resolve a relative specifier from the importing file to a concrete .ts file on disk.
// Tries the specifier as a .ts file and as a directory index.ts. Returns null if neither
// exists, which also covers specifiers that point at compiled .js that is not present.
function resolveLocalTs(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base.endsWith('.ts') ? base : `${base}.ts`,
    join(base, 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Result of walking the transitive local import graph from the rules entry.
interface GraphAnalysis {
  // Every import or export specifier seen across every file in the local graph.
  readonly specifiers: string[];
  // True if any file in the graph imports a Node builtin.
  readonly usesNodeBuiltin: boolean;
  // The files actually visited (for diagnostics and a sanity check).
  readonly visited: string[];
}

// Walk the transitive LOCAL import graph starting at entryFile. Relative specifiers that
// resolve to a .ts file inside srcRoot are followed; bare non-builtin specifiers (for
// example zod) are recorded but not recursed into; a visited set guards against cycles.
function analyseGraph(entryFile: string, srcRoot: string): GraphAnalysis {
  const specifiers: string[] = [];
  const visited: string[] = [];
  const seen = new Set<string>();
  const stack: string[] = [entryFile];
  let usesNodeBuiltin = false;

  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    visited.push(file);

    const source = readFileSync(file, 'utf8');
    for (const specifier of extractSpecifiers(source)) {
      specifiers.push(specifier);
      if (isNodeBuiltin(specifier)) {
        usesNodeBuiltin = true;
        continue;
      }
      if (specifier.startsWith('.')) {
        const resolved = resolveLocalTs(file, specifier);
        // Only follow local files that resolve inside the package src tree.
        if (resolved !== null && resolved.startsWith(srcRoot) && !seen.has(resolved)) {
          stack.push(resolved);
        }
      }
      // Bare non-builtin specifiers (packages) are recorded but not followed.
    }
  }

  return { specifiers, usesNodeBuiltin, visited };
}

const repoRoot = findRepoRoot();
const srcRoot = join(repoRoot, 'packages', 'core', 'src');
const rulesEntry = join(srcRoot, 'rules', 'index.ts');
const analysis = analyseGraph(rulesEntry, srcRoot);

// A pool of clearly non-builtin specifiers to feed the negative side of the detector
// property. These are relative paths and package-like names that are not Node builtins.
const NON_BUILTIN_SAMPLES: readonly string[] = [
  './index',
  '../rules/index',
  './helpers/clock',
  'zod',
  '@compass/contracts',
  '@compass/core/rules',
  'fast-check',
];

describe('Feature: foundation-contracts, Property 13: The rules subpath is browser-safe', () => {
  test('the rules entry file and its local graph were analysed', () => {
    // Guard so the deterministic assertions below are never vacuous: the entry must exist
    // and be part of the visited graph.
    expect(existsSync(rulesEntry)).toBe(true);
    expect(analysis.visited).toContain(rulesEntry);
  });

  test('no module in the rules local import graph imports a Node builtin', () => {
    // The real requirement, asserted deterministically over the actual rules source and
    // its transitive local imports. Validates Requirement 2.4.
    const offending = analysis.specifiers.filter((s) => isNodeBuiltin(s));
    expect(
      analysis.usesNodeBuiltin,
      `rules graph imports Node builtins: ${offending.join(', ')}`,
    ).toBe(false);
  });

  test('Feature: foundation-contracts, Property 13: The rules subpath is browser-safe', async () => {
    const fc = await import('fast-check');

    // Build the array of specifiers to sample. Include every specifier found in the real
    // local graph (empty today) plus the known non-builtin samples, so the positive side
    // of the property always has inputs to draw from even while the stub has no imports.
    const browserSafeSpecifiers = [...analysis.specifiers, ...NON_BUILTIN_SAMPLES];

    // Positive side: every specifier actually present in the rules local graph, and every
    // clearly non-builtin sample, must NOT be flagged as a Node builtin. This enforces the
    // browser-safe requirement across the real graph and guards the detector against false
    // positives. Validates Requirement 2.4.
    fc.assert(
      fc.property(fc.constantFrom(...browserSafeSpecifiers), (specifier: string) => {
        expect(
          isNodeBuiltin(specifier),
          `specifier "${specifier}" from the rules graph was flagged as a Node builtin`,
        ).toBe(false);
      }),
      { numRuns: 100 },
    );

    // Detector soundness, builtin side: every known Node builtin name, with and without
    // the node: prefix, must be flagged. This keeps the guard honest so a future real
    // rules import of a builtin would be caught.
    const builtinNames = [...BUILTIN_SET];
    fc.assert(
      fc.property(
        fc.constantFrom(...builtinNames),
        fc.boolean(),
        (name: string, withPrefix: boolean) => {
          const specifier = withPrefix ? `node:${name}` : name;
          expect(
            isNodeBuiltin(specifier),
            `builtin "${specifier}" was not flagged by the detector`,
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );

    // Detector soundness, non-builtin side: arbitrary relative paths and package-like
    // names that are not builtins must never be flagged. Relative specifiers are prefixed
    // so they can never collide with a bare builtin name, and generated package names are
    // filtered to exclude any builtin head segment.
    const relativeSpecifier = fc
      .string({ minLength: 1, maxLength: 20 })
      .map((s) => `./${s.replace(/['"]/g, '')}`);
    const packageSpecifier = fc
      .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
      .filter((name) => !BUILTIN_SET.has(name));
    fc.assert(
      fc.property(
        fc.oneof(relativeSpecifier, packageSpecifier),
        (specifier: string) => {
          expect(
            isNodeBuiltin(specifier),
            `non-builtin "${specifier}" was wrongly flagged by the detector`,
          ).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
