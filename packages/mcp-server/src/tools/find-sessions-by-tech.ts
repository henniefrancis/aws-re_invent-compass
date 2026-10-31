// find_sessions_by_tech (compass-power task 44, Requirements P2.6 and P2.10): finds cached catalog
// sessions on one technology ("Find me sessions on .NET"), or, with no technology, on the top
// technologies and AWS services of the Tech_Profile, grouped by technology. Session text stays
// inside catalog Labelled_Data_Blocks. It reads only the cached catalog and the local profile.

import { CompassError } from '../ports/errors.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { mergeProfile } from '../state/tech-profile.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import { MAX_LIMIT, sessionPayload } from './find-sessions.js';
import { queryForInput, queryForServiceKey, queryForTechKey, sessionsFor } from './tech-query.js';
import type { TechQuery } from './tech-query.js';

/** The longest technology name accepted. */
export const MAX_TECH_LENGTH = 100;

/** Sessions per technology when one is asked for. */
export const DEFAULT_SINGLE_LIMIT = 20;

/** Sessions per technology when the profile is used. */
export const DEFAULT_PROFILE_LIMIT = 5;

/** How many technologies, and how many AWS services, of the profile are searched. */
export const PROFILE_TOP = 5;

/** find_sessions_by_tech. */
export async function findSessionsByTech(
  input: { tech?: string | undefined; limit?: number | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'find_sessions_by_tech'>> {
  const { tech, limit } = input;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new CompassError('LimitInvalid');
  }
  if (tech !== undefined && tech.length > MAX_TECH_LENGTH) {
    throw new CompassError('InputTooLarge');
  }
  const catalog = await ctx.runtime.events.catalog();
  let queries: TechQuery[];
  let perGroup: number;
  if (tech !== undefined && tech.trim().length > 0) {
    queries = [queryForInput(tech, catalog)];
    perGroup = Math.min(limit ?? DEFAULT_SINGLE_LIMIT, MAX_LIMIT);
  } else {
    const profile = mergeProfile((await ctx.runtime.techProfile.read()).sources);
    queries = [
      ...profile.technologies.slice(0, PROFILE_TOP).map((t) => queryForTechKey(t.key)),
      ...profile.services.slice(0, PROFILE_TOP).map((s) => queryForServiceKey(s.key, catalog)),
    ];
    perGroup = Math.min(limit ?? DEFAULT_PROFILE_LIMIT, MAX_LIMIT);
    if (queries.length === 0) {
      return {
        ok: true,
        structured: { groups: [] },
        text: 'Compass does not know your tech yet. Name a technology, for example .NET, or run scan_repo or scan_github first.',
      };
    }
  }
  const groups = queries.map((query) => {
    const matched = sessionsFor(catalog, query);
    return {
      tech: query.label,
      sessions: matched.slice(0, perGroup),
      totalMatched: matched.length,
    };
  });
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(
      `${group.tech}: showing ${String(group.sessions.length)} of ${String(group.totalMatched)} matching sessions.`,
    );
    if (group.sessions.length > 0) {
      lines.push(labelUntrusted('catalog', group.sessions.map(sessionPayload)));
    }
  }
  if ((limit ?? 0) > MAX_LIMIT) {
    lines.push(`The limit was lowered to ${String(MAX_LIMIT)}, the most Compass returns at once.`);
  }
  return { ok: true, structured: { groups }, text: lines.join('\n') };
}
