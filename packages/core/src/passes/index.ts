// @compass/core/passes entry point (boarding-passes, S4).
//
// Owned by S4: the PassFields builder, the Compass API client, the issued-pass store
// and sync, the hand-off QR renders, the .ics calendar and the offline itinerary page.
// This subpath re-exports the S4 public surface by name. verbatimModuleSyntax is on, so
// runtime values use a plain export and type-only members use export type.
//
// Task 1 lands the foundation: the injected interface contracts, the owned data model
// shapes, the redaction helper and PassError, and the field hash. Later tasks add the
// components that build on them.

// Injected interface contracts (type-only).
export type {
  IdTokenProvider,
  ConnectionProvider,
  Clock,
  AppDataResolver,
  FileSystem,
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from './interfaces.js';

// S4-owned data model shapes (type-only).
export type {
  EventWindow,
  IssuedPass,
  IssuedPassRecord,
  ItineraryCommitment,
  Itinerary,
  IncludeFlags,
  SyncInput,
  BuildSession,
  AdjacentCommitment,
  AdjacentSession,
  BuildPassFn,
} from './models.js';

// Redaction helper and the shared error shape.
export { redact, passError, PassError } from './redaction.js';

// Field hash used by the sync diff.
export { fieldsHash } from './field-hash.js';

// Pass_Builder: builds validated PassFields from a confirmed session.
export { buildPass } from './pass-builder.js';
export type { BuildPassInput, BuildPassResult, BuildPassDeps } from './pass-builder.js';

// Compass_Client and the contract-typed response schemas.
export { createCompassClient, CompassError } from './compass-client.js';
export type {
  CompassClient,
  CompassClientOptions,
  UpdatePassResult,
  VoidPassResult,
  ForgetMeResult,
} from './compass-client.js';
export {
  IssuePassesResponseSchema,
  UpdatePassResponseSchema,
  VoidPassResponseSchema,
  CreateHandoffResponseSchema,
  ForgetMeResponseSchema,
} from './compass-api-schemas.js';
export type {
  IssuePassesRequest,
  IssuePassesResponse,
  UpdatePassResponse,
  VoidPassResponse,
  CreateHandoffRequest,
  CreateHandoffResponse,
  ForgetMeResponse,
} from './compass-api-schemas.js';

// Pass_Store and the per-OS app-data folder.
export {
  createAppDataResolver,
  createNodeAppDataResolver,
  joinInFolder,
  APP_FOLDER_NAME,
  RECORD_FILE_NAME,
  OUTPUT_FOLDER_NAME,
  CALENDAR_FILE_NAME,
  ITINERARY_FILE_NAME,
} from './app-data.js';
export type { AppDataEnvironment } from './app-data.js';
export { createPassStore, RECORD_FILE_MODE } from './pass-store.js';
export type { PassStore, PassStoreDeps } from './pass-store.js';

// Pass_Sync: the four-case diff and the sync driver.
export { diffSchedule, syncPasses, MAX_ISSUE_CHUNK } from './pass-sync.js';
export type { DiffCase, SyncPlanEntry, SyncResult, SyncDeps } from './pass-sync.js';

// The forgetMe orchestrator.
export { forgetMe } from './forget-me.js';
export type { ForgetMeDeps, ForgetMeOutcome } from './forget-me.js';
