// Known bulk failure codes and failure classification (events-client, S1).
//
// Component 5 (failure codes). The known BulkFailureCode list is maintained HERE in
// core/src/api and checked against the generated EventsApi BulkFailureCode type at
// compile time in BOTH directions (Requirement 10.5): the known list must be
// assignable to the generated type, and the generated type must be assignable to the
// known list. If either side drifts (the API adds or removes a code, or this list
// does), one of the assignability checks below fails the build.
//
// At runtime a per-session failure whose code is not in the known list is classified
// as an unrecognised refusal: it is reported as a refusal, never as a success or a
// safe retry (Requirement 10.6). packages/contracts is never edited; the known list
// lives here by design.

import type { EventsApi, BulkFailure } from '@compass/contracts';

/**
 * The nine known bulk failure codes, maintained in this stream. Declared `as const`
 * so the element type is the exact string-literal union.
 */
export const KNOWN_BULK_FAILURE_CODES = [
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

/** The literal-union type of the known codes. */
export type KnownBulkFailureCode = (typeof KNOWN_BULK_FAILURE_CODES)[number];

/** The generated BulkFailureCode type from the official Events API OpenAPI document. */
type GeneratedBulkFailureCode = EventsApi.components['schemas']['BulkFailureCode'];

// Bidirectional compile-time assertion. AssertAssignable<A, B> is only a valid type
// when A extends B; using it in both directions proves the known list and the
// generated enum are the same set. A drift on either side turns one of these into a
// type error and fails the build. These aliases are types only and emit no runtime
// code.
type AssertAssignable<A extends B, B> = A;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _KnownAreGenerated = AssertAssignable<KnownBulkFailureCode, GeneratedBulkFailureCode>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _GeneratedAreKnown = AssertAssignable<GeneratedBulkFailureCode, KnownBulkFailureCode>;

/** The classification of a per-session bulk failure. */
export type FailureClassification = 'known' | 'unrecognised-refusal';

// A runtime set for the membership test.
const KNOWN_SET = new Set<string>(KNOWN_BULK_FAILURE_CODES);

/**
 * Classify a per-session failure. A failure whose code is one of the known codes is
 * `known`; any other code is an `unrecognised-refusal`, which the caller reports as a
 * refusal and never as a success or a safe retry.
 */
export function classifyFailure(failure: BulkFailure): FailureClassification {
  return KNOWN_SET.has(failure.code) ? 'known' : 'unrecognised-refusal';
}
