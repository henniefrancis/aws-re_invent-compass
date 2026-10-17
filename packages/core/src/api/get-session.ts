// GetSession operation (events-client, S1).
//
// Reads a single session by id. Metered at 120 per minute. Validated directly
// against the contract GetSessionSchema envelope (Requirements 6.1, 6.3, 6.4).

import { executeOperation } from './execute-operation.js';
import { eventPath, segment } from './event-path.js';
import { validateBody } from './validate.js';
import { GetSessionSchema, type GetSession } from '@compass/contracts';
import type { ClientContext } from './transport.js';

/** Optional parameters for GetSession. */
export interface GetSessionParams {
  /** The locale for localised session text, sent as the locale query. */
  locale?: string;
}

/** Read a single session by its id. */
export function getSession(
  ctx: ClientContext,
  sessionId: string,
  params: GetSessionParams = {},
): Promise<GetSession> {
  const query: Record<string, string> = {};
  if (params.locale !== undefined) {
    query.locale = params.locale;
  }
  return executeOperation(
    ctx,
    {
      operation: 'GetSession',
      method: 'GET',
      path: eventPath(ctx, `/sessions/${segment(sessionId)}`),
      query,
    },
    { units: 1 },
    (response) => validateBody('GetSession', GetSessionSchema, response.body),
  );
}
