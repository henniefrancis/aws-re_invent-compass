// UpdatePersonalTime operation (events-client, S1).
//
// Updates an existing personal time block by id. Returns 204 with no body, treated
// as success with no validation (Requirement 6.7). Metered as an other-write (30 per
// minute) and follows the ordinary non-reserve retry policy. The input is a contract
// PersonalTimeInput sent as the request body.

import { executeOperation } from './execute-operation.js';
import { assertNoBody } from './validate.js';
import type { PersonalTimeInput } from '@compass/contracts';
import type { ClientContext } from './transport.js';

/** Update an existing personal time block by its id. */
export function updatePersonalTime(
  ctx: ClientContext,
  id: string,
  input: PersonalTimeInput,
): Promise<void> {
  return executeOperation(
    ctx,
    {
      operation: 'UpdatePersonalTime',
      method: 'PUT',
      path: `/schedule/personal-time/${encodeURIComponent(id)}`,
      body: input,
    },
    { units: 1 },
    (response) => {
      assertNoBody('UpdatePersonalTime', response.body);
    },
  );
}
