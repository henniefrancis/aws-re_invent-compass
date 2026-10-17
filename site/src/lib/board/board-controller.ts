// Board controller (showcase-site, Component 13b, CTO H4).
//
// The whole /board flow lives here, behind injected browser functions, so it is unit tested at
// 100 percent. The page component only wires up the browser globals and renders the view model.
//
// The flow:
//   1. start() reads the URL hash once.
//   2. It removes the fragment from the address bar (replaceState to /board) BEFORE any
//      request is made, whether or not the fragment was valid.
//   3. An invalid fragment ends in the Invalid_Link state and sends no request.
//   4. A valid one sends exactly one request. The id stays in a private variable.
//   5. retry() sends exactly one more request, and only from Unavailable or Rate_Limited.
//   6. One expiry timer switches Ready to Expired when the device clock reaches expiresAt.
//
// Nothing here logs, stores or shares the id.

import {
  INITIAL_BOARD_STATE,
  canRetry,
  msUntilExpiry,
  reduceBoard,
  type BoardEvent,
  type BoardState,
} from './board-state';
import { parseBoardFragment, type HandoffId } from './fragment';
import {
  HANDOFF_TIMEOUT_MS,
  fetchHandoff,
  type ClearTimer,
  type FetchLike,
  type SetTimer,
  type TimerHandle,
} from './handoff-client';
import { validateHandoffView } from './handoff-view';

/** The largest delay a browser timer accepts (2^31 - 1 ms). Longer waits are done in steps. */
export const MAX_TIMER_MS = 2_147_483_647;

export const BOARD_PATH = '/board';

export interface BoardControllerDeps {
  readonly readHash: () => string;
  readonly replaceState: (path: string) => void;
  readonly fetch: FetchLike;
  readonly setTimer: SetTimer;
  readonly clearTimer: ClearTimer;
  readonly now: () => number;
  /** Called after every state change. */
  readonly onChange: (state: BoardState) => void;
  /** Called when the page wakes up, so the text that depends on the time can be refreshed. */
  readonly onRefresh: () => void;
  /** Tell the listener whenever the page becomes visible or is shown again; returns the stop function. */
  readonly subscribeVisible: (listener: () => void) => () => void;
}

export interface BoardController {
  start(): Promise<void>;
  retry(): Promise<void>;
  dispose(): void;
  state(): BoardState;
}

export function createBoardController(deps: BoardControllerDeps): BoardController {
  let current: BoardState = INITIAL_BOARD_STATE;
  let id: HandoffId | null = null;
  let expiryTimer: TimerHandle;
  let hasTimer = false;
  let started = false;
  let disposed = false;
  let stopWatching: (() => void) | null = null;

  const clearExpiry = (): void => {
    if (hasTimer) {
      deps.clearTimer(expiryTimer);
      hasTimer = false;
    }
  };

  const scheduleExpiry = (): void => {
    clearExpiry();
    if (current.kind === 'ready') {
      const wait = Math.min(Math.max(msUntilExpiry(current.handoff, deps.now()), 0), MAX_TIMER_MS);
      expiryTimer = deps.setTimer(() => {
        hasTimer = false;
        dispatch({ type: 'clock', nowMs: deps.now() });
      }, wait);
      hasTimer = true;
    }
  };

  const dispatch = (event: BoardEvent): void => {
    if (disposed) {
      return;
    }
    const next = reduceBoard(current, event);
    if (next !== current) {
      current = next;
      scheduleExpiry();
      deps.onChange(current);
    } else if (current.kind === 'ready' && event.type === 'clock') {
      // The timer fired early because a long wait was done in steps: wait again.
      scheduleExpiry();
    }
  };

  const request = async (): Promise<void> => {
    dispatch({ type: 'requestStarted' });
    const outcome = await fetchHandoff(id as HandoffId, {
      fetch: deps.fetch,
      timeoutMs: HANDOFF_TIMEOUT_MS,
      setTimer: deps.setTimer,
      clearTimer: deps.clearTimer,
    });
    const validated =
      outcome.kind === 'ok' ? validateHandoffView(outcome.body, id as HandoffId) : null;
    dispatch({ type: 'outcome', outcome, validated, nowMs: deps.now() });
  };

  return {
    async start() {
      if (started) {
        return;
      }
      started = true;
      const result = parseBoardFragment(deps.readHash());
      deps.replaceState(BOARD_PATH);
      dispatch({ type: 'fragmentRead', result });
      if (result.ok) {
        id = result.id;
        // Check the expiry again whenever the page wakes up.
        stopWatching = deps.subscribeVisible(() => {
          dispatch({ type: 'clock', nowMs: deps.now() });
          deps.onRefresh();
        });
        await request();
      }
    },
    async retry() {
      if (id !== null && canRetry(current)) {
        await request();
      }
    },
    dispose() {
      disposed = true;
      stopWatching?.();
      clearExpiry();
    },
    state() {
      return current;
    },
  };
}
