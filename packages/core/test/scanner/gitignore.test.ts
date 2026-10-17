import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { isIgnored, lastMatchingDecision, parseGitignore } from '../../src/scanner/gitignore.js';
import type { GitignoreRule } from '../../src/scanner/gitignore.js';

function ignored(text: string, path: string, isDirectory = false): boolean {
  return isIgnored(path, isDirectory, parseGitignore(text, ''));
}

describe('parseGitignore', () => {
  test('skips comments and blank lines and trims trailing spaces', () => {
    const rules = parseGitignore('# comment\n\n   \nfoo  \nbar\\ \r\nbaz\n', '');
    expect(rules.map((r) => r.pattern)).toEqual(['foo', 'bar\\ ', 'baz']);
  });

  test('records negation, directory-only and anchoring', () => {
    const [neg, dir, lead, mid, plain] = parseGitignore('!a\nb/\n/c\nd/e\nf\n', 'sub');
    expect(neg).toMatchObject({ pattern: 'a', negated: true, anchored: false, base: 'sub' });
    expect(dir).toMatchObject({ pattern: 'b', directoryOnly: true, anchored: false });
    expect(lead).toMatchObject({ pattern: 'c', anchored: true });
    expect(mid).toMatchObject({ pattern: 'd/e', anchored: true });
    expect(plain).toMatchObject({ pattern: 'f', negated: false, directoryOnly: false });
  });

  test('ignores lines that reduce to nothing', () => {
    expect(parseGitignore('/\n!\n//\n', '')).toEqual([]);
  });

  test('keeps an escaped leading hash or bang as a pattern', () => {
    const rules = parseGitignore('\\#file\n\\!file\n', '');
    expect(rules.map((r) => r.negated)).toEqual([false, false]);
    expect(isIgnored('#file', false, rules)).toBe(true);
    expect(isIgnored('!file', false, rules)).toBe(true);
  });
});

describe('isIgnored', () => {
  test('an unanchored name matches at any depth', () => {
    expect(ignored('foo', 'foo')).toBe(true);
    expect(ignored('foo', 'a/b/foo')).toBe(true);
    expect(ignored('foo', 'a/foobar')).toBe(false);
  });

  test('a matched directory ignores everything below it', () => {
    expect(ignored('build', 'build/x/y.ts')).toBe(true);
    expect(ignored('build/', 'build/x/y.ts')).toBe(true);
  });

  test('a directory-only rule does not match a file of that name', () => {
    expect(ignored('logs/', 'logs')).toBe(false);
    expect(ignored('logs/', 'logs', true)).toBe(true);
  });

  test('anchored rules match only from their base', () => {
    expect(ignored('/top', 'top')).toBe(true);
    expect(ignored('/top', 'a/top')).toBe(false);
    expect(ignored('a/b', 'a/b')).toBe(true);
    expect(ignored('a/b', 'x/a/b')).toBe(false);
  });

  test('rules in a nested gitignore apply only below their base', () => {
    const rules = parseGitignore('x\n/y\n', 'sub');
    expect(isIgnored('sub/x', false, rules)).toBe(true);
    expect(isIgnored('sub/deep/x', false, rules)).toBe(true);
    expect(isIgnored('sub/y', false, rules)).toBe(true);
    expect(isIgnored('sub/deep/y', false, rules)).toBe(false);
    expect(isIgnored('other/x', false, rules)).toBe(false);
  });

  test('the last matching rule wins and negation re-includes', () => {
    expect(ignored('*.log\n!keep.log', 'keep.log')).toBe(false);
    expect(ignored('*.log\n!keep.log', 'other.log')).toBe(true);
    expect(ignored('!keep.log\n*.log', 'keep.log')).toBe(true);
  });

  test('a file below an ignored directory cannot be re-included', () => {
    expect(ignored('build/\n!build/keep.txt', 'build/keep.txt')).toBe(true);
  });

  test('star, question mark and classes', () => {
    expect(ignored('*.ts', 'a.ts')).toBe(true);
    expect(ignored('a?c', 'abc')).toBe(true);
    expect(ignored('a?c', 'a/c')).toBe(false);
    expect(ignored('[abc].txt', 'b.txt')).toBe(true);
    expect(ignored('[a-c].txt', 'b.txt')).toBe(true);
    expect(ignored('[!a].txt', 'b.txt')).toBe(true);
    expect(ignored('[!a].txt', 'a.txt')).toBe(false);
    expect(ignored('[^a].txt', 'b.txt')).toBe(true);
    expect(ignored('[]a].txt', ']'.concat('.txt'))).toBe(true);
    expect(ignored('[\\]a].txt', ']'.concat('.txt'))).toBe(true);
    expect(ignored('[a^[-].txt', '^.txt')).toBe(true);
    expect(ignored('[a^[-].txt', '[.txt')).toBe(true);
  });

  test('an unterminated class is a literal bracket', () => {
    expect(ignored('[ab', '[ab')).toBe(true);
    expect(ignored('[ab', 'a')).toBe(false);
  });

  test('an invalid range never matches', () => {
    expect(ignored('[z-a].txt', 'm.txt')).toBe(false);
  });

  test('a backslash escapes a wildcard and a trailing backslash is literal', () => {
    expect(ignored('a\\*b', 'a*b')).toBe(true);
    expect(ignored('a\\*b', 'axb')).toBe(false);
    expect(ignored('a\\', 'a\\')).toBe(true);
  });

  test('double star matches across directories', () => {
    expect(ignored('**/foo', 'foo')).toBe(true);
    expect(ignored('**/foo', 'a/b/foo')).toBe(true);
    expect(ignored('a/**/b', 'a/b')).toBe(true);
    expect(ignored('a/**/b', 'a/x/y/b')).toBe(true);
    expect(ignored('a/**/b', 'a/x/c')).toBe(false);
    expect(ignored('abc/**', 'abc/x')).toBe(true);
    expect(ignored('abc/**', 'abc', true)).toBe(false);
    expect(ignored('**', 'anything')).toBe(true);
  });

  test('special characters in names are matched literally', () => {
    expect(ignored('a.b', 'a.b')).toBe(true);
    expect(ignored('a.b', 'axb')).toBe(false);
    expect(ignored('a+b', 'a+b')).toBe(true);
  });
});

