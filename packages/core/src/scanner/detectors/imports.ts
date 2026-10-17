// A tiny ES import parser shared by the CDK and SDK detectors. It reads statements of
// the form `import <clause> from '<module>'` and understands default, namespace and
// named bindings (with `as` aliases and `type` modifiers).

import { grp } from './text.js';

/** One named binding: `imported as local`. */
export interface NamedBinding {
  imported: string;
  local: string;
}

/** One parsed import statement. */
export interface ImportStatement {
  specifier: string;
  namespace?: string;
  named: NamedBinding[];
}

const NAMED = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/;

function parseNamed(inner: string): NamedBinding[] {
  const bindings: NamedBinding[] = [];
  for (const part of inner.split(',')) {
    const match = NAMED.exec(part.trim().replace(/^type\s+/, ''));
    if (match !== null) {
      const imported = grp(match, 1);
      bindings.push({ imported, local: match[2] ?? imported });
    }
  }
  return bindings;
}

/** The longest import clause read. A real clause is far shorter; this bounds every scan. */
const MAX_CLAUSE = 300;
const MAX_SPECIFIER = 300;
/** Characters that end an import clause: a statement end or the opening quote of the module. */
const CLAUSE_END = [';', "'", '"'];

const isSpace = (char: string): boolean => char !== '' && char.trim() === '';
const isWordChar = (char: string): boolean => /[\w$]/.test(char);

/**
 * Parses every import statement in already comment-stripped text. This is a linear scanner (one
 * pass, each candidate reads at most MAX_CLAUSE characters), not a backtracking pattern, so a
 * megabyte of `import {` followed by spaces cannot make it slow.
 */
export function parseImports(text: string): ImportStatement[] {
  const statements: ImportStatement[] = [];
  let at = text.indexOf('import');
  while (at !== -1) {
    const next = tryParse(text, at);
    if (next === undefined) {
      at = text.indexOf('import', at + 6);
    } else {
      statements.push(next.statement);
      at = text.indexOf('import', next.end);
    }
  }
  return statements;
}

function tryParse(
  text: string,
  at: number,
): { statement: ImportStatement; end: number } | undefined {
  if ((at > 0 && isWordChar(text.charAt(at - 1))) || !isSpace(text.charAt(at + 6))) {
    return undefined;
  }
  let start = at + 7;
  while (isSpace(text.charAt(start)) && start - at < MAX_CLAUSE) {
    start += 1;
  }
  // A clause cannot hold another `import` keyword, so the window ends there. Each candidate then
  // reads only up to the next one, which keeps the whole scan linear.
  const nextImport = text.indexOf('import', start);
  const hardEnd = Math.min(start + MAX_CLAUSE, nextImport === -1 ? text.length : nextImport);
  let stop = start;
  while (stop < hardEnd && !CLAUSE_END.includes(text.charAt(stop))) {
    stop += 1;
  }
  const quote = text.charAt(stop);
  if (quote !== "'" && quote !== '"') {
    return undefined;
  }
  const window = text.slice(start, stop).trimEnd();
  if (!window.endsWith('from')) {
    return undefined;
  }
  let clause = window.slice(0, -4).trimEnd();
  if (/^type\s/.test(clause)) {
    clause = clause.slice(4).trimStart();
  }
  const close = text.indexOf(quote, stop + 1);
  if (close === -1 || close === stop + 1 || close - stop > MAX_SPECIFIER) {
    return undefined;
  }
  const statement: ImportStatement = { specifier: text.slice(stop + 1, close), named: [] };
  const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
  if (namespace !== null) {
    statement.namespace = grp(namespace, 1);
  }
  const open = clause.indexOf('{');
  const end = clause.indexOf('}', open);
  if (open !== -1 && end !== -1) {
    statement.named = parseNamed(clause.slice(open + 1, end));
  }
  return { statement, end: close + 1 };
}
