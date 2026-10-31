// @compass/core/scanner entry point (S3; compass-power task 41): repo to services (terraform,
// cdk-ts, sdk-js-v3, boto3, AWS SDK for .NET) and to other technology.
// The public surface is exported by name; there is no barrel of barrels.
export { createNodeScanFs } from './scan-fs.js';
export type { ScanFs, ScanStat } from './scan-fs.js';
export { isIgnored, lastMatchingDecision, parseGitignore } from './gitignore.js';
export type { GitignoreRule, RuleDecision } from './gitignore.js';
export { isExcludedDirectory, isSupportedFile } from './file-filter.js';
export { DEFAULT_WALK_LIMITS, FolderNotFoundError, productionMarkerFor, walk } from './walker.js';
export type { SourceFile } from './source-file.js';
export type { SkipReason, WalkLimits, WalkSummary, WalkedFile } from './walker.js';
export { SERVICE_TABLE, entryFor, resolveService } from './service-table.js';
export type { IdentifierKind, ServiceEntry, ServiceKey } from './service-table.js';
export {
  TECH_TABLE,
  normalisePypi,
  resolveTech,
  techEntryFor,
  techForExtension,
  techForManifest,
  techForPackage,
} from './tech-table.js';
export type { PackageEcosystem, TechEntry, TechGroup, TechKey } from './tech-table.js';
export type {
  Detector,
  DetectorHit,
  EvidenceKind,
  TechDetector,
  TechHit,
} from './detectors/types.js';
export { terraformDetector } from './detectors/terraform.js';
export { cdkTypescriptDetector } from './detectors/cdk-typescript.js';
export { sdkJsV3Detector } from './detectors/sdk-js-v3.js';
export { boto3Detector } from './detectors/boto3.js';
export { manifestsDetector } from './detectors/manifests.js';
export { dotnetDetector } from './detectors/dotnet.js';
export {
  dotnetTechDetector,
  jvmTechDetector,
  nodeTechDetector,
  presenceTechDetector,
  pythonTechDetector,
  rubyTechDetector,
} from './detectors/tech.js';
export { EVIDENCE_KINDS, aggregateHits, emptyEvidence } from './evidence.js';
export type { Aggregate, Evidence } from './evidence.js';
export { classifyDepth, depthToNumber, score, suggestLevel } from './depth.js';
export type { DepthName, SuggestedLevel } from './depth.js';
export { explain } from './reasoning.js';
export { mapToTaxonomy } from './taxonomy.js';
export type { TaxonomyMatch } from './taxonomy.js';
export { DECLARATION_WEIGHT, techFindings } from './tech-findings.js';
export type { TechFinding } from './tech-findings.js';
export { DEFAULT_DETECTORS, DEFAULT_TECH_DETECTORS, analyseFiles, scanRepo } from './scan-repo.js';
export type { AnalyseOptions, ScanDeps, ScanResult, ServiceFinding } from './scan-repo.js';
export {
  DEFAULT_SCAN_BUDGET_MS,
  scanInWorker,
  ScanTimeoutError,
  ScanWorkerError,
} from './scan-in-worker.js';
export type { ScanInWorkerOptions, WorkerLike } from './scan-in-worker.js';
