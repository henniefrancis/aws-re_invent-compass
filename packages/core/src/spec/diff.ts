// A small line diff (design, Component 4; Requirement 7.2). No diff library is pinned in
// the workspace. The diff is the longest common subsequence of the two texts' lines,
// shown with the prefixes `+ ` (added), `- ` (removed) and two spaces (unchanged). It holds
// at most `maxLines` lines and sets `truncated` beyond that. Inputs larger than the
// matrix limit fall back to "remove everything, add everything".

/** A line diff. */
export interface DiffResult {
  lines: string[];
  truncated: boolean;
}

const MATRIX_LIMIT = 1_000_000;
const NEWLINE = '\n';

/** The default cap on diff lines. */
export const DEFAULT_MAX_DIFF_LINES = 400;

function commonLength(a: readonly string[], b: readonly string[], fromEnd: boolean): number {
  const limit = Math.min(a.length, b.length);
  let count = 0;
  while (
    count < limit &&
    (fromEnd ? a[a.length - 1 - count] === b[b.length - 1 - count] : a[count] === b[count])
  ) {
    count += 1;
  }
  return count;
}

function diffMiddle(a: readonly string[], b: readonly string[]): string[] {
  if ((a.length + 1) * (b.length + 1) > MATRIX_LIMIT) {
    return [...a.map((line) => `- ${line}`), ...b.map((line) => `+ ${line}`)];
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  const cell = (index: number): number => Number(table[index]);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? cell((i + 1) * width + j + 1) + 1
          : Math.max(cell((i + 1) * width + j), cell(i * width + j + 1));
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (cell((i + 1) * width + j) >= cell(i * width + j + 1)) {
      out.push(`- ${a[i]}`);
      i += 1;
    } else {
      out.push(`+ ${b[j]}`);
      j += 1;
    }
  }
  while (i < a.length) {
    out.push(`- ${a[i]}`);
    i += 1;
  }
  while (j < b.length) {
    out.push(`+ ${b[j]}`);
    j += 1;
  }
  return out;
}

/** The line diff between two texts. */
export function lineDiff(
  before: string,
  after: string,
  maxLines = DEFAULT_MAX_DIFF_LINES,
): DiffResult {
  const a = before.split('\n');
  const b = after.split('\n');
  const prefix = commonLength(a, b, false);
  const rest = (list: readonly string[]): string[] => list.slice(prefix);
  const suffix = commonLength(rest(a), rest(b), true);
  const middleA = rest(a).slice(0, rest(a).length - suffix);
  const middleB = rest(b).slice(0, rest(b).length - suffix);
  const lines = [
    ...a.slice(0, prefix).map((line) => `  ${line}`),
    ...diffMiddle(middleA, middleB),
    ...a.slice(a.length - suffix).map((line) => `  ${line}`),
  ];
  return lines.length > maxLines
    ? { lines: lines.slice(0, maxLines), truncated: true }
    : { lines, truncated: false };
}

/**
 * Rebuilds the new text from the old text and a complete (not truncated) diff. Throws when
 * the diff does not describe `before`.
 */
export function applyDiff(before: string, diff: DiffResult): string {
  const old = diff.lines
    .filter((line) => !line.startsWith('+ '))
    .map((line) => line.slice(2))
    .join(NEWLINE);
  if (old !== before) {
    throw new Error('The diff does not match the original text.');
  }
  return diff.lines
    .filter((line) => !line.startsWith('- '))
    .map((line) => line.slice(2))
    .join(NEWLINE);
}
