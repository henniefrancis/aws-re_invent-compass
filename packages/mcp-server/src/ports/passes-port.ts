// The S4 boarding-passes seam (design, Component 6). The adapter holds the ID token provider;
// nothing in a handler ever sees an ID token. Passes are keyed by session code inside S4, so
// the scopes below carry the codes a narrowed sync may touch and the code-to-id map the results
// need.

import type { NormalisedSession } from '@compass/contracts';
import type { ScheduleView } from '@compass/core/passes';

export type { ScheduleView };

/** What a sync or a sync preview works over. */
export interface SyncScope {
  /** The reserved sessions to sync, already narrowed to the requested ids. */
  resolved: readonly NormalisedSession[];
  /** The whole confirmed schedule, so every pass carries the right neighbours. */
  schedule: ScheduleView;
  /** The session codes the sync may touch. Absent means every issued pass. */
  narrowCodes?: ReadonlySet<string>;
  /** Maps a session code back to its id, for the results. */
  idByCode: ReadonlyMap<string, string>;
}

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
    schedule: ScheduleView,
  ): Promise<{ sessionId: string; serialNumber: string }[]>;
  issuedRecord(): Promise<{ sessionCode: string; serialNumber: string }[]>;
  handoff(serials: string[]): Promise<{
    boardUrl: string;
    expiresAt: string;
    terminalQr: string;
    chatText: string;
    chatPng: Uint8Array;
    /** The same QR code as an SVG document, for the QR page (task 48). */
    svg: string;
  }>;
  /** What a sync would do, with no side effects. */
  previewSync(scope: SyncScope): Promise<SyncPlan>;
  /**
   * Brings passes in line with the resolved reserved sessions. The adapter sets S4's
   * `scheduleConfirmed` itself (the list came from a successful, complete GetSchedule);
   * `confirmEmpty` is required to void every pass and `allowBulkVoid` to void more than five.
   * A narrowed sync never issues, updates or voids a pass outside `narrowCodes`.
   */
  sync(
    scope: SyncScope & { confirmEmpty: boolean; allowBulkVoid: boolean },
  ): Promise<{ issued: string[]; updated: string[]; voided: string[] }>;
  exportCalendar(schedule: ScheduleView): Promise<{ ics: string; path: string }>;
  forgetMe(): Promise<{ ok: true } | { ok: false; summary: string }>;
}