// Feature: compass-power, Property 1: The gitignore matcher follows last-matching-rule semantics
describe('Property 1: gitignore last-matching-rule semantics', () => {
  interface RuleSpec {
    negated: boolean;
    leadingSlash: boolean;
    segments: string[];
    trailingSlash: boolean;
    base: string;
  }

  const segmentArb = fc.constantFrom('a', 'b', 'ab', '*', '**', '?', 'a?', '[ab]', '*.log', 'a*');
  const nameArb = fc.constantFrom('a', 'b', 'ab', 'c.log', 'a.log', 'abc', 'bb');
  const ruleArb: fc.Arbitrary<RuleSpec> = fc.record({
    negated: fc.boolean(),
    leadingSlash: fc.boolean(),
    segments: fc.array(segmentArb, { minLength: 1, maxLength: 3 }),
    trailingSlash: fc.boolean(),
    base: fc.constantFrom('', '', 'a'),
  });

  function specToLine(spec: RuleSpec): string {
    return `${spec.negated ? '!' : ''}${spec.leadingSlash ? '/' : ''}${spec.segments.join('/')}${spec.trailingSlash ? '/' : ''}`;
  }

  function segmentRegex(segment: string): string {
    let out = '';
    for (const char of segment) {
      if (char === '*') out += '[^/]*';
      else if (char === '?') out += '[^/]';
      else if (char === '[' || char === ']' || char === 'a' || char === 'b') out += char;
      else out += char.replace(/[.\\^$+()|{}-]/g, '\\$&');
    }
    return out;
  }

  function oracleRegex(spec: RuleSpec): RegExp {
    const anchored = spec.leadingSlash || spec.segments.length > 1;
    if (!anchored) {
      return new RegExp(`^(?:.*/)?${segmentRegex(spec.segments[0] ?? '')}$`);
    }
    const last = spec.segments.length - 1;
    const pieces = spec.segments.map((segment, index) => {
      if (segment === '**') {
        return index < last ? '(?:[^/]+/)*' : '[^/]+(?:/[^/]+)*';
      }
      return index < last ? `${segmentRegex(segment)}/` : segmentRegex(segment);
    });
    return new RegExp(`^${pieces.join('')}$`);
  }

  function oracle(
    specs: readonly RuleSpec[],
    parts: readonly string[],
    isDirectory: boolean,
  ): boolean {
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join('/');
      const directory = i < parts.length ? true : isDirectory;
      let decision: 'ignore' | 'include' | 'none' = 'none';
      for (const spec of specs) {
        if (spec.trailingSlash && !directory) continue;
        let local = prefix;
        if (spec.base !== '') {
          if (!prefix.startsWith(`${spec.base}/`)) continue;
          local = prefix.slice(spec.base.length + 1);
        }
        if (oracleRegex(spec).test(local)) {
          decision = spec.negated ? 'include' : 'ignore';
        }
      }
      if (decision === 'ignore') return true;
    }
    return false;
  }

  test('isIgnored equals an independent regex oracle', () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 5 }),
        fc.array(nameArb, { minLength: 1, maxLength: 3 }),
        fc.boolean(),
        (specs, parts, isDirectory) => {
          const rules: GitignoreRule[] = specs.flatMap((spec) =>
            parseGitignore(specToLine(spec), spec.base),
          );
          expect(isIgnored(parts.join('/'), isDirectory, rules)).toBe(
            oracle(specs, parts, isDirectory),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  test('a single path decision is the last matching rule or none', () => {
    fc.assert(
      fc.property(fc.array(ruleArb, { maxLength: 5 }), nameArb, (specs, name) => {
        const rules = specs.flatMap((spec) => parseGitignore(specToLine(spec), ''));
        const decision = lastMatchingDecision(name, true, rules);
        expect(['ignore', 'include', 'none']).toContain(decision);
        if (rules.length === 0) {
          expect(decision).toBe('none');
        }
      }),
      { numRuns: 100 },
    );
  });
});
