// Client-side quota tracker for the Events API client (events-client, S1).
//
// Component 7 in the design. The Events API enforces per-attendee, per-minute limits
// (tech steering, checked 15 October 2026). This tracker mirrors those limits on the
// client so a call that would exceed a limit is refused before it is sent, rather
// than being throttled by the server. It also honours a server 429: after one, the
// next call of that operation is blocked until the Retry-After duration has elapsed.
//
// Model: a rolling one-minute window per operation, measured in seconds from the
// first counted call of that operation. When the window elapses the count resets to
// zero. check(op, units, now) reports whether adding `units` would exceed the limit;
// record(op, units, now) commits the units; note429(op, retryAfterSeconds, now)
// blocks the next call until the wait has elapsed.
//
// Limits (per minute): GetSession 120, ListSessions 120, GetSchedule 60,
// ReserveSessions 30 counted sessions, AssociateFavorites 30 counted sessions, every
// other write 30. ListEvents and GetEvent are unmetered: never counted, never
// blocked (Requirement 12).

import type { OperationName, QuotaTracker } from './transport.js';

/** The result of a quota check: either allowed, or blocked until the window resets. */
export type QuotaDecision = 'allow' | 'blocked-until-reset';

export type { QuotaTracker };

/** One rolling minute in milliseconds. `now` values are epoch milliseconds. */
const WINDOW_MS = 60_000;

/**
 * Per-operation limits. An operation absent from this map is unmetered (ListEvents
 * and GetEvent): it is never counted and never blocked. Every write not named
 * explicitly falls back to the default write limit of 30.
 */
const LIMITS: Partial<Record<OperationName, number>> = {
  GetSession: 120,
  ListSessions: 120,
  GetSchedule: 60,
  ReserveSessions: 30,
  AssociateFavorites: 30,
  CancelReservation: 30,
  DisassociateFavorite: 30,
  CreatePersonalTime: 30,
  UpdatePersonalTime: 30,
  DeletePersonalTime: 30,
};

/** Per-operation rolling-window state. */
interface WindowState {
  /** Epoch ms when the current window started (the first counted call). */
  windowStart: number;
  /** Units counted in the current window. */
  count: number;
  /** Epoch ms before which the operation is blocked by a prior 429, or 0 if none. */
  blockedUntil: number;
}

/**
 * Create a quota tracker. State is held per operation in a map; unmetered operations
 * never acquire an entry.
 */
export function createQuotaTracker(): QuotaTracker {
  const windows = new Map<OperationName, WindowState>();

  // Return the live state for an operation, resetting the window if the current one
  // has elapsed. Unmetered operations have a state too: it carries only the 429 block.
  function stateFor(op: OperationName, now: number): WindowState {
    let state = windows.get(op);
    if (state === undefined) {
      state = { windowStart: now, count: 0, blockedUntil: 0 };
      windows.set(op, state);
    } else if (now - state.windowStart >= WINDOW_MS) {
      // The window elapsed: reset the count and start a fresh window.
      state.windowStart = now;
      state.count = 0;
    }
    return state;
  }

  return {
    check(op, units, now) {
      const state = stateFor(op, now);
      // A prior 429 blocks the next call until its Retry-After has elapsed.
      if (now < state.blockedUntil) {
        return 'blocked-until-reset';
      }
      // Unmetered operations have no per-minute limit, only the 429 block above.
      if (state.count + units > (LIMITS[op] ?? Number.POSITIVE_INFINITY)) {
        return 'blocked-until-reset';
      }
      return 'allow';
    },
    record(op, units, now) {
      stateFor(op, now).count += units;
    },
    note429(op, retryAfterSeconds, now) {
      stateFor(op, now).blockedUntil = now + retryAfterSeconds * 1000;
    },
  };
}
