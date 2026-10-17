// DisassociateFavorite operation (events-client, S1).
//
// Removes one favorite. Returns 204 with no body, treated as success with no
// validation (Requirement 6.7). Metered as an other-write (30 per minute) and
// follows the ordinary non-reserve retry policy.

import { executeOperation } from './execute-operation.js';
import { eventPath, segment } from './event-path.js';
import { assertNoBody } from './validate.js';
import type { ClientContext } from './transport.js';

/** Remove one session from the attendee's favorites. */
export function disassociateFavorite(ctx: ClientContext, sessionId: string): Promise<void> {
  return executeOperation(
    ctx,
    {
      operation: 'DisassociateFavorite',
      method: 'DELETE',
      path: eventPath(ctx, `/favorites/${segment(sessionId)}`),
    },
    { units: 1 },
    (response) => {
      assertNoBody('DisassociateFavorite', response.body);
    },
  );
}
