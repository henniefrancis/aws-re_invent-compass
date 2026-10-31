// Shared detector types (design, Component 1; compass-power task 41). A hit carries an identifier
// or a technology key and a count, never a file name, a path or a location.

import type { IdentifierKind } from '../service-table.js';
import type { TechKey } from '../tech-table.js';

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
  id: 'terraform' | 'cdk-typescript' | 'sdk-js-v3' | 'boto3' | 'manifests' | 'dotnet';
  accepts(fileName: string): boolean;
  /** `fileName` is the base name, used only to tell one file format from another (`package.json` from `requirements.txt`, `.cs` from `.csproj`). */
  detect(text: string, fileName: string): DetectorHit[];
}

/** Declarations of one technology found in one manifest (compass-power task 41.2). */
export interface TechHit {
  tech: TechKey;
  kind: 'declarations';
  count: number;
}

/** One Tech_Detector: reads one kind of manifest and returns technology hits. Pure over the text. */
export interface TechDetector {
  id: string;
  accepts(fileName: string): boolean;
  /** `fileName` is the base name, used to tell one manifest format from another. */
  detect(text: string, fileName: string): TechHit[];
}
