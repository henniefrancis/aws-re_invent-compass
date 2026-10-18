// The boto3 detector (Requirements 2.4 and 2.6; QA M7).
//
// Counted, one `boto3Clients` each, for the service named in the call:
//   - `boto3.client('x')` and `boto3.resource('x')`,
//   - the same call on a name assigned from `boto3.Session(...)` or `boto3.session.Session(...)`,
//   - a call chained straight onto a session: `boto3.Session(...).client('x')`,
//   - `client('x')` and `resource('x')` when the file did `from boto3 import client` (or `resource`,
//     with or without `as`), and `Session(...)` from `from boto3 import Session`,
//   - the same calls through `import boto3 as b3`.
// The service name is the first argument, a quoted string (single or double quotes) or
// `service_name='...'`; a call whose name is not a plain literal is counted with an empty
// identifier, so it adds to the unmapped total and to no service.
//
// Comments (`#` to the end of the line) and triple-quoted strings (docstrings and long strings)
// are blanked out first, and a call that sits inside an ordinary string (for example a printed
// example) is not counted. Imports of `boto3` are not evidence of use; the manifest detector counts
// the dependency.

import { addHit } from './text.js';
import type { Detector, DetectorHit } from './types.js';

/** How far a session constructor's argument list may run before the scan gives up. */
const MAX_ARGUMENTS = 400;

const LITERAL = /^\s*(?:service_name\s*=\s*)?(?:'([a-z0-9-]+)'|"([a-z0-9-]+)")/;
const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*';

/** The text with comments and triple-quoted strings blanked, and a mask of ordinary string bytes. */
export interface Masked {
  code: string;
  /** True for each character inside an ordinary (single-line) string, quotes included. */
  inString: boolean[];
}

/**
 * Blanks `#` comments and triple-quoted strings (keeping every newline, so positions do not move)
 * and marks the characters of ordinary strings. One linear pass over the text.
 */
export function maskPython(text: string): Masked {
  const out: string[] = [];
  const inString: boolean[] = [];
  const put = (char: string, string: boolean): void => {
    out.push(char);
    inString.push(string);
  };
  const blank = (char: string): string => (char === '\n' || char === '\r' ? char : ' ');
  let i = 0;
  while (i < text.length) {
    const char = text.charAt(i);
    const triple = text.slice(i, i + 3);
    if (char === '#') {
      while (i < text.length && text.charAt(i) !== '\n') {
        put(blank(text.charAt(i)), false);
        i += 1;
      }
    } else if (triple === "'''" || triple === '"""') {
      const end = text.indexOf(triple, i + 3);
      const stop = end === -1 ? text.length : end + 3;
      for (; i < stop; i += 1) {
        put(blank(text.charAt(i)), false);
      }
    } else if (char === "'" || char === '"') {
      put(char, true);
      i += 1;
      while (i < text.length && text.charAt(i) !== char && text.charAt(i) !== '\n') {
        if (text.charAt(i) === '\\' && i + 1 < text.length) {
          put(text.charAt(i), true);
          i += 1;
        }
        put(text.charAt(i), true);
        i += 1;
      }
      if (text.charAt(i) === char) {
        put(char, true);
        i += 1;
      }
    } else {
      put(char, false);
      i += 1;
    }
  }
  return { code: out.join(''), inString };
}

