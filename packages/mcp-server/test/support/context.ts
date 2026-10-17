import { createSwapLedger } from '../../src/guardrail/swap-ledger.js';
import type { ToolContext } from '../../src/server/types.js';
import { createSessionState } from '../../src/state/session-state.js';
import type { SessionState } from '../../src/state/session-state.js';
import type { FakeRuntime } from './fake-runtime.js';

/** A tool context over a fake runtime, for calling handlers directly. */
export function contextFor(
  fake: FakeRuntime,
  options: { elicit?: ToolContext['elicit']; state?: SessionState } = {},
): ToolContext {
  return {
    runtime: fake.runtime,
    state: options.state ?? createSessionState(createSwapLedger(fake.clock)),
    ...(options.elicit === undefined ? {} : { elicit: options.elicit }),
  };
}
