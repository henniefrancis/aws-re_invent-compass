// Typed errors for the catalog module (events-client, S1).
//
// These share the EventsApiError base so callers can catch one type. Messages are
// fixed strings; the only variable parts are the safe values the base already
// carries (operation name and status). No token, email, header, response body or
// file path is ever placed in an error.

import { EventsApiError } from '../api/errors.js';

/** A catalog fetch stopped before the last page, so the catalog is not complete. */
export class CatalogIncompleteError extends EventsApiError {
  /** How many pages were fetched successfully before the failure. */
  readonly pagesFetched: number;

  constructor(pagesFetched: number, status?: number) {
    super(
      'CatalogIncompleteError',
      'ListSessions',
      'The catalog fetch did not complete, so the catalog is not fully fetched',
      status,
    );
    this.pagesFetched = pagesFetched;
  }
}

/** The catalog cache could not be written; any existing cache is unchanged. */
export class CacheWriteError extends EventsApiError {
  constructor() {
    super(
      'CacheWriteError',
      'ListSessions',
      'The catalog cache could not be written; the existing cache is unchanged',
    );
  }
}
