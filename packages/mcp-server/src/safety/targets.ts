// What a write is about to act on (Requirement 11.4, design Component 9). Titles and codes
// come only from the cached catalog, never from text the model supplied.

import type { CatalogView } from '../ports/events-port.js';

/** A session as the cached catalog knows it. */
export interface CatalogReference {
  sessionId: string;
  code: string;
  title: string;
}

/** Looks ids up in the catalog. `missing` counts ids the catalog does not hold. */
export function describeTargets(
  ids: readonly string[],
  lookup: CatalogView,
): { found: CatalogReference[]; missing: number } {
  const found: CatalogReference[] = [];
  let missing = 0;
  for (const id of ids) {
    const entry = lookup.byId.get(id);
    if (entry === undefined) {
      missing += 1;
    } else {
      found.push({
        sessionId: entry.session.sessionId,
        code: entry.session.code,
        title: entry.session.title,
      });
    }
  }
  return { found, missing };
}
