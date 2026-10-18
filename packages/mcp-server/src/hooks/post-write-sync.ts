// The post-write sync hook (Requirement 19.5): after a call that changed the schedule, print a
// one-line reminder to run sync_passes. Any other tool, and any input that does not parse, gives
// no output. It always exits 0 and does nothing else.

import { exitCodeFor } from './exit-policy.js';
import type { HookDecision } from './exit-policy.js';
import { parseHookInput } from './hook-input.js';
import { identifyTool, SCHEDULE_WRITE_TOOLS } from './tool-names.js';

/** The reminder. */
export const SYNC_REMINDER =
  'Your schedule changed. Run sync_passes so your boarding passes match it.';

/** The post-write sync hook. */
export function postWriteSync(raw: string): HookDecision {
  const input = parseHookInput(raw);
  const identity = input === undefined ? undefined : identifyTool(input.tool_name);
  const changesSchedule =
    identity?.server === 'awsevents' ||
    (identity?.server === 'compass' &&
      (SCHEDULE_WRITE_TOOLS as readonly string[]).includes(identity.tool));
  return changesSchedule
    ? { exitCode: exitCodeFor('reminder'), stdout: SYNC_REMINDER }
    : { exitCode: exitCodeFor('silent') };
}
