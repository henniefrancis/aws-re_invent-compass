// The S4 boarding-passes seam (design, Component 6). The adapter holds the ID token
// provider; nothing in a handler ever sees an ID token.

import type { Commitment, NormalisedSession } from '@compass/contracts';

/** What a sync would do. Session ids for issue and update, pass records for void. */
export interface SyncPlan {
  toIssue: string[];
  toUpdate: string[];
  toVoid: { sessionCode: string; serialNumber: string }[];
}

/** S4 as the server sees it. Every method may throw a CompassError. */
export interface PassesPort {
  issue(
    sessions: readonly NormalisedSession[],
    itinerary: readonly Commitment[],
  ): Promise<{ sessionId: string; serialNumber: string }[]>;
  issuedRecord(): Promise<{ sessionCode: string; serialNumber: string }[]>;
  handoff(serials: string[]): Promise<{
    boardUrl: string;
    expiresAt: string;
    terminalQr: string;
    chatText: string;
    chatPng: Uint8Array;
  }>;
  /** What a sync would do, with no side effects. `toVoid` lists the passes it would void. */
  previewSync(
    resolved: readonly NormalisedSession[],
    narrowTo?: ReadonlySet<string>,
  ): Promise<SyncPlan>;
  /**
   * Brings passes in line with the resolved reserved sessions. The adapter sets S4's
   * `scheduleConfirmed` itself (the list came from a successful, complete GetSchedule);
   * `confirmEmpty` is required to void every pass and `allowBulkVoid` to void more than five.
   */
  sync(
    resolved: readonly NormalisedSession[],
    options: { narrowTo?: ReadonlySet<string>; confirmEmpty: boolean; allowBulkVoid: boolean },
  ): Promise<{ issued: string[]; updated: string[]; voided: string[] }>;
  exportCalendar(commitments: readonly Commitment[]): Promise<{ ics: string; path: string }>;
  forgetMe(): Promise<{ ok: true } | { ok: false; summary: string }>;
}
