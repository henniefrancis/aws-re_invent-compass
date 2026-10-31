// The AWS SDK for .NET detector (compass-power task 41.3; Requirement P2.1).
//
// Counted:
//   - in `*.csproj` and `*.fsproj`, each `<PackageReference Include="...">` of an `AWSSDK.*` or
//     `Amazon.Lambda.*` package, as a dependency declaration (a package with no Service_Table
//     entry, such as `AWSSDK.Core`, adds to the unmapped total),
//   - in `*.cs`, each `new Amazon<Name>Client(` (or `new Amazon.<Namespace>.Amazon<Name>Client(`),
//     as an SDK client attributed by its `<Name>`.
// C# comments and string and character literals (regular, verbatim, interpolated and raw) are
// blanked first in one linear pass, so a call inside a comment or a string is not counted.

import { addHit, grp } from './text.js';
import type { Detector, DetectorHit } from './types.js';
import { packageReferences } from './xml.js';

const CLIENT = /\bnew\s+(?:Amazon\.[A-Za-z0-9]+\.)?Amazon([A-Za-z0-9]+)Client\s*\(/g;

/** Every character but a line break becomes a space, so positions and lines do not move. */
function blank(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

/** The index just after a regular string or character literal that opens at `start`. */
function endOfLiteral(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length && text.charAt(i) !== quote && text.charAt(i) !== '\n') {
    i += text.charAt(i) === '\\' ? 2 : 1;
  }
  return Math.min(text.length, text.charAt(i) === quote ? i + 1 : i);
}

/** The index just after a verbatim string (`@"..."`, where `""` is a quote) that opens at `start`. */
function endOfVerbatim(text: string, start: number): number {
  let i = text.indexOf('"', start + 1);
  while (i !== -1 && text.charAt(i + 1) === '"') {
    i = text.indexOf('"', i + 2);
  }
  return i === -1 ? text.length : i + 1;
}

/** The index just after a raw string (three or more quotes) that opens at `start`. */
function endOfRaw(text: string, start: number): number {
  let quotes = 0;
  while (text.charAt(start + quotes) === '"') {
    quotes += 1;
  }
  const end = text.indexOf('"'.repeat(quotes), start + quotes);
  return end === -1 ? text.length : end + quotes;
}

/** The index just after the comment or literal that opens at `i`, or -1 when none opens there. */
function skipAt(text: string, i: number): number {
  const char = text.charAt(i);
  const next = text.charAt(i + 1);
  if (char === '/' && next === '/') {
    const end = text.indexOf('\n', i);
    return end === -1 ? text.length : end;
  }
  if (char === '/' && next === '*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (char === '"' && next === '"' && text.charAt(i + 2) === '"') {
    return endOfRaw(text, i);
  }
  if (char === '"') {
    const before = text.slice(Math.max(0, i - 2), i);
    return before.endsWith('@') || before === '@$'
      ? endOfVerbatim(text, i)
      : endOfLiteral(text, i, '"');
  }
  return char === "'" ? endOfLiteral(text, i, "'") : -1;
}

/** Blanks C# comments and string and character literals, keeping every line break. Linear. */
export function maskCSharp(text: string): string {
  const out: string[] = [];
  let code = 0;
  let i = 0;
  while (i < text.length) {
    const end = skipAt(text, i);
    if (end === -1) {
      i += 1;
    } else {
      out.push(text.slice(code, i), blank(text.slice(i, end)));
      code = end;
      i = end;
    }
  }
  out.push(text.slice(code));
  return out.join('');
}

/** True for the NuGet packages this detector counts. */
function isAwsPackage(name: string): boolean {
  const id = name.toLowerCase();
  return id.startsWith('awssdk.') || id.startsWith('amazon.lambda.');
}

function fromProject(text: string): DetectorHit[] {
  const hits: DetectorHit[] = [];
  for (const name of packageReferences(text).filter(isAwsPackage)) {
    addHit(hits, {
      identifierKind: 'nugetPackage',
      identifier: name,
      kind: 'dependencyDeclarations',
      count: 1,
    });
  }
  return hits;
}

function fromCSharp(text: string): DetectorHit[] {
  const hits: DetectorHit[] = [];
  for (const match of maskCSharp(text).matchAll(CLIENT)) {
    addHit(hits, {
      identifierKind: 'dotnetClientName',
      identifier: grp(match, 1),
      kind: 'sdkClients',
      count: 1,
    });
  }
  return hits;
}

export const dotnetDetector: Detector = {
  id: 'dotnet',
  accepts: (fileName) =>
    fileName.endsWith('.cs') || fileName.endsWith('.csproj') || fileName.endsWith('.fsproj'),
  detect: (text, fileName) => (fileName.endsWith('.cs') ? fromCSharp(text) : fromProject(text)),
};
