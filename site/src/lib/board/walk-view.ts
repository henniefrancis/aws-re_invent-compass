// "Walk from here" on the board page (showcase-site task 40, ADR-037).
//
// The attendee taps the button on the next session. Only then is the browser asked for the
// location, once. The estimate is worked out on the phone. Nothing about the location is sent,
// stored or logged. The Directions link names only the venue: the maps app learns the location
// only when the attendee opens the link.

import { directionsUrl, type MapsApp } from '../content/links';
import { parseIsoWithOffset } from '../time/iso';
import { formatMinutesBefore } from '../time/time-format';
import type { DeviceWallet } from './device';
import type { BoardSession } from './handoff-view';
import type { LocateResult } from './locate';
import { venuePoint } from './venue-points';
import {
  ENTRY_ALLOWANCE_MINUTES,
  MAX_DISTANCE_METRES,
  estimateWalk,
  type Coordinates,
} from './walk-estimate';

export const WALK_TEXT = {
  button: 'Walk from here',
  privacy: 'Your location is used on this phone only. It is not sent to us or saved.',
  locating: 'Finding where you are.',
  noVenue: 'This session has no venue yet, so there is no walking time.',
  noPoint: 'We have no map point for this venue, so there is no walking time.',
  denied:
    'We could not use your location, so there is no walking time. Allow location for this site, then tap Walk from here again.',
  unavailable: 'Your phone could not find where you are, so there is no walking time.',
  timeout: 'Finding your location took too long, so there is no walking time. Try again.',
  tooFar: `You are more than ${String(MAX_DISTANCE_METRES / 1000)} km from this venue, so there is no walking time.`,
  estimateNote: `This is an estimate. It allows ${String(ENTRY_ALLOWANCE_MINUTES)} minutes to get into the venue and to the room.`,
  leaveNow: 'Leave now.',
} as const;

export interface DirectionsLink {
  readonly href: string;
  /** The visible text of the link. */
  readonly label: string;
  /** The accessible name of the link: it also names the venue. */
  readonly name: string;
  /** The line under the link: when the maps app learns the location. */
  readonly caption: string;
}

export type WalkView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'locating' }
  | { readonly kind: 'message'; readonly text: string }
  | {
      readonly kind: 'estimate';
      /** "About 12 min walk." */
      readonly summary: string;
      /** "Leave by 9:48 AM." or "Leave now." */
      readonly leaveBy: string;
      readonly note: string;
      readonly directions: DirectionsLink;
    };

export const IDLE_WALK: WalkView = { kind: 'idle' };
export const LOCATING_WALK: WalkView = { kind: 'locating' };

const message = (text: string): WalkView => ({ kind: 'message', text });

const FAILURES: Record<'denied' | 'unavailable' | 'timeout', string> = {
  denied: WALK_TEXT.denied,
  unavailable: WALK_TEXT.unavailable,
  timeout: WALK_TEXT.timeout,
};

/** Apple Maps on an iPhone, Google Maps on everything else. */
export function mapsAppFor(wallet: DeviceWallet): MapsApp {
  return wallet === 'apple' ? 'apple' : 'google';
}

function directionsFor(venue: string, point: Coordinates, wallet: DeviceWallet): DirectionsLink {
  const app = mapsAppFor(wallet);
  const appName = app === 'apple' ? 'Apple Maps' : 'Google Maps';
  return {
    href: directionsUrl(app, point),
    label: 'Directions',
    name: `Directions to ${venue} in ${appName}`,
    caption: `${appName} gets your location only when you open this link.`,
  };
}

function leaveByText(startsAt: string, totalMinutes: number, nowMs: number): string {
  const start = parseIsoWithOffset(startsAt);
  if (start === null || start - totalMinutes * 60_000 <= nowMs) {
    return WALK_TEXT.leaveNow;
  }
  return `Leave by ${formatMinutesBefore(startsAt, totalMinutes)}.`;
}

/**
 * What the page shows after the attendee taps "Walk from here" on a session. The venue is checked
 * first, so the browser is never asked for a location it could not use. `locate` asks the browser
 * once.
 */
export async function walkFromHere(
  session: BoardSession,
  locate: () => Promise<LocateResult>,
  wallet: DeviceWallet,
  now: () => number,
): Promise<WalkView> {
  if (session.venue === null) {
    return message(WALK_TEXT.noVenue);
  }
  const point = venuePoint(session.venue);
  if (point === null) {
    return message(WALK_TEXT.noPoint);
  }
  const found = await locate();
  if (!found.ok) {
    return message(FAILURES[found.reason]);
  }
  const estimate = estimateWalk(found.position, point);
  if (estimate === 'tooFar') {
    return message(WALK_TEXT.tooFar);
  }
  return {
    kind: 'estimate',
    summary: `About ${String(estimate.walkMinutes)} min walk.`,
    leaveBy: leaveByText(session.startsAt, estimate.totalMinutes, now()),
    note: WALK_TEXT.estimateNote,
    directions: directionsFor(session.venue, point, wallet),
  };
}
