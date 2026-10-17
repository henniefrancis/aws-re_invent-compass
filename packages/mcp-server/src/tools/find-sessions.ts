// find_sessions (Requirements 9.4, 10.1, 10.2; CTO review L2): filters the cached catalog
// locally (the Events API has no search). `limit` defaults to 20 and is clamped to 50;
// a negative or non-integer limit is refused. The text lists sessions inside a
// Labelled_Data_Block; abstracts never appear because the normalised session has none.

import { CompassError } from '../ports/errors.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';

/** The default number of sessions returned. */
export const DEFAULT_LIMIT = 20;

/** The most sessions returned. */
export const MAX_LIMIT = 50;

/** The filters find_sessions accepts. */
export interface FindSessionsInput {
  query?: string | undefined;
  filters?:
    | {
        services?: string[] | undefined;
        level?: string | undefined;
        type?: string | undefined;
        day?: string | undefined;
      }
    | undefined;
  limit?: number | undefined;
}

/** find_sessions. */
export async function findSessions(
  input: FindSessionsInput,
  ctx: ToolContext,
): Promise<ToolOutcome<'find_sessions'>> {
  const requested = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(requested) || requested < 0) {
    throw new CompassError('LimitInvalid');
  }
  const limit = Math.min(requested, MAX_LIMIT);
  const catalog = await ctx.runtime.events.catalog();
  const matched = catalog.filter({
    ...(input.query === undefined ? {} : { text: input.query }),
    ...input.filters,
  });
  const sessions = matched.slice(0, limit);
  const notes = [`Showing ${sessions.length} of ${matched.length} matching sessions.`];
  if (requested > MAX_LIMIT) {
    notes.push(`The limit was lowered to ${MAX_LIMIT}, the most Compass returns at once.`);
  }
  const payload = sessions.map((s) => ({
    sessionId: s.sessionId,
    code: s.code,
    title: s.title,
    type: s.type,
    level: s.level,
    venue: s.venue,
    room: s.room,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    isReservable: s.isReservable,
    seatAvailability: s.seatAvailability,
  }));
  return {
    ok: true,
    structured: { sessions, totalMatched: matched.length },
    text: `${notes.join(' ')}\n${labelUntrusted('catalog', payload)}`,
  };
}
