// CancelReservation operation (events-client, S1).
//
// Cancels one reserved session. Returns 204 with no body, treated as success with no
// validation (Requirement 6.7). Metered as an other-write (30 per minute) and
// follows the ordinary non-reserve retry policy.

import { executeOperation } from './execute-operation.js';
import { eventPath, segment } from './event-path.js';
import { assertNoBody } from './validate.js';
import type { ClientContext } from './transport.js';

/** Cancel the reservation for one session. */
export function cancelReservation(ctx: ClientContext, sessionId: string): Promise<void> {
  return executeOperation(
    ctx,
    {
      operation: 'CancelReservation',
      method: 'DELETE',
      path: eventPath(
        ctx,
        'CancelReservation',
        `/reservations/${segment('CancelReservation', sessionId)}`,
      ),
    },
    { units: 1 },
    (response) => {
      assertNoBody('CancelReservation', response.body);
    },
  );
}
