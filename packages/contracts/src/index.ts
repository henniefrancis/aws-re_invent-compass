// @compass/contracts public surface (foundation-contracts, S0).
//
// This is the single shared contracts entry point and the deliberate PUBLIC
// SURFACE of the package: every wire schema, domain type, the PassFields factory,
// the Problem error, the MCP tool schemas and the generated OpenAPI type
// namespaces are re-exported here by name. It is not a core-style barrel of
// barrels; contracts is intentionally one public entry re-exporting named members
// so the surface stays auditable.
//
// verbatimModuleSyntax is on, so runtime values use a plain `export` and inferred
// types use `export type`. Imports use .js specifiers under nodenext resolution.

// Wire schemas (runtime values) and their inferred types: Session.
export { SessionWireSchema, SessionTimeSchema, SeatAvailabilitySchema } from './wire/session.js';
export type { SessionWire, SessionTime, SeatAvailability } from './wire/session.js';

// Wire schemas and types: Schedule and the list and get response envelopes.
export {
  ScheduleWireSchema,
  ListSessionsSchema,
  GetSessionSchema,
  GetScheduleSchema,
} from './wire/schedule.js';
export type { ScheduleWire, ListSessions, GetSession, GetSchedule } from './wire/schedule.js';

// Wire schemas and types: PersonalTime and PersonalTimeInput.
export { PersonalTimeSchema, PersonalTimeInputSchema } from './wire/personal-time.js';
export type { PersonalTime, PersonalTimeInput } from './wire/personal-time.js';

// Wire schema and type: Event.
export { EventSchema } from './wire/event.js';
export type { Event } from './wire/event.js';

// Wire schemas and types: BulkResult, BulkFailure and BulkFailureCode.
export { BulkResultSchema, BulkFailureSchema, BulkFailureCodeSchema } from './wire/bulk-result.js';
export type { BulkResult, BulkFailure, BulkFailureCode } from './wire/bulk-result.js';

// Domain schemas (runtime values) and their inferred types.
export { NormalisedSessionSchema } from './domain/normalised-session.js';
export type { NormalisedSession } from './domain/normalised-session.js';

export { CommitmentSchema } from './domain/commitment.js';
export type { Commitment } from './domain/commitment.js';

export { VenueSchema } from './domain/venue.js';
export type { Venue } from './domain/venue.js';

export { VerdictSchema } from './domain/verdict.js';
export type { Verdict } from './domain/verdict.js';

// PassFields factory (runtime value), the normalise helper, its inferred type and
// the factory options.
export { createPassFieldsSchema, normalisePassText } from './pass-fields.js';
export type { PassFields, CreatePassFieldsSchemaOptions } from './pass-fields.js';

// Problem error schema (runtime value) and its inferred type.
export { ProblemSchema } from './problem.js';
export type { Problem } from './problem.js';

// MCP tool schemas (runtime value) and the tool name and input and output types.
export { mcpTools } from './mcp-tools.js';
export type { McpToolName, McpToolInput, McpToolOutput } from './mcp-tools.js';

// Generated OpenAPI type namespaces.
//
// The Events API generated types exist now and are re-exported as a single
// namespace so consumers can reach every generated member (components, paths,
// operations and so on) through one name.
export type * as EventsApi from './generated/events-api.js';

// The Compass API generated types (components and paths) will be re-exported here
// in task 7.2 once packages/contracts/src/generated/compass-api.ts is generated
// from the single-source Compass API OpenAPI document. It is deliberately not
// referenced yet so this public surface compiles before that file exists.
