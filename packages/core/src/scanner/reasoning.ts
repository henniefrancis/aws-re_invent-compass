// The reasoning text (Requirement 3.4): plain English, one short sentence per evidence
// kind plus a closing sentence with the depth and the level. It names counts, never a
// file, and contains no em dash or en dash. No sentence is longer than 25 words.

import type { DepthName, SuggestedLevel } from './depth.js';
import { EVIDENCE_KINDS } from './evidence.js';
import type { Evidence } from './evidence.js';
import type { ServiceEntry } from './service-table.js';

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function sentenceFor(kind: (typeof EVIDENCE_KINDS)[number], name: string, n: number): string {
  switch (kind) {
    case 'terraformResources':
      return `You define ${plural(n, `${name} resource`, `${name} resources`)} in Terraform.`;
    case 'cdkConstructs':
      return `You create ${plural(n, `${name} construct`, `${name} constructs`)} in the AWS CDK.`;
    case 'cdkImports':
      return `You import ${name} from the AWS CDK ${plural(n, 'time', 'times')}.`;
    case 'sdkImports':
      return `You import the ${name} SDK package ${plural(n, 'time', 'times')}.`;
    case 'sdkClients':
      return `You create ${plural(n, `${name} client`, `${name} clients`)} in code.`;
    case 'sdkCommands':
      return `You send ${plural(n, `${name} command`, `${name} commands`)} in code.`;
    case 'boto3Clients':
      return `You make ${plural(n, `${name} call`, `${name} calls`)} with boto3.`;
    case 'dependencyDeclarations':
      return `You declare ${plural(n, `${name} dependency`, `${name} dependencies`)}.`;
  }
}

/** Explains a finding in plain English. */
export function explain(
  entry: ServiceEntry,
  e: Evidence,
  depth: DepthName,
  level?: SuggestedLevel,
): string {
  const name = entry.displayName;
  if (depth === 'none' || level === undefined) {
    return `No ${name} use was found, so the depth is none and no level is suggested.`;
  }
  const sentences = EVIDENCE_KINDS.filter((kind) => e[kind] > 0).map((kind) =>
    sentenceFor(kind, name, e[kind]),
  );
  sentences.push(`${name} is at the ${depth} depth, so level ${level} sessions should suit you.`);
  return sentences.join(' ');
}
