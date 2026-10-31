// Technology findings (compass-power task 41.2; Requirement P2.1): file counts by extension and
// manifest declarations per technology, scored and sorted. A finding holds a key, names and counts,
// never a file name, a path or file content.

import type { TechHit } from './detectors/types.js';
import { TECH_TABLE } from './tech-table.js';
import type { TechGroup, TechKey } from './tech-table.js';

/** One technology found in a scan. */
export interface TechFinding {
  key: TechKey;
  displayName: string;
  group: TechGroup;
  /** Files counted by their extension. */
  files: number;
  /** Manifest files and the packages they declare. */
  declarations: number;
  /** files + 5 x declarations. */
  score: number;
}

/** The weight of one declaration against one file. */
export const DECLARATION_WEIGHT = 5;

/** Scores every technology with evidence; sorted by score (highest first), then key. */
export function techFindings(
  files: ReadonlyMap<TechKey, number>,
  hits: readonly TechHit[],
): TechFinding[] {
  const declarations = new Map<TechKey, number>();
  for (const hit of hits) {
    declarations.set(hit.tech, (declarations.get(hit.tech) ?? 0) + hit.count);
  }
  const findings: TechFinding[] = [];
  for (const entry of TECH_TABLE) {
    const fileCount = files.get(entry.key) ?? 0;
    const declarationCount = declarations.get(entry.key) ?? 0;
    const score = fileCount + DECLARATION_WEIGHT * declarationCount;
    if (score > 0) {
      findings.push({
        key: entry.key,
        displayName: entry.displayName,
        group: entry.group,
        files: fileCount,
        declarations: declarationCount,
        score,
      });
    }
  }
  // TECH_TABLE is sorted by key and the sort is stable, so equal scores stay in key order.
  return findings.sort((a, b) => b.score - a.score);
}
