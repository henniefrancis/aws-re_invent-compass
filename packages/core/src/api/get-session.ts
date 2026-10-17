// GetSession operation (events-client, S1).
//
// Reads a single session by id. Metered at 120 per minute. Validated directly
// against the contract GetSessionSchema envelope (Requirements 6.1, 6.3, 6.4).

import { executeOperation } from './execute-operation.js';
import { validateBody } from './validate.js';
import { GetSessionSchema, type GetSession } from '@compass/contracts';
import type { ClientContext } from './transport.js';

/** Read a single session by its id. */
export function getSession(ctx: ClientContext, sessionId: string): Promise<GetSession> {
  return executeOperation(
    ctx,
    { operation: 'GetSession', method: 'GET', path: `/sessions/${encodeURIComponent(sessionId)}` },
    { units: 1 },
    (response) => validateBody('GetSession', GetSessionSchema, response.body),
  );
}
