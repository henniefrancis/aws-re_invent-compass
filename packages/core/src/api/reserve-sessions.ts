// ReserveSessions operation (events-client, S1).
//
// Reserves 1 to 10 distinct sessions in one call. The input is guarded before any
// send (Requirement 10.1 to 10.3). Metered by the number of sessions (30 per
// minute). ReserveSessions is never automatically re-sent: the retry policy fails
// after one refresh on a 401 and fails on 429 or 5xx (Requirements 9, design
// Component 3), so a reservation is sent at most once. The response is the validated
// BulkResult under result; the caller reads result.successful and result.failed, and
// any unrecognised failure code is a refusal (Requirements 10.4, 10.6).

import { executeOperation } from './execute-operation.js';
import { eventPath } from './event-path.js';
import { assertBulkInput } from './bulk-input.js';
import { validateBody } from './validate.js';
import { BulkWriteResultSchema } from './response-wrappers.js';
import { annotateBulkResult, type AnnotatedBulkWriteResult } from './bulk-failure-codes.js';
import type { ClientContext } from './transport.js';

/** Reserve 1 to 10 distinct sessions. The result reports per session. */
export function reserveSessions(
  ctx: ClientContext,
  sessionIds: readonly string[],
): Promise<AnnotatedBulkWriteResult> {
  assertBulkInput('ReserveSessions', sessionIds);
  return executeOperation(
    ctx,
    {
      operation: 'ReserveSessions',
      method: 'POST',
      path: eventPath(ctx, 'ReserveSessions', '/reservations'),
      body: { sessionIds: [...sessionIds] },
    },
    { units: sessionIds.length },
    (response) =>
      annotateBulkResult(validateBody('ReserveSessions', BulkWriteResultSchema, response.body)),
  );
}
