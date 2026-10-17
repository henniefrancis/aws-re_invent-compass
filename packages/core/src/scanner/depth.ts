// Depth and suggested level (Requirements 3.2 and 3.3). The rules are documented here and
// quoted in the README.
//
//   none        every count is 0
//   exploring   only cdkImports, sdkImports or dependencyDeclarations are non-zero
//   building    any of terraformResources, cdkConstructs, sdkClients, sdkCommands or
//               boto3Clients is non-zero
//   production  building, and infrastructure (terraformResources + cdkConstructs >= 1),
//               and code usage (sdkClients + sdkCommands + boto3Clients >= 1), and
//               (score >= 12 or the repository production marker)
//
//   score = 2 x (terraformResources + cdkConstructs + sdkClients + boto3Clients)
//         + 1 x (sdkCommands + cdkImports + sdkImports + dependencyDeclarations)
//
// Every rule only adds conditions that more evidence keeps satisfied, so depth is
// monotonic in evidence.
//
//   exploring, score 1       level 100
//   exploring, score 2 up    level 200
//   building                 level 300
//   production               level 400

import type { Evidence } from './evidence.js';

/** How deeply a service is used. */
export type DepthName = 'none' | 'exploring' | 'building' | 'production';

/** A session level. */
export type SuggestedLevel = 100 | 200 | 300 | 400;

/** The weighted evidence score used by the production and level rules. */
export function score(e: Evidence): number {
  return (
    2 * (e.terraformResources + e.cdkConstructs + e.sdkClients + e.boto3Clients) +
    (e.sdkCommands + e.cdkImports + e.sdkImports + e.dependencyDeclarations)
  );
}

/** Classifies depth from evidence and the repository production marker. */
export function classifyDepth(e: Evidence, productionMarker: boolean): DepthName {
  const infrastructure = e.terraformResources + e.cdkConstructs;
  const code = e.sdkClients + e.sdkCommands + e.boto3Clients;
  if (infrastructure + code === 0) {
    return e.cdkImports + e.sdkImports + e.dependencyDeclarations === 0 ? 'none' : 'exploring';
  }
  if (infrastructure >= 1 && code >= 1 && (score(e) >= 12 || productionMarker)) {
    return 'production';
  }
  return 'building';
}

/** The suggested session level for a depth, or undefined for `none`. */
export function suggestLevel(e: Evidence, depth: DepthName): SuggestedLevel | undefined {
  switch (depth) {
    case 'none':
      return undefined;
    case 'exploring':
      return score(e) <= 1 ? 100 : 200;
    case 'building':
      return 300;
    case 'production':
      return 400;
  }
}

/** The number the `scan_repo` contract uses for a depth. */
export function depthToNumber(depth: DepthName): 0 | 1 | 2 | 3 {
  switch (depth) {
    case 'none':
      return 0;
    case 'exploring':
      return 1;
    case 'building':
      return 2;
    case 'production':
      return 3;
  }
}
