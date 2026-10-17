// Helpers for the demo tests: deps built on a test double engine, and a fold over actions.

import type { ContextInput, RulesEngine } from '../../src/lib/demo/rules-port';
import { createDemoRuntime, type DemoDeps } from '../../src/lib/demo/demo-deps';
import {
  EMPTY_DEMO,
  reduceDemo,
  type DemoAction,
  type DemoState,
} from '../../src/lib/demo/demo-state';
import { createFakeEngine } from '../doubles/rules-double';

export const VENUE_DATA = { venues: [], walkingTimes: [] } as unknown as ContextInput['venueData'];

/** Demo deps on a fake engine, with any function scripted. */
export function makeDeps(overrides: Partial<RulesEngine> = {}): DemoDeps {
  const deps = createDemoRuntime(createFakeEngine(overrides), VENUE_DATA);
  if (deps === null) {
    throw new Error('The fake engine should be ready.');
  }
  return deps;
}

/** The states after each action, starting from the given state. */
export function runStates(
  actions: readonly DemoAction[],
  deps: DemoDeps,
  start: DemoState = EMPTY_DEMO,
): DemoState[] {
  const states: DemoState[] = [];
  let state = start;
  for (const action of actions) {
    state = reduceDemo(state, action, deps);
    states.push(state);
  }
  return states;
}

/** The state after all actions. */
export function run(
  actions: readonly DemoAction[],
  deps: DemoDeps,
  start: DemoState = EMPTY_DEMO,
): DemoState {
  return runStates(actions, deps, start).at(-1) ?? start;
}

/** The session ids of the reserved sessions in a state, in order. */
export function heldIds(state: DemoState): string[] {
  return state.commitments.flatMap((c) => (c.kind === 'reservedSession' ? [c.sessionId] : []));
}
