// The real fetch for the Events API, used only in production (tests inject a fake). It passes the
// request through unchanged: S1's transport already sets `redirect: 'error'` and the time limit.

import type { FetchLike } from '@compass/core/api';

/** The global fetch, typed as the shape S1's transport expects. */
export const defaultEventsFetch: FetchLike = (url, init) => fetch(url, init);
