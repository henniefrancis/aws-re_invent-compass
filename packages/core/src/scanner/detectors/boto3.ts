// The boto3 detector (Requirements 2.4 and 2.6).
//
// Counted: each `boto3.client(` and `boto3.resource(` call, and the same call on a name that was
// assigned from `boto3.Session(` or `boto3.session.Session(`, as one `boto3Clients` for the
// service named in the call. The service name is the first argument, a quoted string (single or
// double quotes) or `service_name='...'`; a call whose name is not a literal is counted with an
// empty identifier, so it adds to the unmapped total and to no service. Comments (`#` to the end
// of the line, outside quotes) are removed first. Imports of `boto3` are not evidence of use and
// are left to the manifest detector's dependency count.

import { addHit } from './text.js';
import type { Detector, DetectorHit } from './types.js';

const SESSION_ASSIGNMENT =
  /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*boto3\s*\.\s*(?:session\s*\.\s*)?Session\s*\(/g;
const LITERAL = /^\s*(?:service_name\s*=\s*)?(?:'([a-z0-9-]+)'|"([a-z0-9-]+)")/;

/** Removes a `#` comment from one line, leaving a `#` inside a quoted string alone. */
export function stripPythonComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quote !== undefined) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = undefined;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern for a client or resource call on any of the owner names. */
function callPattern(owners: readonly string[]): RegExp {
  const names = owners.map(escapeRegExp).join('|');
  return new RegExp(
    String.raw`(?<![A-Za-z0-9_.])(?:${names})\s*\.\s*(?:client|resource)\s*\((?=([^]{0,200}))`,
    'g',
  );
}

export const boto3Detector: Detector = {
  id: 'boto3',
  accepts: (fileName) => fileName.endsWith('.py'),
  detect: (text) => {
    const source = text.split(/\r?\n/).map(stripPythonComment).join('\n');
    const owners = ['boto3', ...[...source.matchAll(SESSION_ASSIGNMENT)].map((m) => String(m[1]))];
    const hits: DetectorHit[] = [];
    for (const match of source.matchAll(callPattern(owners))) {
      const literal = LITERAL.exec(String(match[1]));
      addHit(hits, {
        identifierKind: 'boto3Name',
        identifier: literal?.[1] ?? literal?.[2] ?? '',
        kind: 'boto3Clients',
        count: 1,
      });
    }
    return hits;
  },
};
