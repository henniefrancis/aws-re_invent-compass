// DeletePersonalTime operation (events-client, S1).
//
// Removes a personal time block by id. Returns 204 with no body, treated as success
// with no validation (Requirement 6.7). Metered as an other-write (30 per minute)
// and follows the ordinary non-reserve retry policy.

import { executeOperation } from './execute-operation.js';
import { eventPath, segment } from './event-path.js';
import { assertNoBody } from './validate.js';
import type { ClientContext } from './transport.js';

/** Delete a personal time block by its id. */
export function deletePersonalTime(ctx: ClientContext, id: string): Promise<void> {
  return executeOperation(
    ctx,
    {
      operation: 'DeletePersonalTime',
      method: 'DELETE',
      path: eventPath(ctx, `/personal-time/${segment(id)}`),
    },
    { units: 1 },
    (response) => {
      assertNoBody('DeletePersonalTime', response.body);
    },
  );
}
