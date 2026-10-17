// Catalog pagination (events-client, S1, task 13.3).
//
// fetchAllSessions requests successive ListSessions pages until a response carries
// no nextToken (Requirements 13.1, 13.4). A non-empty nextToken is always followed,
// even when the page is shorter than earlier ones (13.2). A fast pass sends
// includeAbstracts=false on every page (13.3).
//
// This function adds no retry of its own. The single wait and retry after a 429
// lives in the operation path (execute-operation), so by the time an error reaches
// here the policy has already run: a still-failing page, whether a persistent 429 or
// any non-retryable error, stops the fetch and surfaces CatalogIncompleteError
// (13.5, 13.6). The catalog is never treated as fully fetched after a failure.
//
// An empty nextToken is treated as absent. A nextToken that repeats an earlier one
// would loop forever, so it also stops the fetch as incomplete.

import { listSessions } from '../api/list-sessions.js';
import { EventsApiError } from '../api/errors.js';
import { CatalogIncompleteError } from './errors.js';
import type { ClientContext } from '../api/transport.js';
import type { SessionWire } from '@compass/contracts';

/** Options for a catalog fetch. */
export interface FetchAllOptions {
  /** False on a fast pass (no abstracts); true for a full pass. */
  includeAbstracts: boolean;
}

/** Fetch every catalog session, page by page, in order. */
export async function fetchAllSessions(
  ctx: ClientContext,
  opts: FetchAllOptions,
): Promise<SessionWire[]> {
  const sessions: SessionWire[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;
  let pages = 0;

  for (;;) {
    let page;
    try {
      page = await listSessions(
        ctx,
        nextToken === undefined
          ? { includeAbstracts: opts.includeAbstracts }
          : { includeAbstracts: opts.includeAbstracts, nextToken },
      );
    } catch (error) {
      throw new CatalogIncompleteError(
        pages,
        error instanceof EventsApiError ? error.status : undefined,
      );
    }
    pages += 1;
    sessions.push(...page.items);

    const token = page.nextToken;
    if (token === undefined || token.length === 0) {
      return sessions;
    }
    if (seenTokens.has(token)) {
      throw new CatalogIncompleteError(pages);
    }
    seenTokens.add(token);
    nextToken = token;
  }
}
