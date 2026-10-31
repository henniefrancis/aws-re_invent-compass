// A small, pure gitignore matcher (design, Component 1, "gitignore subset").
//
// No gitignore library is pinned in the workspace, so this implements the subset the
// scanner needs: comments, blank lines, trailing-space trimming, `\` escapes, negation,
// directory-only rules, anchoring (a `/` at the start or in the middle), `*`, `**`, `?`
// and `[...]` classes. The last matching rule decides. A path below an ignored
// directory stays ignored, because git cannot re-include a file whose parent is excluded.

/** One parsed rule. `base` is the directory the `.gitignore` lives in, relative to the scan root. */
export interface GitignoreRule {
  /** The pattern without a leading `!`, a leading `/` or a trailing `/`. */
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
  base: string;
}

/** What the rules say about one path on its own. */
export type RuleDecision = 'ignore' | 'include' | 'none';

/** The most rules read from one `.gitignore` file; later rules are not read. */
export const MAX_RULES_PER_FILE = 2000;
/** The longest rule read, in characters. A longer rule is dropped (it matches nothing). */
export const MAX_RULE_LENGTH = 256;
/** The most `*` characters, after runs are collapsed, that one rule may hold. */
export const MAX_STARS_PER_RULE = 8;
/** The most compiled patterns kept; the cache is emptied when it grows past this. */
export const MAX_REGEX_CACHE = 1000;

/** Collapses every run of unescaped `*` to one, because `**` and `*` match the same text in a segment. */
function collapseStars(pattern: string): string {
  return pattern.replace(/(?<!\\)\*{2,}/g, '*');
}

/** True when the rule is small enough to match safely. */
function withinLimits(pattern: string): boolean {
  return (
    pattern.length <= MAX_RULE_LENGTH &&
    collapseStars(pattern).split('*').length - 1 <= MAX_STARS_PER_RULE
  );
}

/**
 * Removes trailing spaces unless the first of them is escaped with `\`, as git does.
 * A loop, not a regular expression, so a long run of spaces costs linear time.
 */
function trimTrailingSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === ' ') {
    end -= 1;
  }
  if (end < line.length && end > 0 && line[end - 1] === '\\') {
    end += 1;
  }
  return line.slice(0, end);
}

/** Removes every trailing `/`, in linear time. */
function trimTrailingSlashes(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === '/') {
    end -= 1;
  }
  return line.slice(0, end);
}

/** Parses the text of one `.gitignore` file that lives in `base` (relative to the scan root). */
export function parseGitignore(text: string, base: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (rules.length >= MAX_RULES_PER_FILE) {
      break;
    }
    let line = trimTrailingSpaces(raw);
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }
    let directoryOnly = false;
    if (line.endsWith('/')) {
      directoryOnly = true;
      line = trimTrailingSlashes(line);
    }
    const anchored = line.includes('/');
    line = line.replace(/^\/+/, '');
    if (line === '' || !withinLimits(line)) {
      continue;
    }
    rules.push({ pattern: line, negated, directoryOnly, anchored, base });
  }
  return rules;
}

const regexCache = new Map<string, RegExp>();
const NEVER_MATCHES = /$^/;

function escapeRegExp(char: string): string {
  return char.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
}

function classToRegExp(inner: string): string {
  let negate = false;
  let body = inner;
  if (body.startsWith('!') || body.startsWith('^')) {
    negate = true;
    body = body.slice(1);
  }
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body.charAt(i);
    if (char === '\\') {
      i += 1;
      out += escapeRegExp(body.charAt(i));
    } else if (char === '-' || char === ']' || char === '[' || char === '^') {
      out += char === '-' ? '-' : `\\${char}`;
    } else {
      out += escapeRegExp(char);
    }
  }
  return `[${negate ? '^' : ''}${out}]`;
}

