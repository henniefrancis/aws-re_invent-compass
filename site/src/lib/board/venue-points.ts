// The map points of the official venues (showcase-site task 40).
//
// The points come from data/venues.json, the same file the demo reads, so there is one source of
// truth. Each point carries a source note in that file (OpenStreetMap, the point used for the
// walking times). A venue is found by its name or by one of its spelling variants, ignoring case.

import venueFile from '../../../../data/venues.json';
import type { Coordinates } from './walk-estimate';

interface VenueEntry {
  readonly venue: { readonly name: string; readonly coordinates?: Coordinates };
  readonly aliases?: readonly { readonly name: string }[];
}

const normalise = (name: string): string => name.trim().toLowerCase();

export function buildIndex(entries: readonly VenueEntry[]): ReadonlyMap<string, Coordinates> {
  const index = new Map<string, Coordinates>();
  for (const entry of entries) {
    const point = entry.venue.coordinates;
    if (point !== undefined) {
      for (const name of [entry.venue.name, ...(entry.aliases ?? []).map((a) => a.name)]) {
        index.set(normalise(name), point);
      }
    }
  }
  return index;
}

const INDEX = buildIndex(venueFile.venues);

/** The map point of a venue, or null when the name is not a known venue or has no point. */
export function venuePoint(name: string): Coordinates | null {
  return INDEX.get(normalise(name)) ?? null;
}
