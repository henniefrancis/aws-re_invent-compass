// Local catalog filtering (events-client, S1, task 13.17).
//
// Filters the cached catalog in memory, with no request to the Events API
// (Requirement 16). Criteria combine conjunctively; an unset or empty criterion is
// not applied, so an empty filter returns everything. The criteria need fields the
// normalised session does not carry (abstract, topics, services), so the filter works
// on cache entries, which pair each normalised session with its wire session.
//
//   text     case-insensitive substring of the title or the abstract
//   type, level, venue   case-insensitive equality with the normalised field
//   topic, service       case-insensitive equality with any wire topic or service
//   day      YYYY-MM-DD equal to the local date of startsAt (its first ten characters,
//            because startsAt is already local time with an offset)

import type { CacheEntry } from './cache.js';

/** The filter criteria. */
export interface CatalogFilter {
  text?: string;
  type?: string;
  level?: string;
  day?: string;
  venue?: string;
  service?: string;
  topic?: string;
}

/** A criterion is applied only when it is a non-empty string after trimming. */
function applied(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function equalsIgnoreCase(value: string | undefined, wanted: string): boolean {
  return value !== undefined && value.toLowerCase() === wanted;
}

function includesAny(values: readonly string[] | undefined, wanted: string): boolean {
  return values?.some((v) => v.toLowerCase() === wanted) ?? false;
}

/** Return the entries that match every applied criterion. */
export function filterCatalog(entries: readonly CacheEntry[], filter: CatalogFilter): CacheEntry[] {
  const text = applied(filter.text);
  const type = applied(filter.type);
  const level = applied(filter.level);
  const day = applied(filter.day);
  const venue = applied(filter.venue);
  const service = applied(filter.service);
  const topic = applied(filter.topic);

  return entries.filter(({ session, wire }) => {
    if (text !== undefined) {
      const haystack = `${session.title}\n${wire.abstract ?? ''}`.toLowerCase();
      if (!haystack.includes(text)) {
        return false;
      }
    }
    return (
      (type === undefined || equalsIgnoreCase(session.type, type)) &&
      (level === undefined || equalsIgnoreCase(session.level, level)) &&
      (venue === undefined || equalsIgnoreCase(session.venue, venue)) &&
      (day === undefined || session.startsAt?.slice(0, 10) === day) &&
      (service === undefined || includesAny(wire.services, service)) &&
      (topic === undefined || includesAny(wire.topics, topic))
    );
  });
}
