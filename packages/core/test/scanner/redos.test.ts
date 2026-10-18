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
