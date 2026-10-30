// "Walk from here" on the board page (showcase-site task 40, ADR-037).
//
// The attendee taps the button on the next session. Only then is the browser asked for the
// location, once. The estimate is worked out on the phone. Nothing about the location is sent,
// stored or logged. The Directions link names only the venue: the maps app learns the location
// only when the attendee opens the link.

import { directionsUrl, type MapsApp } from '../content/links';
import { parseIsoWithOffset } from '../time/iso';
import { formatInstantAtOffsetOf, formatMinutesBefore } from '../time/time-format';
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
  privacy:
    'Compass does not send your location anywhere or save it. Your phone may use its own location service to find it.',
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
  /** Visually hidden text after the label: the venue, the app and that it opens a new tab. */
  readonly detail: string;
  /** The line under the link: when the maps app learns the location. */
  readonly caption: string;
}

/**
 * What the page holds for "Walk from here". Everything but idle names the session (by serial
 * number) it was worked out for, so it is shown only under that session.
 */
export type WalkView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'locating'; readonly serial: string }
  | { readonly kind: 'message'; readonly serial: string; readonly text: string }
  | {
      readonly kind: 'estimate';
      readonly serial: string;
      /** "About 12 min walk." */
      readonly summary: string;
      /** "Leave by 9:48 AM." or "Leave now.", as it was when the attendee tapped. */
      readonly leaveBy: string;
      /** "Worked out at 7:31 AM.": the tap time, in the session's event offset. */
      readonly workedOut: string;
      readonly note: string;
      readonly directions: DirectionsLink;
    };

/** How often the page moves its clock on while it is open (so the next session can change), in milliseconds. */
export const WALK_TICK_MS = 30_000;

export const IDLE_WALK: WalkView = { kind: 'idle' };
export const locatingWalk = (serial: string): WalkView => ({ kind: 'locating', serial });

const message = (serial: string, text: string): WalkView => ({ kind: 'message', serial, text });

/** The view for the session that is next now: anything worked out for another session is dropped. */
export function walkForSession(view: WalkView, nextSerial: string | null): WalkView {
  return view.kind !== 'idle' && view.serial === nextSerial ? view : IDLE_WALK;
}

/** What the page shows right now under the next session. */
export type WalkShown =
  | { readonly kind: 'idle' }
  | { readonly kind: 'locating' }
  | { readonly kind: 'message'; readonly text: string }
  | {
      readonly kind: 'estimate';
      readonly summary: string;
      readonly leaveBy: string;
      readonly workedOut: string;
      readonly note: string;
      readonly directions: DirectionsLink;
    };

/** The held view, shown only when it was worked out for the next session. */
export function walkShown(view: WalkView, nextSerial: string | null): WalkShown {
  const own = walkForSession(view, nextSerial);
  if (own.kind === 'estimate') {
    const { summary, leaveBy, workedOut, note, directions } = own;
    return { kind: 'estimate', summary, leaveBy, workedOut, note, directions };
  }
  return own.kind === 'message' ? { kind: 'message', text: own.text } : { kind: own.kind };
}

/** The sentence a screen reader hears when the shown view changes. */
export function walkAnnouncement(shown: WalkShown): string {
  if (shown.kind === 'locating') {
    return WALK_TEXT.locating;
  }
  if (shown.kind === 'message') {
    return shown.text;
  }
  return shown.kind === 'estimate'
    ? `${shown.summary} ${shown.leaveBy} ${shown.workedOut} ${shown.note}`
    : '';
}

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
    detail: ` to ${venue} in ${appName} (opens in a new tab)`,
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
  const serial = session.serialNumber;
  if (session.venue === null) {
    return message(serial, WALK_TEXT.noVenue);
  }
  const point = venuePoint(session.venue);
  if (point === null) {
    return message(serial, WALK_TEXT.noPoint);
  }
  const found = await locate();
  if (!found.ok) {
    return message(serial, FAILURES[found.reason]);
  }
  const tapMs = now();
  const estimate = estimateWalk(found.position, point);
  if (estimate === 'tooFar') {
    return message(serial, WALK_TEXT.tooFar);
  }
  return {
    kind: 'estimate',
    serial,
    summary: `About ${String(estimate.walkMinutes)} min walk.`,
    leaveBy: leaveByText(session.startsAt, estimate.totalMinutes, tapMs),
    workedOut: `Worked out at ${formatInstantAtOffsetOf(session.startsAt, tapMs)}.`,
    note: WALK_TEXT.estimateNote,
    directions: directionsFor(session.venue, point, wallet),
  };
}
