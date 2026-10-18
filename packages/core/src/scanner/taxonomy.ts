// Taxonomy mapping (Requirement 4.2): a service's candidates are matched, case
// insensitively, against the labels that really appear in the cached catalog. Only the
// catalog's own spelling is ever returned.

import { entryFor } from './service-table.js';
import type { ServiceKey } from './service-table.js';

/** The catalog labels that match one service. */
export interface TaxonomyMatch {
  key: ServiceKey;
  labels: string[];
  /** False means "not in the catalog's service list". */
  inCatalog: boolean;
}

/** Maps findings to catalog labels. */
export function mapToTaxonomy(
  findings: readonly { key: ServiceKey }[],
  catalogLabels: readonly string[],
): TaxonomyMatch[] {
  return findings.map(({ key }) => {
    const candidates = new Set(
      (entryFor(key)?.taxonomyCandidates ?? []).map((candidate) => candidate.toLowerCase()),
    );
    const labels = catalogLabels.filter((label) => candidates.has(label.toLowerCase()));
    return { key, labels: [...new Set(labels)], inCatalog: labels.length > 0 };
  });
}
