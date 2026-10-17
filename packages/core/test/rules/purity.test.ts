import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Static tests for the rules engine source (itinerary-rules, S2): no Node built-in imports,
// no impure calls, the four shared types are never redefined, and no test reads the synthetic
// catalog. Requirements: 10.1, 10.2, 10.4, 12.4, 12.5, ADR-025.

const here = dirname(fileURLToPath(import.meta.url));
const rulesSrc = resolve(here, '../../src/rules');
const rulesTests = here;
const contractsIndex = resolve(here, '../../../contracts/src/index.ts');

/** Every .ts file under a folder, at any depth, so a future subfolder is scanned too. */
function tsFilesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? tsFilesUnder(join(folder, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(folder, entry.name)]
        : [],
  );
}

const sourceFiles = tsFilesUnder(rulesSrc);

const read = (file: string): string => readFileSync(file, 'utf8');

/** Every module specifier in import and export-from statements, and dynamic imports. */
function specifiersOf(text: string): string[] {
  const found: string[] = [];
  const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(pattern)) {
    found.push(match[1]);
  }
  return found;
}

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const isBuiltin = (specifier: string): boolean =>
  specifier.startsWith('node:') || builtins.has(specifier) || builtins.has(specifier.split('/')[0]);

describe('Node built-in import scan', () => {
  test('the rules source and its transitive imports reference no Node built-in module', () => {
    const external = new Set<string>();
    const visited = new Set<string>();
    const queue = [...sourceFiles];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (visited.has(file)) continue;
      visited.add(file);
      for (const specifier of specifiersOf(read(file))) {
        expect(isBuiltin(specifier), `${file} imports ${specifier}`).toBe(false);
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
          expect(existsSync(target), `${file} imports ${specifier}`).toBe(true);
          queue.push(target);
        } else if (specifier === '@compass/contracts') {
          queue.push(contractsIndex);
        } else {
          external.add(specifier);
        }
      }
    }
    // The only third-party package the engine and the contracts it reads import is zod.
    expect([...external]).toEqual(['zod']);
    expect(visited.size).toBeGreaterThan(sourceFiles.length);
  });

  test('the scan recognises built-ins, with and without the node: prefix', () => {
    expect(isBuiltin('node:fs')).toBe(true);
    expect(isBuiltin('fs')).toBe(true);
    expect(isBuiltin('fs/promises')).toBe(true);
    expect(isBuiltin('zod')).toBe(false);
    expect(
      specifiersOf(
        "import { a } from 'fs';\nexport * from \"./x.js\";\nconst b = await import('path');",
      ),
    ).toEqual(['fs', './x.js', 'path']);
  });
});

describe('recursive scan', () => {
  test('finds files at any depth', () => {
    const found = tsFilesUnder(rulesSrc).map((file) => file.split(/[\\/]/).pop());
    expect(found).toContain('check-reservation.ts');
    expect(found.length).toBeGreaterThanOrEqual(15);
    const here = tsFilesUnder(resolve(rulesSrc, '..'));
    expect(here.length).toBeGreaterThan(found.length);
  });
});

describe('impurity static scan', () => {
  // The design lists node:, fs, path, process, Buffer, Date.now(, new Date() and Math.random.
  // fs, path and process are matched as module imports and global use, because zod's issue
  // objects legitimately have a field named path.
  const forbidden: Array<[string, RegExp]> = [
    ['node: import', /node:/],
    ['fs import', /(?:from|require\()\s*['"](?:fs|fs\/promises)['"]/],
    ['path import', /(?:from|require\()\s*['"]path['"]/],
    ['process global', /\bprocess\./],
    ['Buffer global', /\bBuffer\b/],
    ['Date.now(', /Date\.now\(/],
    ['new Date()', /new Date\(\)/],
    ['Math.random', /Math\.random/],
    ['console', /\bconsole\./],
    ['timers', /\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\(/],
    ['network', /\b(?:fetch|XMLHttpRequest|WebSocket)\b/],
  ];

  test.each(sourceFiles.map((file) => [file.split(/[\\/]/).pop() as string, file]))(
    '%s has no impure call or Node reference',
    (_name, file) => {
      const text = read(file);
      for (const [label, pattern] of forbidden) {
        expect(pattern.test(text), `${label} found`).toBe(false);
      }
    },
  );

  test('the scanner would catch each forbidden pattern', () => {
    const samples = [
      "import x from 'node:fs'",
      "import fs from 'fs'",
      "import p from 'path'",
      'process.env.X',
      'Buffer.from(a)',
      'Date.now()',
      'new Date()',
      'Math.random()',
      'console.log(1)',
      'setTimeout(f, 1)',
      'fetch(u)',
    ];
    for (const sample of samples) {
      expect(
        forbidden.some(([, pattern]) => pattern.test(sample)),
        sample,
      ).toBe(true);
    }
    expect(forbidden.some(([, pattern]) => pattern.test('new Date(ms)'))).toBe(false);
  });
});

describe('shared types are reused, never redefined', () => {
  const shared = ['Verdict', 'Venue', 'NormalisedSession', 'Commitment'];

  test('no rules source file declares a local type with a shared type name', () => {
    for (const file of sourceFiles) {
      const text = read(file);
      for (const name of shared) {
        const declaration = new RegExp(`\\b(?:interface|type|class|enum)\\s+${name}\\b`);
        expect(declaration.test(text), `${file} declares ${name}`).toBe(false);
      }
    }
  });

  test('each shared type that the engine uses is imported from @compass/contracts', () => {
    const imported = new Set<string>();
    for (const file of sourceFiles) {
      for (const match of read(file).matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@compass\/contracts'/g,
      )) {
        match[1].split(',').forEach((part) => imported.add(part.replace(/\btype\b/, '').trim()));
      }
    }
    for (const name of shared) {
      expect(imported.has(name), `${name} is imported from @compass/contracts`).toBe(true);
    }
  });
});

describe('test data policy', () => {
  test('no test under test/rules reads from the synthetic fixtures', () => {
    // Built from pieces so this guard does not contain the forbidden path itself.
    const forbiddenPath = ['fixtures', 'synthetic'].join('/');
    const testFiles = tsFilesUnder(rulesTests);
    expect(testFiles.length).toBeGreaterThan(10);
    for (const name of testFiles) {
      const text = read(name).replaceAll('\\', '/');
      expect(text.includes(forbiddenPath), `${name} mentions ${forbiddenPath}`).toBe(false);
    }
  });
});
