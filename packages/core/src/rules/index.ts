// @compass/core/rules entry point (itinerary-rules, S2).
//
// The pure, browser-safe itinerary rules engine. The MCP server, the Kiro hook and the
// showcase site all reach it through this subpath. It performs no input or output, reads no
// clock and imports nothing from Node built-in modules.
//
// This is the deliberate public surface of the rules subpath: every export is listed by name.
// Internal helpers (time.ts, reasons.ts, and the lookup code in venue-data.ts and resolve.ts)
// are not exported. resolveCommitment and withContextDefaults are exported so a caller can build
// the resolved view that classifyConnection takes, and a complete Context, without re-deriving
// either.

// The guardrail and the rule functions.
export { checkReservation } from './check-reservation.js';
export { computeBoarding, boardingFor } from './boarding.js';
export { classifyConnection } from './connections.js';
export { findClashes } from './clashes.js';
export { checkLayovers } from './layovers.js';
export { isOverloaded } from './energy.js';
export { findRebookingOptions } from './rebooking.js';
export { planSafeSwap } from './safe-swap.js';

// Building the inputs: the resolved view, the context and its defaults, and venue data.
export { resolveCommitment } from './resolve.js';
export { ContextSchema, CONTEXT_DEFAULTS, withContextDefaults } from './context.js';
export { VenueDataSchema, validateVenueData } from './venue-data.js';

// Types.
export type {
  Context,
  ContextInput,
  MealWindow,
  SourceNote,
  VenueData,
  VenueEntry,
  WalkingEdge,
} from './context.js';
export type { ResolvedCommitment, ScheduleInput, SessionsLookup } from './resolve.js';
export type { BoardingInput, BoardingResult } from './boarding.js';
export type { ConnectionClass, ConnectionResult } from './connections.js';
export type { ClashPair, ClashReport } from './clashes.js';
export type { DayLayover, LayoverReport, SuggestedBlock } from './layovers.js';
export type { OverloadResult } from './energy.js';
export type { RebookOption, RebookResult } from './rebooking.js';
export type { SwapPlan, SwapStep } from './safe-swap.js';
export type { VenueDataValidation } from './venue-data.js';
