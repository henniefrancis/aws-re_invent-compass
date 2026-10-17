// Rules_Port (showcase-site, Component 5).
//
// The one module of the site that imports the rules engine, `@compass/core/rules` (S2). Every
// other site module reaches the engine through the RulesPort made here, so the demo
// reimplements no rule: boarding, connection, clash, layover, rebooking and swap results all
// come from the engine.
//
// The result types below are written out from the committed S2 design (the engine is not
// merged into this branch yet, and its module is still empty here). They are structural, so
// the real engine satisfies them and a test double can stand in for it.
//
// WHEN S2 IS MERGED (Integrator note, see tasks.md):
//   1. Replace the cast on REAL_ENGINE with named imports of the eight functions, so the
//      bundler can drop the engine code the demo does not use (a namespace object keeps all
//      of it, including the zod schemas), then check the Budget_Check.
//   2. Optionally replace the local result types with ReturnType and Parameters of the real
//      functions.

import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';
import * as rulesModule from '@compass/core/rules';

/** The rules engine context. The site builds one with the engine's own defaults. */
export type Context = Readonly<Record<string, unknown>>;

export interface ContextInput {
  readonly now: string;
  readonly eventTimezone?: string;
  readonly venueData: unknown;
}

export interface ScheduleInput {
  readonly commitments: readonly Commitment[];
  readonly sessions: Readonly<Record<string, NormalisedSession>>;
}

export type BoardingResult =
  | { readonly status: 'closes'; readonly at: string; readonly reason: string }
  | { readonly status: 'notApplicable'; readonly reason: string }
  | { readonly status: 'unknown'; readonly reason: string };

export type ConnectionClass = 'comfortable' | 'tight' | 'impossible' | 'unknown';

export interface ConnectionResult {
  readonly classification: ConnectionClass;
  /** The walk plus the buffer, in minutes. Absent when the connection is unknown. */
  readonly walkingMinutes?: number;
  readonly spareMinutes?: number;
  readonly reason: string;
}

export interface DayConnection {
  readonly from: string;
  readonly to: string;
  readonly result: ConnectionResult;
}

export type DayConnections =
  | {
      readonly status: 'ok';
      readonly connections: readonly DayConnection[];
      readonly skipped: readonly { readonly ref: string; readonly reason: string }[];
    }
  | { readonly status: 'unknown'; readonly reason: string };

export interface ClashPair {
  readonly a: string;
  readonly b: string;
  readonly overlap: string;
  readonly reason: string;
  /** Positions in the commitments of the schedule that was checked. */
  readonly aIndex: number;
  readonly bIndex: number;
}

export type ClashReport =
  | {
      readonly status: 'ok';
      readonly clashes: readonly ClashPair[];
      readonly unknown: readonly unknown[];
    }
  | { readonly status: 'unknown'; readonly reason: string };

export interface SuggestedBlock {
  readonly start: string;
  readonly end: string;
  readonly reason: string;
}

export interface DayLayover {
  /** The event local day, YYYY-MM-DD. */
  readonly day: string;
  readonly mealLayoverMissing: boolean;
  readonly freeMealMinutes: number;
  readonly longStretchMinutes?: number;
  readonly reasons: readonly string[];
  readonly suggestions: readonly SuggestedBlock[];
  readonly noPlacementReason?: string;
}

export type LayoverReport =
  | {
      readonly status: 'ok';
      readonly days: readonly DayLayover[];
      readonly skipped: readonly unknown[];
    }
  | { readonly status: 'unknown'; readonly reason: string };

export interface RebookOption {
  readonly kind: 'repeat' | 'standby' | 'walkUp';
  readonly sessionId: string;
  readonly startsAt: string;
  readonly reason: string;
}

export interface RebookResult {
  readonly status: 'ok' | 'unknown';
  readonly options: readonly RebookOption[];
  readonly message: string;
}

export interface SwapStep {
  readonly order: 1 | 2 | 3;
  readonly action: 'reserveRepeat' | 'confirmHeld' | 'cancelOriginal';
  readonly blockedUntilConfirmed: boolean;
  readonly reason: string;
}

export interface SwapPlan {
  readonly outcome: 'safe' | 'unsafe' | 'failed';
  readonly steps: readonly SwapStep[];
  readonly clashesWith: readonly string[];
  readonly reason: string;
}

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
function asEngine(module: object): Partial<RulesEngine> {
  return module;
}

export const REAL_ENGINE: Partial<RulesEngine> = asEngine(rulesModule);

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
