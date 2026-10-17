// Confirmed-write helper for the Events API client (events-client, S1).
//
// Component 6 in the design. A 200 from a write does not prove the write took
// effect: the product rule is to trust GetSchedule, not the write response. This
// helper runs a write and, only if it succeeds, reads the schedule back exactly once
// to confirm it (Requirements 11.1, 11.2). If the write itself fails, the error is
// returned and GetSchedule is never called (Requirement 11.3). If the write succeeds
// but the confirming GetSchedule fails, the helper reports confirmed: false and
// never re-sends the write (Requirement 11.4), which is essential for ReserveSessions
// where a re-send could double-book a seat.
//
// The GetSchedule reader is injected so this helper is independent of the operation
// functions (wired in task 8) and unit-testable on its own.

import type { GetSchedule } from '@compass/contracts';

/** A write that was performed and confirmed by a successful GetSchedule read. */
export interface Confirmed<W> {
  write: W;
  confirmed: true;
  schedule: GetSchedule;
}

/** A write that succeeded but whose confirming GetSchedule read failed. */
export interface Unconfirmed<W> {
  write: W;
  confirmed: false;
}

/** The outcome of a confirmed write: either confirmed with a schedule, or not. */
export type ConfirmedWriteResult<W> = Confirmed<W> | Unconfirmed<W>;

/**
 * Perform a write and confirm it by reading the schedule back exactly once.
 *
 * - If `write` rejects, that error propagates and `getSchedule` is never called.
 * - If `write` resolves and `getSchedule` resolves, return both with confirmed true.
 * - If `write` resolves but `getSchedule` rejects, return confirmed false with the
 *   write result and never re-send the write.
 */
export async function confirmedWrite<W>(
  write: () => Promise<W>,
  getSchedule: () => Promise<GetSchedule>,
): Promise<ConfirmedWriteResult<W>> {
  // A write failure propagates; GetSchedule is not called.
  const writeResult = await write();
  try {
    const schedule = await getSchedule();
    return { write: writeResult, confirmed: true, schedule };
  } catch {
    // The write succeeded but could not be confirmed. Never re-send the write.
    return { write: writeResult, confirmed: false };
  }
}
