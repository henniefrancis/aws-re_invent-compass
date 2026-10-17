// GetSchedule operation (events-client, S1).
//
// Reads the attendee's schedule. Metered at 60 per minute. Validated directly
// against the contract GetScheduleSchema envelope (Requirements 6.1, 6.3, 6.4). This
// is also the read the confirmed-write helper uses to confirm every write.

import { executeOperation } from './execute-operation.js';
import { eventPath } from './event-path.js';
import { validateBody } from './validate.js';
import { GetScheduleSchema, type GetSchedule } from '@compass/contracts';
import type { ClientContext } from './transport.js';

/** Read the attendee's schedule (reservations, favorites, personal time). */
export function getSchedule(ctx: ClientContext): Promise<GetSchedule> {
  return executeOperation(
    ctx,
    { operation: 'GetSchedule', method: 'GET', path: eventPath(ctx, '/schedule') },
    { units: 1 },
    (response) => validateBody('GetSchedule', GetScheduleSchema, response.body),
  );
}
