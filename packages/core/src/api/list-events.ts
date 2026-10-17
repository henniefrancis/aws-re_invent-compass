// ListEvents operation (events-client, S1).
//
// Lists the AWS events. Unmetered (units 0): ListEvents and GetEvent carry no
// client-side quota (design, Component 7). The 2xx body is validated through the
// ListEvents wrapper built from the contract EventSchema, returning { items }
// (Requirements 6.1, 6.3, 6.4, 6.6).

import { executeOperation } from './execute-operation.js';
import { validateBody } from './validate.js';
import { ListEventsResultSchema, type ListEventsResult } from './response-wrappers.js';
import type { ClientContext } from './transport.js';

/** List the available events. */
export function listEvents(ctx: ClientContext): Promise<ListEventsResult> {
  return executeOperation(
    ctx,
    { operation: 'ListEvents', method: 'GET', path: '/events' },
    { units: 0 },
    (response) => validateBody('ListEvents', ListEventsResultSchema, response.body),
  );
}
