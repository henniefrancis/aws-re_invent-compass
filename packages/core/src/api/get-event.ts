// GetEvent operation (events-client, S1).
//
// Reads a single event by id. Unmetered (units 0). The 2xx body is validated through
// the GetEvent wrapper built from the contract EventSchema, returning { event }
// (Requirements 6.1, 6.3, 6.4, 6.6).

import { executeOperation } from './execute-operation.js';
import { segment } from './event-path.js';
import { validateBody } from './validate.js';
import { GetEventResultSchema, type GetEventResult } from './response-wrappers.js';
import type { ClientContext } from './transport.js';

/** Read a single event by its id. */
export function getEvent(ctx: ClientContext, eventId: string): Promise<GetEventResult> {
  return executeOperation(
    ctx,
    { operation: 'GetEvent', method: 'GET', path: `/events/${segment('GetEvent', eventId)}` },
    { units: 0 },
    (response) => validateBody('GetEvent', GetEventResultSchema, response.body),
  );
}
