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

const IMPORT = /\bimport\s+(?:type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g;

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

/** Parses every import statement in already comment-stripped text. */
export function parseImports(text: string): ImportStatement[] {
  const statements: ImportStatement[] = [];
  for (const match of text.matchAll(IMPORT)) {
    const clause = grp(match, 1);
    const statement: ImportStatement = { specifier: grp(match, 2), named: [] };
    const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespace !== null) {
      statement.namespace = grp(namespace, 1);
    }
    const open = clause.indexOf('{');
    const close = clause.indexOf('}', open);
    if (open !== -1 && close !== -1) {
      statement.named = parseNamed(clause.slice(open + 1, close));
    }
    statements.push(statement);
  }
  return statements;
}
