// In-memory session state (design, Component 10): the last scan result and its taxonomy
// matches, and the Pending_Swap ledger. Nothing here is written to disk.

import type { ScanResult, TaxonomyMatch } from '@compass/core/scanner';
import type { SwapLedger } from '../guardrail/swap-ledger.js';

/** The last successful scan in this server session. */
export interface LastScan {
  result: ScanResult;
  taxonomy: TaxonomyMatch[];
  /** The resolved folder that was scanned. */
  root: string;
}

/** State shared by the tool handlers for the life of the server. */
export interface SessionState {
  lastScan?: LastScan;
  swaps: SwapLedger;
  /** The Workspace_Root: the last scanned folder, otherwise `cwd`. */
  workspaceRoot(cwd: string): string;
}

/** Creates empty session state around a ledger. */
export function createSessionState(swaps: SwapLedger): SessionState {
  const state: SessionState = {
    swaps,
    workspaceRoot: (cwd) => state.lastScan?.root ?? cwd,
  };
  return state;
}
