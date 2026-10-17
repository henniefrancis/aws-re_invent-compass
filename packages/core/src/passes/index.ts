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
