// scanRepo (Requirements 2.7, 3.1, 3.5, 3.6): walk the tree, run the detectors over each
// readable file, aggregate per service, and return counts, depth, level and reasoning.
// Nothing returned holds a file name, a path or file content.

import { cdkTypescriptDetector } from './detectors/cdk-typescript.js';
import { manifestsDetector } from './detectors/manifests.js';
import { sdkJsV3Detector } from './detectors/sdk-js-v3.js';
import { terraformDetector } from './detectors/terraform.js';
import type { Detector, DetectorHit } from './detectors/types.js';
import { classifyDepth, suggestLevel } from './depth.js';
import type { DepthName, SuggestedLevel } from './depth.js';
import { aggregateHits } from './evidence.js';
import type { Evidence } from './evidence.js';
import { explain } from './reasoning.js';
import type { ScanFs } from './scan-fs.js';
import { SERVICE_TABLE } from './service-table.js';
import type { ServiceKey } from './service-table.js';
import { DEFAULT_WALK_LIMITS, walk } from './walker.js';
import type { SkipReason, WalkLimits, WalkSummary } from './walker.js';

/** One detected service. */
export interface ServiceFinding {
  key: ServiceKey;
  displayName: string;
  evidence: Evidence;
  depth: DepthName;
  suggestedLevel?: SuggestedLevel;
  reasoning: string;
}

/** The whole scan result. */
export interface ScanResult {
  /** Sorted by key; only services with a depth other than `none`. */
  services: ServiceFinding[];
  unmappedCount: number;
  filesRead: number;
  skipped: Record<SkipReason, number>;
  truncated: boolean;
  /** False while the boto3 detector is not registered (cut-list item 3). */
  pythonAnalysed: boolean;
}

/** The detectors registered by default. */
export const DEFAULT_DETECTORS: readonly Detector[] = [
  terraformDetector,
  cdkTypescriptDetector,
  sdkJsV3Detector,
  manifestsDetector,
];

/** Dependencies of scanRepo. */
export interface ScanDeps {
  fs: ScanFs;
  limits?: Partial<WalkLimits>;
  detectors?: readonly Detector[];
}

/** Scans `root` read-only. Throws FolderNotFoundError when it is not a directory. */
export async function scanRepo(root: string, deps: ScanDeps): Promise<ScanResult> {
  const detectors = deps.detectors ?? DEFAULT_DETECTORS;
  const limits: WalkLimits = { ...DEFAULT_WALK_LIMITS, ...deps.limits };
  const hits: DetectorHit[] = [];
  const generator = walk(root, deps.fs, limits);
  let summary: WalkSummary;
  for (;;) {
    const next = await generator.next();
    if (next.done === true) {
      summary = next.value;
      break;
    }
    const { relativePath, text } = next.value;
    const fileName = relativePath.slice(relativePath.lastIndexOf('/') + 1);
    for (const detector of detectors) {
      if (detector.accepts(fileName)) {
        hits.push(...detector.detect(text, fileName));
      }
    }
  }

  const { byService, unmappedCount } = aggregateHits(hits);
  const services: ServiceFinding[] = [];
  // A service in byService has at least one counted hit, so its depth is never `none`.
  // SERVICE_TABLE is sorted by key (asserted by a structural test), so findings are too.
  for (const entry of SERVICE_TABLE) {
    const evidence = byService.get(entry.key);
    if (evidence !== undefined) {
      const depth = classifyDepth(evidence, summary.productionMarker);
      const suggestedLevel = suggestLevel(evidence, depth);
      services.push({
        key: entry.key,
        displayName: entry.displayName,
        evidence,
        depth,
        suggestedLevel,
        reasoning: explain(entry, evidence, depth, suggestedLevel),
      });
    }
  }
  return {
    services,
    unmappedCount,
    filesRead: summary.filesRead,
    skipped: summary.skipped,
    truncated: summary.truncated,
    pythonAnalysed: detectors.some((detector) => detector.id === 'boto3'),
  };
}
