// ListSessions operation (events-client, S1).
//
// Lists a page of catalog sessions. Metered at 120 per minute (design, Component 7).
// Validated directly against the contract ListSessionsSchema envelope (items,
// totalCount, nextToken). The caller passes an optional nextToken for pagination and
// includeAbstracts to control the fast pass (Requirements 6.1, 6.3, 6.4).

import { executeOperation } from './execute-operation.js';
import { eventPath } from './event-path.js';
import { validateBody } from './validate.js';
import { ListSessionsSchema, type ListSessions } from '@compass/contracts';
import type { ClientContext } from './transport.js';

/** Parameters for a ListSessions page request. */
export interface ListSessionsParams {
  /** The pagination token from the previous page, if any. */
  nextToken?: string;
  /** Whether to include session abstracts. A fast pass sends false. */
  includeAbstracts?: boolean;
  /** The locale for localised session text, sent as the locale query. */
  locale?: string;
}

/** List one page of sessions. */
export function listSessions(
  ctx: ClientContext,
  params: ListSessionsParams = {},
): Promise<ListSessions> {
  const query: Record<string, string> = {};
  if (params.locale !== undefined) {
    query.locale = params.locale;
  }
  if (params.nextToken !== undefined) {
    query.nextToken = params.nextToken;
  }
  if (params.includeAbstracts !== undefined) {
    query.includeAbstracts = String(params.includeAbstracts);
  }
  return executeOperation(
    ctx,
    {
      operation: 'ListSessions',
      method: 'GET',
      path: eventPath(ctx, 'ListSessions', '/sessions'),
      query,
    },
    { units: 1 },
    (response) => validateBody('ListSessions', ListSessionsSchema, response.body),
  );
}
