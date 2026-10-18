// Rebooking options (itinerary-rules, S2).
//
// When a session is full or problematic, the attendee wants another way to get the content.
// Three kinds of option are found for the session's base code (the code without a -R
// suffix), and only sessions that start strictly after Context.now are offered (the engine
// never reads the system clock):
//   repeat   a session whose code is the base code plus -R, -R1, -R2 and so on (any case), or
//            that points back to the base code through repeatOf (Req 6.1)
//   standby  a favorited session that shares the base code, held as a backup (Req 6.2)
//   walkUp   a session for the base code that needs no reservation or has no seats left, so
//            the attendee can join the walk-up line (Req 6.3)
// A session that fits more than one kind is listed once, under the first kind in that order. The
// original session (originalSessionId, when known) is never offered as its own alternative.
import type { NormalisedSession } from '@compass/contracts';
import type { Context } from './context.js';
import * as reason from './reasons.js';
import { sessionReservability, usableTime } from './resolve.js';
import { checkZone, formatLocal, parseInstant } from './time.js';

/** The kind of rebooking option. */
export type RebookKind = 'repeat' | 'standby' | 'walkUp';

/** One way to still attend the content. */
export interface RebookOption {
  kind: RebookKind;
  sessionId: string;
  /** ISO 8601 start, as supplied by the session. */
  startsAt: string;
  /** Plain English, 1 to 200 characters. */
  reason: string;
}

/** The outcome of looking for rebooking options. */
export type RebookResult =
  | { status: 'ok'; options: RebookOption[]; message: string }
  | { status: 'unknown'; options: []; message: string };

/** Seat bands that mean the attendee can only walk up. */
const WALK_UP_BANDS: readonly string[] = ['unavailable', 'walkUp'];

// A repeat suffix: -R, -R1, -R2 and so on, in any case.
const REPEAT_SUFFIX = /-R\d*$/i;

/** The base code: a session code with a trailing -R, -R1, -R2 and so on removed, trimmed. */
export function baseCodeOf(code: unknown): string {
  return typeof code === 'string' ? code.trim().replace(REPEAT_SUFFIX, '') : '';
}

/** Base codes are compared without regard to case. */
const sameBase = (a: unknown, b: string): boolean =>
  baseCodeOf(a).toLowerCase() === b.toLowerCase();

/**
 * Do two session codes belong to the same repeat group? They do when they have the same base code
 * (the code without a trailing -R, -R1, -R2 and so on), in any case. The group may have no
 * unsuffixed original: ABC123-R1 and ABC123-R3 are repeats of each other when ABC123 does not
 * exist. An -S code is a different session, not a repeat marker: ABC123-S has the base ABC123-S,
 * so it is never in the group of ABC123, while ABC123-S-R1 is a repeat of ABC123-S. Codes that
 * are empty or not text belong to no group.
 */
export function sameRepeatGroup(a: unknown, b: unknown): boolean {
  const base = baseCodeOf(a);
  return base !== '' && sameBase(b, base);
}

interface Found {
  option: RebookOption;
  startMs: number;
}

/**
 * Find rebooking options for a base code. candidates is every known session, and favorites
 * is the attendee's favorited sessions. Both inputs are left unchanged.
 */
export function findRebookingOptions(
  baseCode: string,
  candidates: readonly NormalisedSession[],
  favorites: readonly NormalisedSession[],
  context: Context,
  originalSessionId?: string,
): RebookResult {
  const zone = checkZone(context.eventTimezone);
  if (!zone.ok) {
    return { status: 'unknown', options: [], message: reason.rebookZoneProblem(zone.reason) };
  }
  const nowMs = parseInstant(context.now);
  if (nowMs === undefined) {
    return { status: 'unknown', options: [], message: reason.rebookNowUnusable() };
  }

  const base = baseCodeOf(baseCode);
  // An empty base code would match every session with an empty code, so it matches nothing.
  if (base === '') {
    return { status: 'ok', options: [], message: reason.rebookNone() };
  }
  const found: Found[] = [];
  // The original session is never offered as its own alternative, when its id is known.
  const seen = new Set<string>(originalSessionId === undefined ? [] : [originalSessionId]);

  // Add a session as an option when it starts after now and has not been listed yet.
  const add = (
    kind: RebookKind,
    session: NormalisedSession,
    describe: (code: string, local: string) => string,
  ): void => {
    const startsAt = usableTime(session, 'startsAt');
    if (startsAt === undefined) {
      return;
    }
    const startMs = parseInstant(startsAt) as number;
    if (startMs <= nowMs || seen.has(session.sessionId)) {
      return;
    }
    seen.add(session.sessionId);
    found.push({
      startMs,
      option: {
        kind,
        sessionId: session.sessionId,
        startsAt,
        reason: describe(session.code, formatLocal(startMs, zone.zone)),
      },
    });
  };

  for (const session of candidates) {
    const code = typeof session.code === 'string' ? session.code.trim() : '';
    const isRepeat =
      (REPEAT_SUFFIX.test(code) && sameBase(code, base)) ||
      (session.repeatOf !== undefined && sameBase(session.repeatOf, base));
    if (isRepeat) {
      add('repeat', session, reason.rebookRepeat);
    }
  }
  for (const session of favorites) {
    if (sameBase(session.code, base)) {
      add('standby', session, reason.rebookStandby);
    }
  }
  for (const session of candidates) {
    const noReservation = sessionReservability(session) === false;
    const isFull = WALK_UP_BANDS.includes(session.seatAvailability);
    if (sameBase(session.code, base) && (noReservation || isFull)) {
      add('walkUp', session, (code, local) => reason.rebookWalkUp(code, local, isFull));
    }
  }

  const options = found.sort((a, b) => a.startMs - b.startMs).map((item) => item.option);
  return {
    status: 'ok',
    options,
    message: options.length === 0 ? reason.rebookNone() : reason.rebookFound(options.length),
  };
}
