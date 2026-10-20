// Session codes as ids (compass-power task 38). Attendees and agents name sessions by code, such
// as SVS339, while the tools take the catalog id. Before a tool runs, a sessionId or sessionIds
// value that is not a catalog id is replaced by the id of the one session whose code matches it,
// ignoring letter case. An unknown or shared code is left as given, so the tool reports it as
// unknown. With no cached catalog, or a value that fails the identifier check, the input is left
// alone, so the tool refuses a bad identifier before any Events call.

import type { CatalogView, EventsPort } from '../ports/events-port.js';
import { checkIdentifier } from '../safety/identifiers.js';

type WithSessions = { sessionId?: unknown; sessionIds?: unknown };

/**
 * Maps a catalog id to itself and a code that exactly one session has (any letter case) to that
 * session's id; anything else is returned as given. Pure, so the server and the Kiro hook share it
 * (task 40).
 */
export function sessionIdResolver(catalog: CatalogView): (value: string) => string {
  const byCode = new Map<string, string[]>();
  for (const [id, entry] of catalog.byId) {
    const code = entry.session.code.toUpperCase();
    byCode.set(code, [...(byCode.get(code) ?? []), id]);
  }
  return (value) => {
    if (catalog.byId.has(value)) {
      return value;
    }
    const ids = byCode.get(value.toUpperCase());
    return ids?.length === 1 ? (ids[0] as string) : value;
  };
}

export async function resolveSessionCodes<T>(input: T, events: EventsPort): Promise<T> {
  const value = input as WithSessions;
  const hasId = typeof value.sessionId === 'string';
  const hasIds = Array.isArray(value.sessionIds);
  const candidates = [
    ...(hasId ? [value.sessionId] : []),
    ...(hasIds ? (value.sessionIds as unknown[]) : []),
  ];
  // A bad identifier is left for the tool to refuse before any Events call (Property 28).
  const allSafe = candidates.every((c) => checkIdentifier(c as string).ok);
  if (candidates.length === 0 || !allSafe) {
    return input;
  }
  let catalog;
  try {
    catalog = await events.catalog();
  } catch {
    return input;
  }
  const resolve = sessionIdResolver(catalog);
  return {
    ...input,
    ...(hasId ? { sessionId: resolve(value.sessionId as string) } : {}),
    ...(hasIds ? { sessionIds: (value.sessionIds as string[]).map(resolve) } : {}),
  };
}
