// Wire schemas for the Events API BulkFailureCode, BulkFailure and BulkResult
// (foundation-contracts, S0). These mirror the official Events API OpenAPI document
// (packages/contracts/events-api.openapi.json) exactly. A bulk request (reserve,
// favorite) reports per session: a 200 can still hold failures, so the caller reads
// failed as well as successful.
//
// Cross-cutting rules applied here (see design, Data Models):
//   1. Defensive parsing by stripping. Plain z.object strips unknown fields.
//   2. No coercion. A present field with the wrong type is rejected, not coerced.
//   3. Enum forward-compatibility. BulkFailureCode is a stable value safe to branch
//      on, but values are added as the platform grows. An unrecognised code is kept
//      as an unrecognised refusal: the original string is preserved as-is, not
//      collapsed to a sentinel and not rejected. A wrong type (non-string) is still
//      rejected. This differs from seatAvailability, which maps unknown strings to
//      the sentinel "unknown".
import { z } from 'zod';

// The nine known bulk failure codes from the Events API BulkFailureCode enum.
const KNOWN_BULK_FAILURE_CODES = [
  'sessionNotReservable',
  'scheduleConflict',
  'alreadyScheduled',
  'sessionFull',
  'insufficientAccess',
  'timePassed',
  'alreadyFavorited',
  'notFavorited',
  'other',
] as const;

/**
 * Why one session in a bulk request was refused. One of the nine known codes, or any
 * other string the Events API adds later, preserved as-is so the client can treat it
 * as a generic refusal. The (string & {}) member keeps the schema open while editors
 * still surface the known literals.
 */
export type BulkFailureCode = (typeof KNOWN_BULK_FAILURE_CODES)[number] | (string & {});

/**
 * Forward-compatible BulkFailureCode schema.
 *
 * The schema is z.string(), so a non-string input (number, boolean, object) is
 * rejected: there is no coercion. Any string, known or not, parses to itself: a known
 * code is returned unchanged and an unrecognised code is kept as the unrecognised
 * refusal rather than being dropped or collapsed to a sentinel.
 */
export const BulkFailureCodeSchema = z.string() as z.ZodType<BulkFailureCode, string>;

/**
 * One session a bulk request was refused for. sessionId and code are required.
 * conflictsWith lists the caller's already-scheduled sessions that overlap this one,
 * present only when the refusal was a time clash. Unknown fields are stripped.
 */
export const BulkFailureSchema = z.object({
  sessionId: z.string(),
  code: BulkFailureCodeSchema,
  conflictsWith: z.array(z.string()).optional(),
});

export type BulkFailure = z.infer<typeof BulkFailureSchema>;

/**
 * The outcome of a bulk request, which can succeed for some sessions and fail for
 * others. Both arrays are required and present even when empty: successful holds the
 * session ids the request was applied to, failed holds one BulkFailure per refused
 * session. Unknown fields are stripped.
 */
export const BulkResultSchema = z.object({
  successful: z.array(z.string()),
  failed: z.array(BulkFailureSchema),
});

export type BulkResult = z.infer<typeof BulkResultSchema>;
