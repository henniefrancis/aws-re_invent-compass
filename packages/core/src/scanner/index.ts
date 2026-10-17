// @compass/core/scanner entry point (S3): repo to services (terraform, cdk-ts, sdk-js-v3, boto3).
// The public surface is exported by name; there is no barrel of barrels.
export { createNodeScanFs } from './scan-fs.js';
export type { ScanFs, ScanStat } from './scan-fs.js';
export { isIgnored, lastMatchingDecision, parseGitignore } from './gitignore.js';
export type { GitignoreRule, RuleDecision } from './gitignore.js';
export { isExcludedDirectory, isSupportedFile } from './file-filter.js';
export { DEFAULT_WALK_LIMITS, FolderNotFoundError, walk } from './walker.js';
export type { SkipReason, WalkLimits, WalkSummary, WalkedFile } from './walker.js';
export { SERVICE_TABLE, entryFor, resolveService } from './service-table.js';
export type { IdentifierKind, ServiceEntry, ServiceKey } from './service-table.js';
export type { Detector, DetectorHit, EvidenceKind } from './detectors/types.js';
export { terraformDetector } from './detectors/terraform.js';
export { cdkTypescriptDetector } from './detectors/cdk-typescript.js';
export { sdkJsV3Detector } from './detectors/sdk-js-v3.js';
export { boto3Detector } from './detectors/boto3.js';
export { manifestsDetector } from './detectors/manifests.js';
export { EVIDENCE_KINDS, aggregateHits, emptyEvidence } from './evidence.js';
export type { Aggregate, Evidence } from './evidence.js';
export { classifyDepth, depthToNumber, score, suggestLevel } from './depth.js';
export type { DepthName, SuggestedLevel } from './depth.js';
export { explain } from './reasoning.js';
export { mapToTaxonomy } from './taxonomy.js';
export type { TaxonomyMatch } from './taxonomy.js';
export { DEFAULT_DETECTORS, scanRepo } from './scan-repo.js';
export type { ScanDeps, ScanResult, ServiceFinding } from './scan-repo.js';
