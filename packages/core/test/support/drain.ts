import type { WalkedFile, WalkSummary } from '../../src/scanner/walker.js';

/** Runs a walk to completion and returns the files and the summary. */
export async function drain(
  generator: AsyncGenerator<WalkedFile, WalkSummary>,
): Promise<{ files: WalkedFile[]; summary: WalkSummary }> {
  const files: WalkedFile[] = [];
  for (;;) {
    const next = await generator.next();
    if (next.done === true) {
      return { files, summary: next.value };
    }
    files.push(next.value);
  }
}
