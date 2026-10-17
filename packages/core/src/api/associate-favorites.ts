// AssociateFavorites operation (events-client, S1).
//
// Favorites 1 to 10 distinct sessions in one call. The input is guarded before any
// send (Requirement 10.1 to 10.3). Metered by the number of sessions (30 per
// minute). Unlike ReserveSessions, a favorite is a safe non-reservation write, so it
// follows the ordinary 401 refresh-and-retry and 429 wait-and-retry policy. The
// response is the validated BulkResult under result; the caller reads
// result.successful and result.failed, and any unrecognised failure code is a
// refusal (Requirements 10.4, 10.6).

import { executeOperation } from './execute-operation.js';
import { eventPath } from './event-path.js';
import { assertBulkInput } from './bulk-input.js';
import { validateBody } from './validate.js';
import { BulkWriteResultSchema } from './response-wrappers.js';
import { annotateBulkResult, type AnnotatedBulkWriteResult } from './bulk-failure-codes.js';
import type { ClientContext } from './transport.js';

/** Favorite 1 to 10 distinct sessions. The result reports per session. */
export function associateFavorites(
  ctx: ClientContext,
  sessionIds: readonly string[],
): Promise<AnnotatedBulkWriteResult> {
  assertBulkInput('AssociateFavorites', sessionIds);
  return executeOperation(
    ctx,
    {
      operation: 'AssociateFavorites',
      method: 'POST',
      path: eventPath(ctx, 'AssociateFavorites', '/favorites'),
      body: { sessionIds: [...sessionIds] },
    },
    { units: sessionIds.length },
    (response) =>
      annotateBulkResult(validateBody('AssociateFavorites', BulkWriteResultSchema, response.body)),
  );
}
