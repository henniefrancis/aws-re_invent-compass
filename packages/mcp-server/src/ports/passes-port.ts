// The S4 boarding-passes seam (design, Component 6). The adapter holds the ID token
// provider; nothing in a handler ever sees an ID token.

import type { Commitment, NormalisedSession } from '@compass/contracts';

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
  sync(
    resolved: readonly NormalisedSession[],
    narrowTo?: ReadonlySet<string>,
  ): Promise<{ issued: string[]; updated: string[]; voided: string[] }>;
  exportCalendar(commitments: readonly Commitment[]): Promise<{ ics: string; path: string }>;
  forgetMe(): Promise<{ ok: true } | { ok: false; summary: string }>;
}
