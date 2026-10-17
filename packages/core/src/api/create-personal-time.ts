// CreatePersonalTime operation (events-client, S1).
//
// Adds a personal time block (a layover in the airline metaphor). Returns 204 with
// no body, treated as success with no validation (Requirement 6.7). Metered as an
// other-write (30 per minute) and follows the ordinary non-reserve retry policy. The
// input is a contract PersonalTimeInput; it is sent as the request body as given.

import { executeOperation } from './execute-operation.js';
import { assertNoBody } from './validate.js';
import type { PersonalTimeInput } from '@compass/contracts';
import type { ClientContext } from './transport.js';

/** Create a personal time block on the attendee's schedule. */
export function createPersonalTime(ctx: ClientContext, input: PersonalTimeInput): Promise<void> {
  return executeOperation(
    ctx,
    {
      operation: 'CreatePersonalTime',
      method: 'POST',
      path: '/schedule/personal-time',
      body: input,
    },
    { units: 1 },
    (response) => {
      assertNoBody('CreatePersonalTime', response.body);
    },
  );
}
