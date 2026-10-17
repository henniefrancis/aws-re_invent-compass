// GetSchedule operation (events-client, S1).
//
// Reads the attendee's schedule. Metered at 60 per minute. Validated directly
// against the contract GetScheduleSchema envelope (Requirements 6.1, 6.3, 6.4). This
// is also the read the confirmed-write helper uses to confirm every write.

import { executeOperation } from './execute-operation.js';
import { eventPath } from './event-path.js';
import { validateBody } from './validate.js';
import { GetScheduleSchema, type GetSchedule } from '@compass/contracts';
import { MAX_ABSTRACT_CODE_POINTS, sanitiseText } from './sanitise-text.js';
import type { ClientContext } from './transport.js';

/** Sanitise the free text of personal time entries as they are read (finding N1). */
function sanitiseSchedule(value: GetSchedule): GetSchedule {
  return {
    schedule: {
      ...value.schedule,
      personalTime: value.schedule.personalTime.map((entry) => ({
        ...entry,
        title: sanitiseText(entry.title),
        description: sanitiseText(entry.description, {
          multiline: true,
          maxCodePoints: MAX_ABSTRACT_CODE_POINTS,
        }),
        ...(entry.location === undefined ? {} : { location: sanitiseText(entry.location) }),
      })),
    },
  };
}

/** Read the attendee's schedule (reservations, favorites, personal time). */
export function getSchedule(ctx: ClientContext): Promise<GetSchedule> {
  return executeOperation(
    ctx,
    { operation: 'GetSchedule', method: 'GET', path: eventPath(ctx, 'GetSchedule', '/schedule') },
    { units: 1 },
    (response) => sanitiseSchedule(validateBody('GetSchedule', GetScheduleSchema, response.body)),
  );
}
