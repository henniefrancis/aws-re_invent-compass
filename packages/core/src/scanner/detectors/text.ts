// Small text helpers shared by the detectors.

import type { DetectorHit } from './types.js';

/** Returns the lines of `text` that are not whole-line comments for any of `markers`. */
export function codeLines(text: string, markers: readonly string[]): string[] {
  return text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trimStart();
    return !markers.some((marker) => trimmed.startsWith(marker));
  });
}

/** Adds `count` to the hit with the same identity, or appends a new one. */
export function addHit(hits: DetectorHit[], hit: DetectorHit): void {
  const existing = hits.find(
    (h) =>
      h.kind === hit.kind &&
      h.identifierKind === hit.identifierKind &&
      h.identifier === hit.identifier,
  );
  if (existing === undefined) {
    hits.push({ ...hit });
  } else {
    existing.count += hit.count;
  }
}

/** Returns a capture group that is known to participate in the match. */
export function grp(match: RegExpMatchArray, index: number): string {
  return String(match[index]);
}
