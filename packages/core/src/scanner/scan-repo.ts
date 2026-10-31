// scanRepo and analyseFiles (Requirements 2.7, 3.1, 3.5, 3.6; compass-power task 41): run the
// AWS detectors and the Tech_Detectors over a stream of source files, aggregate per service and
// per technology, and return counts, depth, level, reasoning and technology scores. The stream
// comes from the walker of a local folder or from the GitHub archive reader. Nothing returned
// holds a file name, a path or file content, and the result is a plain object that can cross a
// worker thread.

import { cdkTypescriptDetector } from './detectors/cdk-typescript.js';
import { dotnetDetector } from './detectors/dotnet.js';
import { manifestsDetector } from './detectors/manifests.js';
import { boto3Detector } from './detectors/boto3.js';
import { sdkJsV3Detector } from './detectors/sdk-js-v3.js';
import {
  dotnetTechDetector,
  jvmTechDetector,
  nodeTechDetector,
  presenceTechDetector,
  pythonTechDetector,
  rubyTechDetector,
} from './detectors/tech.js';
import { terraformDetector } from './detectors/terraform.js';
import type { Detector, DetectorHit, TechDetector, TechHit } from './detectors/types.js';
import { classifyDepth, suggestLevel } from './depth.js';
import type { DepthName, SuggestedLevel } from './depth.js';
import { aggregateHits } from './evidence.js';
import type { Evidence } from './evidence.js';
import { explain } from './reasoning.js';
import type { ScanFs } from './scan-fs.js';
import { SERVICE_TABLE } from './service-table.js';
import type { ServiceKey } from './service-table.js';
import type { SourceFile } from './source-file.js';
import { techFindings } from './tech-findings.js';
import type { TechFinding } from './tech-findings.js';
import { techForExtension } from './tech-table.js';
import type { TechKey } from './tech-table.js';
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
  /** False only when the boto3 detector is not registered, so Python files were not read for evidence. */
  pythonAnalysed: boolean;
  /** Other technology, sorted by score (highest first) then key; a score of 0 is left out. */
  technologies: TechFinding[];
}

/** The detectors registered by default. */
export const DEFAULT_DETECTORS: readonly Detector[] = [
  terraformDetector,
  cdkTypescriptDetector,
  sdkJsV3Detector,
  boto3Detector,
  manifestsDetector,
  dotnetDetector,
];

/** The Tech_Detectors registered by default. */
export const DEFAULT_TECH_DETECTORS: readonly TechDetector[] = [
  nodeTechDetector,
  pythonTechDetector,
  dotnetTechDetector,
  jvmTechDetector,
  rubyTechDetector,
  presenceTechDetector,
];

/** The detectors analyseFiles runs; each defaults to its registered list. */
export interface AnalyseOptions {
  detectors?: readonly Detector[];
  techDetectors?: readonly TechDetector[];
}

/** Dependencies of scanRepo. */
export interface ScanDeps extends AnalyseOptions {
  fs: ScanFs;
  limits?: Partial<WalkLimits>;
  /** The clock for the walk's time budget (default `Date.now`). */
  now?: () => number;
}

/**
 * Analyses a stream of source files. The AWS detectors and the Tech_Detectors see only files with
 * text, each through its `accepts`; the technology count by extension sees every file. The
 * generator's return value is the walk summary.
 */
export async function analyseFiles(
  files: AsyncGenerator<SourceFile, WalkSummary>,
  options: AnalyseOptions = {},
): Promise<ScanResult> {
  const detectors = options.detectors ?? DEFAULT_DETECTORS;
  const techDetectors = options.techDetectors ?? DEFAULT_TECH_DETECTORS;
  const hits: DetectorHit[] = [];
  const techHits: TechHit[] = [];
  const techFiles = new Map<TechKey, number>();
  let summary: WalkSummary;
  for (;;) {
    const next = await files.next();
    if (next.done === true) {
      summary = next.value;
      break;
    }
    const { relativePath, text } = next.value;
    const fileName = relativePath.slice(relativePath.lastIndexOf('/') + 1);
    const tech = techForExtension(fileName);
    if (tech !== undefined) {
      techFiles.set(tech, (techFiles.get(tech) ?? 0) + 1);
    }
    if (text !== undefined) {
      for (const detector of detectors) {
        if (detector.accepts(fileName)) {
          hits.push(...detector.detect(text, fileName));
        }
      }
      for (const detector of techDetectors) {
        if (detector.accepts(fileName)) {
          techHits.push(...detector.detect(text, fileName));
        }
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
    technologies: techFindings(techFiles, techHits),
  };
}

/** Scans `root` read-only. Throws FolderNotFoundError when it is not a directory. */
export async function scanRepo(root: string, deps: ScanDeps): Promise<ScanResult> {
  const limits: WalkLimits = { ...DEFAULT_WALK_LIMITS, ...deps.limits };
  return analyseFiles(walk(root, deps.fs, limits, deps.now), {
    detectors: deps.detectors,
    techDetectors: deps.techDetectors,
  });
}
