// The batch guard (Requirement 12.2, design Component 7): each candidate is judged against the
// confirmed schedule plus the candidates before it, so a clash inside one request blocks.

import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';
import type { CatalogView } from '../ports/events-port.js';
import type { RulesPort } from '../ports/rules-port.js';
import { commitmentFor } from '../tools/common.js';
import { combineVerdicts } from './combine-verdicts.js';

/** The combined verdict and each session's own verdict. */
export interface GuardResult {
  verdict: Verdict;
  perSession: { sessionId: string; code: string; title: string; verdict: Verdict }[];
}

/** Runs the guardrail for every candidate. */
export async function guardBatch(
  candidates: readonly NormalisedSession[],
  confirmed: readonly Commitment[],
  rules: RulesPort,
  lookup: CatalogView,
): Promise<GuardResult> {
  const perSession: GuardResult['perSession'] = [];
  for (const [index, candidate] of candidates.entries()) {
    const others = [...confirmed, ...candidates.slice(0, index).map(commitmentFor)];
    let verdict: Verdict;
    try {
      verdict = await rules.checkReservation(candidate, others, lookup);
    } catch {
      // S2 never throws by design; if it does, the safe answer is to block.
      verdict = {
        decision: 'block',
        reasons: ['Compass could not check this session, so it is blocked.'],
      };
    }
    perSession.push({
      sessionId: candidate.sessionId,
      code: candidate.code,
      title: candidate.title,
      verdict,
    });
  }
  return {
    verdict: combineVerdicts(perSession.map(({ code, verdict }) => ({ code, verdict }))),
    perSession,
  };
}
