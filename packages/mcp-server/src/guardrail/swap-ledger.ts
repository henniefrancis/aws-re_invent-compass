// The Pending_Swap ledger (Requirement 13, design Component 7). In memory only: a swap is
// cleared when it completes, when it is dropped, or when the server exits.
//
// A swap records "hold a repeat of an original session, then cancel the original". The
// first cancel of the original that the safety check refuses is marked with its time, so a
// second cancel can be honoured only inside a short window or after an explicit confirm.

import type { Clock } from '../ports/clock.js';

/** One proposed swap. */
export interface PendingSwap {
  originalId: string;
  repeatId: string;
  blockedId: string;
  createdAt: string;
  /** Set when the first cancel of the original was refused. */
  refusedAt?: string;
}

/** The ledger. */
export interface SwapLedger {
  propose(swap: { originalId: string; repeatId: string; blockedId: string }): void;
  forOriginal(originalId: string): PendingSwap | undefined;
  markRefused(originalId: string): void;
  clear(originalId: string): void;
  clearAll(): void;
}

/** Creates an empty in-memory ledger. */
export function createSwapLedger(clock: Clock): SwapLedger {
  const swaps = new Map<string, PendingSwap>();
  return {
    propose: (swap) => {
      swaps.set(swap.originalId, { ...swap, createdAt: clock.now().toISOString() });
    },
    forOriginal: (originalId) => {
      const swap = swaps.get(originalId);
      return swap === undefined ? undefined : { ...swap };
    },
    markRefused: (originalId) => {
      const swap = swaps.get(originalId);
      if (swap !== undefined) {
        swap.refusedAt = clock.now().toISOString();
      }
    },
    clear: (originalId) => {
      swaps.delete(originalId);
    },
    clearAll: () => {
      swaps.clear();
    },
  };
}
