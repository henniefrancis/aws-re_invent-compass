// Bulk write input guard for the Events API client (events-client, S1).
//
// Component 5 (input guard). ReserveSessions and AssociateFavorites accept a list of
// session ids. The Events API requires 1 to 10 distinct ids per call. This guard
// rejects an out-of-range or duplicate list with a typed ValidationError BEFORE the
// request is sent, so a malformed bulk request never reaches the network
// (Requirements 10.1, 10.2, 10.3). The error names only the operation and the reason
// category, never echoing the ids, so no id value leaks into an error.

import { assertSafeId } from './event-path.js';
import { ValidationError } from './errors.js';
import type { OperationName } from './transport.js';

/** The inclusive bounds on the number of session ids in a bulk request. */
export const MIN_BULK_IDS = 1;
export const MAX_BULK_IDS = 10;

/**
 * Assert that a bulk session-id list is valid: between 1 and 10 ids inclusive, all
 * distinct. Throws a ValidationError (before any send) otherwise. The operation is
 * included so the error names which bulk call was rejected.
 */
export function assertBulkInput(operation: OperationName, sessionIds: readonly string[]): void {
  if (sessionIds.length < MIN_BULK_IDS || sessionIds.length > MAX_BULK_IDS) {
    throw new ValidationError(
      operation,
      `${operation} requires between ${String(MIN_BULK_IDS)} and ${String(MAX_BULK_IDS)} session ids`,
    );
  }
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new ValidationError(operation, `${operation} requires all session ids to be distinct`);
  }
  for (const id of sessionIds) {
    assertSafeId(operation, id);
  }
}
