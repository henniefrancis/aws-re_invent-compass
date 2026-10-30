// The walking time estimate of "Walk from here" (showcase-site task 40, ADR-037).
//
// Everything here is a pure function. It works out a rough walking time from where the phone is
// to the venue of the next session. The location never leaves the phone: nothing in this file
// sends, stores or logs it.

export interface Coordinates {
  readonly lat: number;
  readonly lon: number;
}

/** Metres a person walks in a minute. The venue walking times in data/venues.json use the same pace. */
export const METRES_PER_MINUTE = 66.7;

/**
 * How much longer the walk along the streets and bridges is than the straight line. This is
 * Compass's own assumption, taken from its own data: for the 15 pairs of venues in
 * data/venues.json, the walking distance is 1.33 to 2.99 times the straight line, with a median of
 * 1.66. It is rounded to 1.6.
 */
export const DETOUR_FACTOR = 1.6;

/**
 * Minutes added for getting into the venue and to the room. It is the same 15 minutes the venue
 * walking times in data/venues.json allow for leaving one building and entering the next, because
 * the phone is often inside a hotel when the attendee taps the button.
 */
export const ENTRY_ALLOWANCE_MINUTES = 15;

/** Farther than this from the venue, the estimate is not given. */
export const MAX_DISTANCE_METRES = 20_000;

/** The mean radius of the Earth in metres. */
const EARTH_RADIUS_METRES = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** The straight-line distance between two points on the Earth, in metres (haversine). */
export function haversineMetres(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(h));
}

export interface WalkEstimate {
  /** The walk itself, rounded up to a whole minute, at least 1. */
  readonly walkMinutes: number;
  /** The walk plus the time to get into the venue and to the room. */
  readonly totalMinutes: number;
}

/** The estimate for a walk, or "tooFar" when the phone is more than 20 km from the venue. */
export function estimateWalk(from: Coordinates, to: Coordinates): WalkEstimate | 'tooFar' {
  const straight = haversineMetres(from, to);
  if (!Number.isFinite(straight) || straight > MAX_DISTANCE_METRES) {
    return 'tooFar';
  }
  const walkMinutes = Math.max(1, Math.ceil((straight * DETOUR_FACTOR) / METRES_PER_MINUTE));
  return { walkMinutes, totalMinutes: walkMinutes + ENTRY_ALLOWANCE_MINUTES };
}
