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
export { manifestsDetector } from './detectors/manifests.js';
