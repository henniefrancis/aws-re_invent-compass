// Venue recovery (events-client, S1, task 13.6).
//
// A session's venue is taken from the wire when present. When it is absent, the room
// text (for example "Venetian | Level 2 | Room 102") is searched for the name of a
// known venue from the injected list. The list is owned by another stream
// (data/venues.json) and is only ever read, never written: it arrives here by
// injection and is parsed through VenueSchema (Requirement 15.6, 15.9).

import { z } from 'zod';
import { VenueSchema, type Venue } from '@compass/contracts';

const VenueListSchema = z.array(VenueSchema);

/**
 * Parse an injected venue list through VenueSchema. A missing or invalid list yields
 * undefined, meaning "no venue list": nothing is invented in its place.
 */
export function parseVenues(raw: unknown): Venue[] | undefined {
  const parsed = VenueListSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Escape a string for use inside a RegExp source. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recover a venue name from room text. A venue matches when its whole name appears
 * in the text as a standalone phrase (case-insensitive). The longest matching name
 * wins, so "Venetian Expo" beats "Venetian"; ties go to the earlier list entry.
 */
export function recoverVenue(
  roomText: string | undefined,
  venues: readonly Venue[],
): string | undefined {
  if (roomText === undefined || roomText.length === 0) {
    return undefined;
  }
  let best: string | undefined;
  let bestLength = 0;
  for (const venue of venues) {
    const name = venue.name.trim();
    if (name.length <= bestLength) {
      continue;
    }
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, 'iu');
    if (pattern.test(roomText)) {
      best = venue.name;
      bestLength = name.length;
    }
  }
  return best;
}
