import { describe, expect, test } from 'vitest';
import { parseImports } from '../../src/scanner/detectors/imports.js';
import { isIgnored, parseGitignore } from '../../src/scanner/gitignore.js';

const time = (run: () => void): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe('pathological input finishes quickly', () => {
  test('1 MiB of `import {` and spaces is parsed in under 1 second', () => {
    const text = `import {${' '.repeat(1024 * 1024)}`;
    expect(time(() => parseImports(text))).toBeLessThan(1000);
    const many = 'import { '.repeat(120_000);
    expect(time(() => parseImports(many))).toBeLessThan(1000);
    const tail = `import {${'\t '.repeat(500_000)}from`;
    expect(time(() => parseImports(tail))).toBeLessThan(1000);
  });

  test('a star-heavy rule against long names is matched in under 1 second', () => {
    const rules = parseGitignore(`${'*a'.repeat(40)}*b\n${'*'.repeat(500)}x\n`, '');
    const name = 'a'.repeat(5000);
    expect(time(() => isIgnored(`dir/${name}`, false, rules))).toBeLessThan(1000);
    expect(time(() => isIgnored(name, false, rules))).toBeLessThan(1000);
  });

  test('long runs of trailing slashes or spaces are trimmed in under 1 second (CodeQL alert 1)', () => {
    const run = 100_000;
    expect(time(() => parseGitignore(`${'/'.repeat(run)}x/`, ''))).toBeLessThan(1000);
    expect(time(() => parseGitignore(`a${' '.repeat(run)}x `, ''))).toBeLessThan(1000);
    expect(parseGitignore(`dir${'/'.repeat(run)}`, '')).toEqual([
      { pattern: 'dir', negated: false, directoryOnly: true, anchored: false, base: '' },
    ]);
    expect(parseGitignore(`a\\${' '.repeat(run)}`, '').map((r) => r.pattern)).toEqual(['a\\ ']);
  });
});

import {
  MAX_REGEX_CACHE,
  MAX_RULE_LENGTH,
  MAX_RULES_PER_FILE,
  MAX_STARS_PER_RULE,
} from '../../src/scanner/gitignore.js';

describe('gitignore caps', () => {
  test('a rule with too many stars or too many characters is dropped, and runs of stars count once', () => {
    const ok = `${'a*'.repeat(MAX_STARS_PER_RULE)}`;
    const tooManyStars = `${'a*'.repeat(MAX_STARS_PER_RULE + 1)}`;
    const tooLong = 'a'.repeat(MAX_RULE_LENGTH + 1);
    const rules = parseGitignore([ok, tooManyStars, tooLong, 'x/**/y', 'k*****z'].join('\n'), '');
    expect(rules.map((r) => r.pattern)).toEqual([ok, 'x/**/y', 'k*****z']);
    expect(parseGitignore('a'.repeat(MAX_RULE_LENGTH), '')).toHaveLength(1);
  });

  test('an escaped star next to a wildcard is not collapsed', () => {
    const rules = parseGitignore(String.raw`a\**b`, '');
    expect(isIgnored('a*xb', false, rules)).toBe(true);
    expect(isIgnored('axb', false, rules)).toBe(false);
  });

  test('at most MAX_RULES_PER_FILE rules are read', () => {
    const text = Array.from({ length: MAX_RULES_PER_FILE + 50 }, (_, i) => `r${i}`).join('\n');
    expect(parseGitignore(text, '')).toHaveLength(MAX_RULES_PER_FILE);
  });

  test('the pattern cache is emptied when full and matching stays correct', () => {
    const rules = parseGitignore(
      Array.from({ length: MAX_REGEX_CACHE + 20 }, (_, i) => `*.e${i}`).join('\n'),
      '',
    );
    for (let round = 0; round < 2; round += 1) {
      expect(isIgnored('file.e3', false, rules)).toBe(true);
      expect(isIgnored(`file.e${MAX_REGEX_CACHE + 5}`, false, rules)).toBe(true);
      expect(isIgnored('file.other', false, rules)).toBe(false);
    }
  });
});

import { DEFAULT_WALK_LIMITS, walk } from '../../src/scanner/walker.js';
import { MemoryScanFs } from '../support/memory-scan-fs.js';
import { drain } from '../support/drain.js';