/** The index just after the `)` that closes the `(` at `open`, or -1 when it does not close nearby. */
function closeOf(code: string, open: number): number {
  let depth = 0;
  const limit = Math.min(code.length, open + MAX_ARGUMENTS);
  for (let i = open; i < limit; i += 1) {
    const char = code.charAt(i);
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return -1;
}

interface Imports {
  /** Names that mean the boto3 module (`boto3` and any `import boto3 as x`). */
  modules: Set<string>;
  /** Bare names for `client`, `resource` and `Session` from `from boto3 import ...`. */
  clients: Set<string>;
  resources: Set<string>;
  sessions: Set<string>;
}

function readImports(code: string): Imports {
  const found: Imports = {
    modules: new Set(['boto3']),
    clients: new Set(),
    resources: new Set(),
    sessions: new Set(),
  };
  for (const match of code.matchAll(
    new RegExp(String.raw`^[ \t]*import[ \t]+boto3[ \t]+as[ \t]+(${IDENTIFIER})`, 'gm'),
  )) {
    found.modules.add(String(match[1]));
  }
  for (const match of code.matchAll(
    /^[ \t]*from[ \t]+boto3(?:\.session)?[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm,
  )) {
    for (const part of String(match[1]).replace(/[()]/g, ' ').split(',')) {
      const words = part.trim().split(/\s+/);
      const [name, keyword, alias] = words;
      const local = keyword === 'as' && alias !== undefined ? alias : name;
      if (name === 'client' && local !== undefined) found.clients.add(local);
      if (name === 'resource' && local !== undefined) found.resources.add(local);
      if (name === 'Session' && local !== undefined) found.sessions.add(local);
    }
  }
  return found;
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const alternation = (names: Iterable<string>): string => [...names].map(escape).join('|');

export const boto3Detector: Detector = {
  id: 'boto3',
  accepts: (fileName) => fileName.endsWith('.py'),
  detect: (text) => {
    const { code, inString } = maskPython(text);
    const hits: DetectorHit[] = [];
    const count = (afterParen: number): void => {
      const literal = LITERAL.exec(code.slice(afterParen, afterParen + 200));
      addHit(hits, {
        identifierKind: 'boto3Name',
        identifier: literal?.[1] ?? literal?.[2] ?? '',
        kind: 'boto3Clients',
        count: 1,
      });
    };
    const imports = readImports(code);

    // Session constructors: `boto3.Session(`, `boto3.session.Session(` and an imported `Session(`.
    const owners = new Set(imports.modules);
    const constructors = [
      ...[...imports.modules].map(
        (m) => String.raw`${escape(m)}\s*\.\s*(?:session\s*\.\s*)?Session`,
      ),
      ...[...imports.sessions].map((s) => String.raw`(?<![A-Za-z0-9_.])${escape(s)}`),
    ];
    const session = new RegExp(
      String.raw`(?<![A-Za-z0-9_.])(?:${constructors.join('|')})\s*\(`,
      'g',
    );
    for (const match of code.matchAll(session)) {
      const open = match.index + match[0].length - 1;
      if (inString[match.index] === true) {
        continue;
      }
      const end = closeOf(code, open);
      const chained =
        end === -1 ? null : /^\s*\.\s*(?:client|resource)\s*\(/.exec(code.slice(end, end + 40));
      if (chained !== null) {
        count(end + chained[0].length);
      } else {
        const before = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*$/.exec(
          code.slice(Math.max(0, match.index - 80), match.index),
        );
        if (before !== null) {
          owners.add(String(before[1]));
        }
      }
    }

    // `x.client('s3')` and `x.resource('s3')` on boto3 itself or on a session variable.
    const method = new RegExp(
      String.raw`(?<![A-Za-z0-9_.])(?:${alternation(owners)})\s*\.\s*(?:client|resource)\s*\(`,
      'g',
    );
    for (const match of code.matchAll(method)) {
      if (inString[match.index] !== true) {
        count(match.index + match[0].length);
      }
    }

    // A bare `client('s3')` or `resource('s3')` imported from boto3.
    const bare = [...imports.clients, ...imports.resources];
    if (bare.length > 0) {
      const call = new RegExp(String.raw`(?<![A-Za-z0-9_.])(?:${alternation(bare)})\s*\(`, 'g');
      for (const match of code.matchAll(call)) {
        if (
          inString[match.index] !== true &&
          !/\b(?:def|class|import)\s+$/.test(code.slice(Math.max(0, match.index - 8), match.index))
        ) {
          count(match.index + match[0].length);
        }
      }
    }
    return hits;
  },
};
