// Shared detector types (design, Component 1). A hit carries an identifier and a count,
// never a file name, a path or a location.

import type { IdentifierKind } from '../service-table.js';

/** The kinds of evidence a detector can find (Requirement 3.1). */
export type EvidenceKind =
  | 'terraformResources'
  | 'cdkConstructs'
  | 'cdkImports'
  | 'sdkImports'
  | 'sdkClients'
  | 'sdkCommands'
  | 'boto3Clients'
  | 'dependencyDeclarations';

/** One kind of evidence for one identifier. */
export interface DetectorHit {
  identifierKind: IdentifierKind;
  identifier: string;
  kind: EvidenceKind;
  count: number;
}

/** One detector: reads one kind of file and returns hits. Pure over the text. */
export interface Detector {
  id: 'terraform' | 'cdk-typescript' | 'sdk-js-v3' | 'boto3' | 'manifests';
  accepts(fileName: string): boolean;
  /** `fileName` is the base name, used only to tell `package.json` from `requirements.txt`. */
  detect(text: string, fileName: string): DetectorHit[];
}
