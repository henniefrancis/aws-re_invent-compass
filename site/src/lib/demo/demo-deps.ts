// What the demo logic needs to run (showcase-site, Component 7): the rules port, the demo
// catalog by session id, and the demo context. Built once by createDemoRuntime.

import type { NormalisedSession } from '@compass/contracts';
import { DEMO_EVENT, DEMO_SESSIONS } from './demo-catalog';
import {
  createDemoContext,
  createRulesPort,
  isRulesEngineReady,
  type Context,
  type ContextInput,
  type RulesEngine,
  type RulesPort,
} from './rules-port';

export interface DemoDeps {
  readonly rules: RulesPort;
  readonly catalog: ReadonlyMap<string, NormalisedSession>;
  readonly context: Context;
}

/**
 * The deps for the live demo, or null while the engine or the venue data is not available.
 * The page then says that the demo cannot run. The demo logic never reads the system clock:
 * the context carries the fixed demo instant.
 */
export function createDemoRuntime(
  engine: Partial<RulesEngine>,
  venueData: unknown,
): DemoDeps | null {
  if (!isRulesEngineReady(engine) || venueData === null) {
    return null;
  }
  return {
    rules: createRulesPort(engine),
    catalog: new Map(DEMO_SESSIONS.map((session) => [session.sessionId, session])),
    context: createDemoContext(engine, {
      now: DEMO_EVENT.now,
      eventTimezone: DEMO_EVENT.timezone,
      venueData: venueData as ContextInput['venueData'],
    }),
  };
}
