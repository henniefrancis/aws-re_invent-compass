// Verdict combination (Requirement 12.2, design Component 7): block beats warn beats allow,
// and every reason keeps its session code as a prefix.

import type { Verdict } from '@compass/contracts';

/** One session's verdict. */
export interface CodedVerdict {
  code: string;
  verdict: Verdict;
}

/** Combines per-session verdicts. Reasons are `CODE: reason`, distinct, in first-seen order. */
export function combineVerdicts(entries: readonly CodedVerdict[]): Verdict {
  const reasons = [
    ...new Set(
      entries.flatMap(({ code, verdict }) => verdict.reasons.map((reason) => `${code}: ${reason}`)),
    ),
  ];
  if (entries.some(({ verdict }) => verdict.decision === 'block')) {
    return { decision: 'block', reasons };
  }
  if (entries.some(({ verdict }) => verdict.decision === 'warn')) {
    return { decision: 'warn', reasons };
  }
  return { decision: 'allow', reasons };
}
