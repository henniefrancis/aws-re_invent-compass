// Evidence aggregation (Requirement 3.1): turns raw detector hits into counts per service
// and per evidence kind. Evidence never holds file contents, names or paths.

import type { DetectorHit, EvidenceKind } from './detectors/types.js';
import { resolveService } from './service-table.js';
import type { ServiceKey } from './service-table.js';

/** Counts per evidence kind. */
export type Evidence = Record<EvidenceKind, number>;

/** Every evidence kind, in the order the reasoning sentences use. */
export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'terraformResources',
  'cdkConstructs',
  'cdkImports',
  'sdkImports',
  'sdkClients',
  'sdkCommands',
  'boto3Clients',
  'dependencyDeclarations',
];

/** A fresh evidence vector with every count at zero. */
export function emptyEvidence(): Evidence {
  return {
    terraformResources: 0,
    cdkConstructs: 0,
    cdkImports: 0,
    sdkImports: 0,
    sdkClients: 0,
    sdkCommands: 0,
    boto3Clients: 0,
    dependencyDeclarations: 0,
  };
}

/** The result of aggregating hits. */
export interface Aggregate {
  byService: Map<ServiceKey, Evidence>;
  /** AWS identifiers with no Service_Table entry, summed by count. They are never reported as services. */
  unmappedCount: number;
}

/** Groups hits by the service their identifier resolves to. */
export function aggregateHits(hits: readonly DetectorHit[]): Aggregate {
  const byService = new Map<ServiceKey, Evidence>();
  let unmappedCount = 0;
  for (const hit of hits) {
    const key = resolveService(hit.identifierKind, hit.identifier);
    if (key === undefined) {
      unmappedCount += hit.count;
    } else {
      const evidence = byService.get(key) ?? emptyEvidence();
      evidence[hit.kind] += hit.count;
      byService.set(key, evidence);
    }
  }
  return { byService, unmappedCount };
}
