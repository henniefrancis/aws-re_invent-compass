// Sample boarding pass (showcase-site, Component 8).
//
// The data behind the pass image the demo shows for one reserved session. It follows the S4
// pass rules (CTO M9): text goes through normalisePassText (pass-text.ts, the same mapping as
// the one in @compass/contracts, proven equal by a test), a title longer than 80 characters
// becomes its first 77 characters plus three ASCII dots (the ellipsis character is not in the
// PassFields text allowlist), walk minutes are clamped to 0 to 90, and a missing venue is an
// empty string in passFields. "Venue not published" is display text only.
//
// The pass has the fields of the final Apple pass (tasks 22 and 32 of the pass service): session,
// terminal (the venue), gate (the short room), flight name (the title), date with the 24-hour
// range, and boarding closes (24-hour). Boarding closes and the walks come from the rules port.
// The "walk" minutes are the engine's walk plus its buffer, which is also what the sample
// calendar's "Leave now" alarm uses.

import type { DemoDeps } from './demo-deps';
import type { DemoState } from './demo-state';
import { neighboursOf } from './neighbours';
import { normalisePassText } from './pass-text';
import { boardingText } from './week-view';
import { formatDateInZone, formatInZone, formatInZone24 } from '../time/time-format';
import { DEMO_EVENT } from './demo-catalog';

export const SAMPLE_LABEL = 'Sample pass. Made-up session.';
export const PASS_DISCLAIMER = 'Unofficial. Your badge is your ticket.';
export const MAX_TITLE = 80;
export const TITLE_KEPT = 77;
export const MAX_WALK_MINUTES = 90;
export const NO_VENUE = 'Venue not published';
export const NO_ROOM = 'Room not published';
export const NO_BOARDING = 'Not needed';

export interface PassFieldsInput {
  sessionCode: string;
  title: string;
  venue: string;
  room: string;
  startsAt: string;
  endsAt: string;
  walkFromPrevious?: { minutes: number; fromVenue: string };
  nextConnection?: { sessionCode: string; startsAt: string; venue: string; walkMinutes: number };
}

export interface SamplePass {
  /** SESSION: the session code. */
  readonly session: string;
  /** FLIGHT NAME: the title, at most 80 characters. */
  readonly title: string;
  /** TERMINAL: the venue, or "Venue not published". */
  readonly terminal: string;
  /** GATE: the short room, or "Room not published". */
  readonly gate: string;
  /** DATE: "3 Dec 2026 | 13:00-14:00", 24-hour, in the event timezone. */
  readonly date: string;
  /** BOARDING CLOSES: "12:50" (24-hour), or "Not needed" when the engine gives no time. */
  readonly boardingCloses: string;
  /** The engine's reason when there is no boarding time, otherwise null. */
  readonly boardingNote: string | null;
  readonly walkFromPrevious: string | null;
  readonly nextConnection: string | null;
  readonly label: typeof SAMPLE_LABEL;
  readonly disclaimer: typeof PASS_DISCLAIMER;
  readonly accessibleName: string;
  readonly passFields: PassFieldsInput;
}

/**
 * The room as the front of the pass shows it: the part after the first comma ("Octavius 4"
 * from "Level 1, Octavius 4"), or the whole room when it has one part, or "Room not published".
 */
export function shortRoom(room: string | undefined): string {
  const parts = (room ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const [first = '', second] = parts;
  return second ?? (first === '' ? NO_ROOM : first);
}

/** Normalise a title, and keep 77 characters plus three dots when it is longer than 80. */
export function fitTitle(title: string): string {
  const text = normalisePassText(title);
  return text.length > MAX_TITLE ? `${text.slice(0, TITLE_KEPT)}...` : text;
}

/** A walk in whole minutes from 0 to 90, as the pass accepts it. */
export function clampWalk(minutes: number): number {
  return Math.min(MAX_WALK_MINUTES, Math.max(0, Math.round(minutes)));
}

/** The pass for a reserved session of the week, or null when it is not in the week. */
export function buildSamplePass(
  sessionId: string,
  state: DemoState,
  deps: DemoDeps,
): SamplePass | null {
  const session = deps.catalog.get(sessionId);
  const held = state.commitments.some(
    (c) => c.kind === 'reservedSession' && c.sessionId === sessionId,
  );
  if (session === undefined || !held) {
    return null;
  }
  const zone = DEMO_EVENT.timezone;
  const { previous, next } = neighboursOf(sessionId, state, deps);
  const walkMinutes = previous?.walkMinutes ?? null;
  const nextWalk = next?.walkMinutes ?? null;
  const title = fitTitle(session.title);
  const terminal = session.venue === undefined || session.venue === '' ? NO_VENUE : session.venue;
  const gate = shortRoom(session.room);
  const date = `${formatDateInZone(session.startsAt as string, zone)} | ${formatInZone24(session.startsAt as string, zone)}-${formatInZone24(session.endsAt as string, zone)}`;
  const boarding = deps.rules.computeBoarding(session, deps.context);
  const boardingCloses =
    boarding.status === 'closes' ? formatInZone24(boarding.at, zone) : NO_BOARDING;
  const boardingNote = boarding.status === 'closes' ? null : boardingText(boarding);
  const walkText =
    previous === null || walkMinutes === null
      ? null
      : `${String(clampWalk(walkMinutes))} min walk from ${previous.gate}`;
  const nextText =
    next === null || next.sessionCode === null || nextWalk === null
      ? null
      : `${next.sessionCode} at ${formatInZone(next.startsAt, zone)}, ${String(clampWalk(nextWalk))} min walk`;
  const passFields: PassFieldsInput = {
    sessionCode: session.code,
    title,
    venue: session.venue ?? '',
    room: session.room ?? '',
    startsAt: session.startsAt as string,
    endsAt: session.endsAt as string,
    ...(previous === null || walkMinutes === null
      ? {}
      : { walkFromPrevious: { minutes: clampWalk(walkMinutes), fromVenue: previous.venue } }),
    ...(next === null || next.sessionCode === null || nextWalk === null
      ? {}
      : {
          nextConnection: {
            sessionCode: next.sessionCode,
            startsAt: next.startsAt,
            venue: next.venue,
            walkMinutes: clampWalk(nextWalk),
          },
        }),
  };
  const parts = [
    `Boarding pass. Session ${session.code}. Terminal: ${terminal}. Gate: ${gate}.`,
    `Flight name: ${title}.`,
    `Date: ${date}.`,
    boardingNote === null
      ? `Boarding closes: ${boardingCloses}.`
      : `Boarding closes: ${boardingNote}.`,
    walkText === null ? 'Walk from the previous session: not known.' : `${walkText}.`,
    nextText === null ? 'Next connection: not known.' : `Next connection: ${nextText}.`,
    `${SAMPLE_LABEL} ${PASS_DISCLAIMER}`,
  ];
  return {
    session: session.code,
    title,
    terminal,
    gate,
    date,
    boardingCloses,
    boardingNote,
    walkFromPrevious: walkText,
    nextConnection: nextText,
    label: SAMPLE_LABEL,
    disclaimer: PASS_DISCLAIMER,
    accessibleName: parts.join(' '),
    passFields,
  };
}