function globToRegExp(glob: string): RegExp {
  const cached = regexCache.get(glob);
  if (cached !== undefined) {
    return cached;
  }
  let source = '^';
  let i = 0;
  while (i < glob.length) {
    const char = glob.charAt(i);
    if (char === '\\') {
      source += escapeRegExp(glob.charAt(i + 1) === '' ? '\\' : glob.charAt(i + 1));
      i += 2;
    } else if (char === '*') {
      while (glob.charAt(i + 1) === '*') {
        i += 1;
      }
      source += '[^/]*';
      i += 1;
    } else if (char === '?') {
      source += '[^/]';
      i += 1;
    } else if (char === '[') {
      let end = i + 1;
      if (glob.charAt(end) === '!' || glob.charAt(end) === '^') {
        end += 1;
      }
      if (glob.charAt(end) === ']') {
        end += 1;
      }
      while (end < glob.length && glob.charAt(end) !== ']') {
        end += glob.charAt(end) === '\\' ? 2 : 1;
      }
      if (end >= glob.length) {
        source += escapeRegExp('[');
        i += 1;
      } else {
        source += classToRegExp(glob.slice(i + 1, end));
        i = end + 1;
      }
    } else {
      source += escapeRegExp(char);
      i += 1;
    }
  }
  source += '$';
  let compiled: RegExp;
  try {
    compiled = new RegExp(source);
  } catch {
    compiled = NEVER_MATCHES;
  }
  if (regexCache.size >= MAX_REGEX_CACHE) {
    regexCache.clear();
  }
  regexCache.set(glob, compiled);
  return compiled;
}

function matchSegments(
  patterns: readonly string[],
  segments: readonly string[],
  pi: number,
  si: number,
): boolean {
  const current = patterns[pi];
  if (current === undefined) {
    return si === segments.length;
  }
  if (current === '**') {
    if (pi === patterns.length - 1) {
      return si < segments.length;
    }
    for (let k = si; k <= segments.length; k += 1) {
      if (matchSegments(patterns, segments, pi + 1, k)) {
        return true;
      }
    }
    return false;
  }
  const segment = segments[si];
  return (
    segment !== undefined &&
    globToRegExp(current).test(segment) &&
    matchSegments(patterns, segments, pi + 1, si + 1)
  );
}

function ruleMatches(rule: GitignoreRule, relativePath: string, isDirectory: boolean): boolean {
  if (rule.directoryOnly && !isDirectory) {
    return false;
  }
  let local = relativePath;
  if (rule.base !== '') {
    if (!relativePath.startsWith(`${rule.base}/`)) {
      return false;
    }
    local = relativePath.slice(rule.base.length + 1);
  }
  if (!rule.anchored) {
    return globToRegExp(rule.pattern).test(local.slice(local.lastIndexOf('/') + 1));
  }
  return matchSegments(rule.pattern.split('/'), local.split('/'), 0, 0);
}

/** The decision of the last rule that matches this path on its own (ancestors not considered). */
export function lastMatchingDecision(
  relativePath: string,
  isDirectory: boolean,
  rules: readonly GitignoreRule[],
): RuleDecision {
  let decision: RuleDecision = 'none';
  for (const rule of rules) {
    if (ruleMatches(rule, relativePath, isDirectory)) {
      decision = rule.negated ? 'include' : 'ignore';
    }
  }
  return decision;
}

/**
 * True when the path is ignored: the last matching rule for the path, or for any of its
 * parent directories, says ignore. `relativePath` uses `/` and is relative to the scan root.
 */
export function isIgnored(
  relativePath: string,
  isDirectory: boolean,
  rules: readonly GitignoreRule[],
): boolean {
  const segments = relativePath.split('/').filter((segment) => segment !== '');
  for (let i = 1; i <= segments.length; i += 1) {
    const prefix = segments.slice(0, i).join('/');
    const directory = i < segments.length ? true : isDirectory;
    if (lastMatchingDecision(prefix, directory, rules) === 'ignore') {
      return true;
    }
  }
  return false;
}
