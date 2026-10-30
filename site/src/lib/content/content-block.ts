// Content blocks (showcase-site, Component 3).
//
// Every unit of site copy is a ContentBlock that names the document it comes from. A block
// marked verbatim must appear exactly in that document; a test checks it. Other blocks are
// plain-English summaries that name their source and section for human review.

export type SourceDocument =
  | 'CONCEPT.md'
  | 'README.md'
  | '.kiro/steering/product.md'
  | '.kiro/steering/tech.md'
  | 'docs/architecture/build-plan.md'
  | 'KIRO-SPEC-PROMPTS.md'
  | '.kiro/specs/showcase-site/requirements.md'
  | 'packages/mcp-server/README.md'
  | 'NOTICE'
  | 'LICENSE'
  | 'SECURITY.md'
  | 'docs/story/creator-and-inspiration.md'
  | 'docs/hackathon-rules.md'
  | 'docs/decisions/ADR-037-walk-from-here.md'
  | 'kiro.dev/docs/powers/installation';

export interface ContentBlock {
  readonly id: string;
  readonly text: string;
  readonly source: SourceDocument;
  /** For example "4.2" or "Act 1: Plan". */
  readonly section: string;
  /** True when the text must appear exactly in the source file. */
  readonly verbatim: boolean;
}

/** Source documents that are files in this repository (the others are web pages). */
export const FILE_SOURCES: readonly SourceDocument[] = [
  'CONCEPT.md',
  'README.md',
  '.kiro/steering/product.md',
  '.kiro/steering/tech.md',
  'docs/architecture/build-plan.md',
  'KIRO-SPEC-PROMPTS.md',
  '.kiro/specs/showcase-site/requirements.md',
  'packages/mcp-server/README.md',
  'NOTICE',
  'LICENSE',
  'SECURITY.md',
  'docs/story/creator-and-inspiration.md',
  'docs/hackathon-rules.md',
  'docs/decisions/ADR-037-walk-from-here.md',
];

/** A block whose text appears exactly in its source. */
export function quoted(
  id: string,
  text: string,
  source: SourceDocument,
  section: string,
): ContentBlock {
  return { id, text, source, section, verbatim: true };
}

/** A block that summarises its source in plain English. */
export function summary(
  id: string,
  text: string,
  source: SourceDocument,
  section: string,
): ContentBlock {
  return { id, text, source, section, verbatim: false };
}