describe('walk budgets (security review M6)', () => {
  const files = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.tf`, 'x']));

  test('the default budgets are finite', () => {
    expect(DEFAULT_WALK_LIMITS.maxEntries).toBe(200_000);
    expect(DEFAULT_WALK_LIMITS.maxDepth).toBe(40);
    expect(DEFAULT_WALK_LIMITS.maxMillis).toBe(15_000);
  });

  test('too many entries truncates the scan', async () => {
    const fs = new MemoryScanFs(files);
    const { summary } = await drain(walk(fs.root, fs, { ...DEFAULT_WALK_LIMITS, maxEntries: 3 }));
    expect(summary.truncated).toBe(true);
    expect(summary.filesRead).toBeLessThanOrEqual(3);
  });

  test('a tree deeper than the limit is not descended into and truncates the scan', async () => {
    const fs = new MemoryScanFs({ 'a/b/c/d/e.tf': 'x', 'top.tf': 'y' });
    const { files: read, summary } = await drain(
      walk(fs.root, fs, { ...DEFAULT_WALK_LIMITS, maxDepth: 1 }),
    );
    expect(summary.truncated).toBe(true);
    expect(read.map((f) => f.relativePath)).not.toContain('a/b/c/d/e.tf');
    const deep = await drain(walk(fs.root, fs, { ...DEFAULT_WALK_LIMITS, maxDepth: 4 }));
    expect(deep.summary.truncated).toBe(false);
    expect(deep.files).toHaveLength(2);
  });

  test('a spent time budget truncates the scan, using the injected clock', async () => {
    const fs = new MemoryScanFs(files);
    let tick = 0;
    const now = (): number => {
      tick += 100;
      return tick;
    };
    const { summary } = await drain(
      walk(fs.root, fs, { ...DEFAULT_WALK_LIMITS, maxMillis: 250 }, now),
    );
    expect(summary.truncated).toBe(true);
  });
});

import { dotnetDetector, maskCSharp } from '../../src/scanner/detectors/dotnet.js';
import { DEFAULT_TECH_DETECTORS } from '../../src/scanner/scan-repo.js';
import {
  elementTexts,
  packageReferences,
  stripXmlComments,
} from '../../src/scanner/detectors/xml.js';

describe('hostile manifests and C# finish quickly (task 41)', () => {
  const MIB = 1024 * 1024;

  /** Runs every default Tech_Detector that accepts `fileName` over `text`. */
  const techScan = (text: string, fileName: string) => (): void => {
    for (const detector of DEFAULT_TECH_DETECTORS) {
      if (detector.accepts(fileName)) {
        detector.detect(text, fileName);
      }
    }
  };

  test('C# masking and client matching stay linear', () => {
    const inputs = [
      'new '.repeat(MIB / 4),
      `new Amazon${'x'.repeat(MIB)}`,
      `new Amazon.${'A'.repeat(MIB)}`,
      `new${' '.repeat(MIB)}`,
      '"'.repeat(MIB),
      '@"'.repeat(MIB / 2),
      '/*'.repeat(MIB / 2),
      '\\'.repeat(MIB),
      `"${'\\"'.repeat(MIB / 2)}`,
      "'".repeat(MIB),
      `${'"""'.repeat(MIB / 3)}`,
      'new AmazonS3Client'.repeat(MIB / 18),
    ];
    for (const text of inputs) {
      expect(time(() => dotnetDetector.detect(text, 'Program.cs'))).toBeLessThan(1000);
      expect(maskCSharp(text)).toHaveLength(text.length);
    }
  });

  test('XML readers stay linear', () => {
    const inputs = [
      '<PackageReference '.repeat(MIB / 18),
      '<PackageReference Include="'.repeat(MIB / 27),
      `<PackageReference Include="${'a'.repeat(MIB)}`,
      '<!--'.repeat(MIB / 4),
      '<artifactId>'.repeat(MIB / 12),
      `<artifactId>${'a'.repeat(MIB)}`,
    ];
    for (const text of inputs) {
      expect(time(() => packageReferences(text))).toBeLessThan(1000);
      expect(time(() => elementTexts(text, 'artifactId'))).toBeLessThan(1000);
      expect(time(() => stripXmlComments(text))).toBeLessThan(1000);
      expect(time(() => dotnetDetector.detect(`<Project>${text}`, 'App.csproj'))).toBeLessThan(
        1000,
      );
      expect(time(techScan(`<Project><project>${text}`, 'App.csproj'))).toBeLessThan(1000);
      expect(time(techScan(`<project>${text}`, 'pom.xml'))).toBeLessThan(1000);
    }
  });

  test('text manifests stay linear', () => {
    const cases: [string, string][] = [
      [`[${' '.repeat(MIB)}`, 'pyproject.toml'],
      [`[[${'['.repeat(MIB)}`, 'Pipfile'],
      [`dependencies = [${'"'.repeat(MIB)}`, 'pyproject.toml'],
      [`dependencies = [\n${`"${'a'.repeat(64)}\n`.repeat(MIB / 66)}`, 'pyproject.toml'],
      [`dependencies = [${`"a",'b'`.repeat(MIB / 8)}`, 'pyproject.toml'],
      [`[tool.poetry.dependencies]\n${'a'.repeat(MIB)}`, 'pyproject.toml'],
      [`[packages]\n${`a${' '.repeat(64)}\n`.repeat(MIB / 66)}`, 'Pipfile'],
      [`a${' '.repeat(MIB)}`, 'requirements.txt'],
      ['a'.repeat(MIB), 'requirements.txt'],
      [`gem${' '.repeat(MIB)}`, 'Gemfile'],
      [`gem${'('.repeat(MIB)}`, 'Gemfile'],
      [`"${'a'.repeat(MIB)}`, 'build.gradle'],
      [`"a:${'b'.repeat(MIB)}`, 'build.gradle'],
      [`"a:b:${'c'.repeat(MIB)}`, 'build.gradle'],
      [`'a:`.repeat(MIB / 3), 'build.gradle.kts'],
      [`"a:b:'`.repeat(MIB / 6), 'build.gradle'],
      [`{"dependencies":{${'"a":"1",'.repeat(MIB / 10)}"z":"1"}}`, 'package.json'],
      ['{'.repeat(MIB), 'composer.json'],
    ];
    for (const [text, fileName] of cases) {
      expect(time(techScan(text, fileName))).toBeLessThan(1000);
    }
  });
});
