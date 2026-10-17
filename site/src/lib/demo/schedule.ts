// Helpers that turn demo commitments into the rules engine's schedule input
// (showcase-site, Component 7). Pure and clock free.

import type { Commitment, NormalisedSession } from '@compass/contracts';
import type { ScheduleInput } from './rules-port';

/** The reserved session commitment for a catalog session. */
export function commitmentOfSession(session: NormalisedSession): Commitment {
  return {
    kind: 'reservedSession',
    sessionId: session.sessionId,
    // Every demo session has a start and an end time; a test checks it.
    startsAt: session.startsAt as string,
    endsAt: session.endsAt as string,
    title: session.title,
    ...(session.venue === undefined ? {} : { venue: session.venue }),
  };
}

/** The key of a commitment in the demo week: the session id, or the layover id. */
export function commitmentRef(commitment: Commitment): string {
  return commitment.kind === 'reservedSession'
    ? commitment.sessionId
    : (commitment.personalTimeId ?? `${commitment.title}-${commitment.startsAt}`);
}

/** Commitments in start order, with the key as the tie breaker, so the order is stable. */
export function sortCommitments(commitments: readonly Commitment[]): Commitment[] {
  return [...commitments].sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      commitmentRef(a).localeCompare(commitmentRef(b)),
  );
}

/** The engine's schedule input: the commitments and the sessions they refer to. */
export function toScheduleInput(
  commitments: readonly Commitment[],
  catalog: ReadonlyMap<string, NormalisedSession>,
): ScheduleInput {
  const sessions: Record<string, NormalisedSession> = {};
  for (const commitment of commitments) {
    if (commitment.kind === 'reservedSession') {
      const session = catalog.get(commitment.sessionId);
      if (session !== undefined) {
        sessions[commitment.sessionId] = session;
      }
    }
  }
  return { commitments, sessions };
}

/** The event local day (YYYY-MM-DD) of an ISO date-time, as written in the string. */
export function dayOfIso(iso: string): string {
  return iso.slice(0, 10);
}
