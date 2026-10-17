// Rules_Port (showcase-site, Component 5).
//
// The one module of the site that imports the rules engine, `@compass/core/rules` (S2). Every
// other site module reaches the engine through the RulesPort made here, so the demo
// reimplements no rule: boarding, connection, clash, layover, rebooking and swap results all
// come from the engine.
//
// The result types below are written out from the S2 design (structural, so the real engine
// satisfies them and a test double can stand in for it). The engine is imported by name, so the
// bundler keeps only the functions the demo calls.
//

import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';
import {
  checkLayovers,
  checkReservation,
  computeBoarding,
  connectionsForDay,
  findClashes,
  findRebookingOptions,
  planSafeSwap,
  withContextDefaults,
} from '@compass/core/rules';

export type { Context, ContextInput, ScheduleInput } from '@compass/core/rules';
import type { Context, ContextInput, ScheduleInput } from '@compass/core/rules';

// The result types are the engine's own.
export type {
  BoardingResult,
  ClashPair,
  ClashReport,
  ConnectionClass,
  ConnectionResult,
  DayConnection,
  DayConnections,
  DayLayover,
  LayoverReport,
  RebookOption,
  RebookResult,
  SuggestedBlock,
  SwapPlan,
  SwapStep,
} from '@compass/core/rules';
import type {
  BoardingResult,
  ClashReport,
  DayConnections,
  LayoverReport,
  RebookResult,
  SwapPlan,
} from '@compass/core/rules';

/** The functions of `@compass/core/rules` that the site calls. */
export interface RulesEngine {
  checkReservation(
    candidate: NormalisedSession,
    schedule: ScheduleInput,
    context: Context,
  ): Verdict;
  computeBoarding(session: NormalisedSession, context: Context): BoardingResult;
  connectionsForDay(schedule: ScheduleInput, context: Context, day?: string): DayConnections;
  findClashes(schedule: ScheduleInput, context: Context): ClashReport;
  checkLayovers(schedule: ScheduleInput, context: Context, onlyDay?: string): LayoverReport;
  findRebookingOptions(
    baseCode: string,
    candidates: readonly NormalisedSession[],
    favorites: readonly NormalisedSession[],
    context: Context,
  ): RebookResult;
  planSafeSwap(
    original: Commitment,
    repeat: NormalisedSession,
    confirmationSchedule: ScheduleInput,
    context: Context,
  ): SwapPlan;
  withContextDefaults(input: ContextInput): Context;
}

/** What the site calls: the engine without the context builder. */
export type RulesPort = Omit<RulesEngine, 'withContextDefaults'>;

/** The real engine, as far as the types go. See the note at the top of this file. */
export const REAL_ENGINE: Partial<RulesEngine> = {
  checkReservation,
  computeBoarding,
  connectionsForDay,
  findClashes,
  checkLayovers,
  findRebookingOptions,
  planSafeSwap,
  withContextDefaults,
};

const ENGINE_FUNCTIONS = [
  'checkReservation',
  'computeBoarding',
  'connectionsForDay',
  'findClashes',
  'checkLayovers',
  'findRebookingOptions',
  'planSafeSwap',
  'withContextDefaults',
] as const;

/** True when the engine provides every function the site calls. */
export function isRulesEngineReady(engine: Partial<RulesEngine>): engine is RulesEngine {
  return ENGINE_FUNCTIONS.every((name) => typeof engine[name] === 'function');
}

/** The port the demo calls. Every method hands straight to the engine. */
export function createRulesPort(engine: RulesEngine): RulesPort {
  return {
    checkReservation: (candidate, schedule, context) =>
      engine.checkReservation(candidate, schedule, context),
    computeBoarding: (session, context) => engine.computeBoarding(session, context),
    connectionsForDay: (schedule, context, day) => engine.connectionsForDay(schedule, context, day),
    findClashes: (schedule, context) => engine.findClashes(schedule, context),
    checkLayovers: (schedule, context, onlyDay) => engine.checkLayovers(schedule, context, onlyDay),
    findRebookingOptions: (baseCode, candidates, favorites, context) =>
      engine.findRebookingOptions(baseCode, candidates, favorites, context),
    planSafeSwap: (original, repeat, confirmationSchedule, context) =>
      engine.planSafeSwap(original, repeat, confirmationSchedule, context),
  };
}

/** The demo context: the engine defaults, the fixed demo instant, the event zone and venues. */
export function createDemoContext(engine: RulesEngine, input: ContextInput): Context {
  return engine.withContextDefaults(input);
}
