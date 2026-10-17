import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';
import type { PlannerRules } from '../../src/spec/planner.js';

/** A scripted, recording PlannerRules. */
export class FakePlannerRules implements PlannerRules {
  /** Entries like `check:<id>` and `repeats:<id>`, in call order. */
  readonly log: string[] = [];
  readonly checked = new Map<string, Verdict['decision']>();
  decide: (candidate: NormalisedSession, commitments: readonly Commitment[]) => Verdict = () => ({
    decision: 'allow',
    reasons: [],
  });
  repeats: (session: NormalisedSession) => NormalisedSession[] = () => [];
  layovers: (day: readonly Commitment[]) => { start: string; end: string; reason: string }[] =
    () => [];

  checkReservation(
    candidate: NormalisedSession,
    commitments: readonly Commitment[],
  ): Promise<Verdict> {
    this.log.push(`check:${candidate.sessionId}`);
    const verdict = this.decide(candidate, commitments);
    if (!this.checked.has(candidate.sessionId)) {
      this.checked.set(candidate.sessionId, verdict.decision);
    }
    return Promise.resolve(verdict);
  }

  suggestLayovers(
    dayCommitments: readonly Commitment[],
  ): Promise<{ start: string; end: string; reason: string }[]> {
    this.log.push('layovers');
    return Promise.resolve(this.layovers(dayCommitments));
  }

  repeatsOf(session: NormalisedSession): Promise<NormalisedSession[]> {
    this.log.push(`repeats:${session.sessionId}`);
    return Promise.resolve(this.repeats(session));
  }
}

/** A plain normalised session for planner tests. */
export function session(
  sessionId: string,
  overrides: Partial<NormalisedSession> = {},
): NormalisedSession {
  return {
    sessionId,
    code: sessionId.toUpperCase(),
    title: `Title ${sessionId}`,
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'available',
    missingFields: [],
    startsAt: '2026-12-01T18:00:00.000Z',
    endsAt: '2026-12-01T19:00:00.000Z',
    ...overrides,
  };
}

export const WINDOW = {
  start: '2026-11-30T00:00:00-08:00',
  end: '2026-12-04T23:59:00-08:00',
  timezone: 'America/Los_Angeles',
};
