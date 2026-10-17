// Where focus goes after a demo action (showcase-site, QA M1).
//
// Most buttons stay where they are, and then focus stays on them. When an action removes the
// control that had focus (a panel closes, a step button is replaced by the next one, an item
// leaves the list), focus would fall back to the top of the page. This function names the element
// to focus instead, as an element id, or null when focus should stay where it is. The page
// gives those ids to: the verdict heading (verdict-title), the swap heading (swap-title), the
// button of the next swap step (swap-next), the Add button that ends a swap (swap-add), the
// heading "Your week" (demo-week) and each Remove button (remove-<key>).

import type { DemoAction, DemoState } from './demo-state';
import { commitmentRef } from './schedule';

const WEEK = 'demo-week';

function afterPanelClosed(after: DemoState): string {
  return after.swap === null ? WEEK : 'swap-title';
}

export function focusTargetAfter(
  action: DemoAction,
  before: DemoState,
  after: DemoState,
): string | null {
  switch (action.type) {
    case 'remove': {
      const at = before.commitments.findIndex((c) => commitmentRef(c) === action.ref);
      const near = after.commitments[at] ?? after.commitments[at - 1];
      if (at < 0 || after.commitments.length === before.commitments.length) {
        return null;
      }
      return near === undefined ? WEEK : `remove-${commitmentRef(near)}`;
    }
    case 'confirmWarn':
      return after.commitments.length > before.commitments.length ? WEEK : null;
    case 'dismiss':
      return before.pending === null && before.swap === null ? null : afterPanelClosed(after);
    case 'startSwap':
      return after.swap === null ? null : 'swap-title';
    case 'advanceSwap':
      return advanceTarget(before, after);
    case 'bookRepeat':
      return before.pending === null ? null : verdictOrWeek(after);
    case 'add':
      // The Add button inside a finished swap panel; the Add buttons of the list stay put.
      return before.swap === null ? null : verdictOrWeek(after);
    case 'addLayover':
      return after.commitments.length > before.commitments.length ? WEEK : null;
    case 'loadStarter':
    case 'reset':
    case 'selectPass':
      return null;
  }
}

function verdictOrWeek(after: DemoState): string {
  return after.pending === null ? WEEK : 'verdict-title';
}

function advanceTarget(before: DemoState, after: DemoState): string | null {
  const step = after.swap?.step;
  if (before.swap === null || step === undefined) {
    return before.swap === null ? null : WEEK;
  }
  return step === 'done' ? 'swap-add' : step === 'stopped' ? 'swap-title' : 'swap-next';
}
