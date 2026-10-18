// The manifest detector (Requirement 2.5): counts each declared dependency on
// `aws-cdk-lib`, an `@aws-sdk/client-<name>` package or `boto3`, in `package.json`
// (`dependencies` and `devDependencies`) and `requirements.txt`. A malformed
// `package.json` counts nothing and never throws.

import { addHit } from './text.js';
import type { Detector, DetectorHit } from './types.js';

const REQUIREMENT_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;

function isAwsDependency(name: string): boolean {
  return name === 'aws-cdk-lib' || name === 'boto3' || name.startsWith('@aws-sdk/client-');
}

function declare(hits: DetectorHit[], name: string): void {
  addHit(hits, {
    identifierKind: 'sdkPackage',
    identifier: name,
    kind: 'dependencyDeclarations',
    count: 1,
  });
}

function fromPackageJson(text: string): DetectorHit[] {
  const hits: DetectorHit[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return hits;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return hits;
  }
  for (const section of ['dependencies', 'devDependencies']) {
    const map: unknown = (parsed as Record<string, unknown>)[section];
    if (typeof map === 'object' && map !== null) {
      for (const name of Object.keys(map)) {
        if (isAwsDependency(name)) {
          declare(hits, name);
        }
      }
    }
  }
  return hits;
}

function fromRequirements(text: string): DetectorHit[] {
  const hits: DetectorHit[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#') || trimmed.startsWith('-')) {
      continue;
    }
    const match = REQUIREMENT_NAME.exec(line);
    if (match !== null) {
      // PEP 503 normalisation: lower case, runs of `-`, `_` and `.` become one `-`.
      const name = String(match[1])
        .toLowerCase()
        .replace(/[-_.]+/g, '-');
      if (isAwsDependency(name)) {
        declare(hits, name);
      }
    }
  }
  return hits;
}

export const manifestsDetector: Detector = {
  id: 'manifests',
  accepts: (fileName) => fileName === 'package.json' || fileName === 'requirements.txt',
  detect: (text, fileName) =>
    fileName === 'package.json' ? fromPackageJson(text) : fromRequirements(text),
};
