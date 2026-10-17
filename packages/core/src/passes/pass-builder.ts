// Pass_Builder for the pass side (boarding-passes, S4).
//
// buildPass is a pure function: it takes one confirmed session with its itinerary
// context and returns a PassFields that has been validated against the contract schema
// for the current event window. It owns no clock (Boarding_Closes is derived downstream
// by the calendar and the itinerary page), and the only injected dependency is the
// ConnectionProvider that supplies walk minutes.
//
// Text safety is delegated to the contract: every free-text value is normalised with
// normalisePassText and then judged by createPassFieldsSchema itself, so S4 never keeps
// a second copy of the allowlist. A value that still fails is replaced by its fallback
// (Title not shown, or an empty string) and the rejected text is never logged, thrown
// or echoed.
import { createPassFieldsSchema, normalisePassText, type PassFields } from '@compass/contracts';
import type { ConnectionProvider } from './interfaces.js';
import type { AdjacentCommitment, AdjacentSession, BuildSession, EventWindow } from './models.js';
import { passError } from './redaction.js';

/** The longest title the pass carries, in UTF-16 code units, as the schema counts it. */
const MAX_TITLE_LENGTH = 80;
/** The title is cut to this many code units before the three ASCII full stops are added. */
const TRUNCATED_TITLE_LENGTH = 77;
/** The three ASCII full stops that mark a truncated title (not the Unicode ellipsis). */
const ASCII_ELLIPSIS = '...';
/** The title used when the real title cannot be shown. The session code is kept. */
const TITLE_FALLBACK = 'Title not shown';
/** The longest attendee name the pass carries. */
const MAX_NAME_LENGTH = 40;
/** The PassFields schema bounds for a walk, in whole minutes. */
const MIN_WALK_MINUTES = 0;
const MAX_WALK_MINUTES = 90;

/** The input to buildPass. */
export interface BuildPassInput {
  /** The session being turned into a pass, already normalised by S1. */
  session: BuildSession;
  /** The commitment immediately before the session, when there is one. */
  previous?: AdjacentCommitment;
  /** The reserved session that follows, when there is one. */
  next?: AdjacentSession;
  /** The displayed name, present only when a local opt-in is recorded. */
  attendeeName?: string;
  /** The event window from GetEvent. */
  eventWindow: EventWindow;
}

/** The result of buildPass: fields validated against the current window schema. */
export interface BuildPassResult {
  fields: PassFields;
}

/** The only dependency buildPass takes. */
export interface BuildPassDeps {
  connections: ConnectionProvider;
}

/** The free-text positions in PassFields that can fall back when the text is refused. */
type TextSlot = 'title' | 'venue' | 'room' | 'fromVenue' | 'nextVenue' | 'attendeeName';

type WalkFromPrevious = { minutes: number; fromVenue: string };
type NextConnection = {
  sessionCode: string;
  startsAt: string;
  venue: string;
  walkMinutes: number;
};

/** The unvalidated candidate, shaped like PassFields with every text value normalised. */
interface Candidate {
  sessionCode: string;
  title: string;
  venue: string;
  room: string;
  startsAt: string;
  endsAt: string;
  walkFromPrevious?: WalkFromPrevious;
  nextConnection?: NextConnection;
  attendeeName?: string;
}

/**
 * Cut text to at most the given number of UTF-16 code units without splitting a
 * surrogate pair: when the cut would leave a lone high surrogate, that unit is dropped.
 */
function cutAtUnits(text: string, units: number): string {
  const cut = text.slice(0, units);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Apply the title length rule: over eighty characters becomes seventy-seven plus "...". */
function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) {
    return title;
  }
  return `${cutAtUnits(title, TRUNCATED_TITLE_LENGTH)}${ASCII_ELLIPSIS}`;
}

/** Clamp a known walk to the schema bounds, rounding to whole minutes. Undefined stays unknown. */
function knownWalk(minutes: number | undefined): number | undefined {
  if (minutes === undefined || !Number.isFinite(minutes)) {
    return undefined;
  }
  return Math.min(MAX_WALK_MINUTES, Math.max(MIN_WALK_MINUTES, Math.round(minutes)));
}

/** The venue of the previous commitment: a session venue or a layover location. */
function previousVenue(previous: AdjacentCommitment): string {
  const { commitment } = previous;
  return (commitment.kind === 'reservedSession' ? commitment.venue : commitment.location) ?? '';
}

/**
 * Name the text slot a schema issue points at, or undefined when the issue is not about
 * free text. A too-long title is not a text failure: the title is truncated instead.
 */
function failedSlot(issue: { path: PropertyKey[]; code: string }): TextSlot | undefined {
  const [first, second] = issue.path;
  if (first === 'title') {
    return issue.code === 'too_big' ? undefined : 'title';
  }
  if (first === 'venue' || first === 'room' || first === 'attendeeName') {
    return first;
  }
  if (first === 'walkFromPrevious' && second === 'fromVenue') {
    return 'fromVenue';
  }
  if (first === 'nextConnection' && second === 'venue') {
    return 'nextVenue';
  }
  return undefined;
}

/** Replace every refused text value with its fallback. The refused text is dropped unread. */
function applyFallbacks(candidate: Candidate, failed: ReadonlySet<TextSlot>): Candidate {
  const next: Candidate = { ...candidate };
  if (failed.has('title')) {
    next.title = TITLE_FALLBACK;
  }
  if (failed.has('venue')) {
    next.venue = '';
  }
  if (failed.has('room')) {
    next.room = '';
  }
  if (failed.has('attendeeName')) {
    delete next.attendeeName;
  }
  // A nested slot can only fail when its parent object was in the candidate, so the
  // parent is known to exist here.
  if (failed.has('fromVenue')) {
    next.walkFromPrevious = { ...(next.walkFromPrevious as WalkFromPrevious), fromVenue: '' };
  }
  if (failed.has('nextVenue')) {
    next.nextConnection = { ...(next.nextConnection as NextConnection), venue: '' };
  }
  return next;
}

/** Build the PassFields schema, turning a malformed window into a safe PassError. */
function windowSchema(eventWindow: EventWindow): ReturnType<typeof createPassFieldsSchema> {
  try {
    return createPassFieldsSchema(eventWindow);
  } catch {
    throw passError('builder.invalid_input', 'The event window is not valid.');
  }
}

/** Assemble the normalised candidate from the input, calling the connection provider. */
function assembleCandidate(
  input: BuildPassInput,
  connections: ConnectionProvider,
  startsAt: string,
  endsAt: string,
): Candidate {
  const { session, previous, next, attendeeName } = input;
  const sessionVenue = session.venue ?? '';
  const candidate: Candidate = {
    sessionCode: session.code,
    title: normalisePassText(session.title),
    venue: normalisePassText(sessionVenue),
    room: normalisePassText(session.room ?? ''),
    startsAt,
    endsAt,
  };

  if (previous) {
    const fromVenue = previousVenue(previous);
    const minutes = knownWalk(connections.walkMinutes(fromVenue, sessionVenue));
    if (minutes !== undefined) {
      candidate.walkFromPrevious = { minutes, fromVenue: normalisePassText(fromVenue) };
    }
  }

  if (next) {
    const walkMinutes = knownWalk(connections.walkMinutes(sessionVenue, next.venue));
    if (walkMinutes !== undefined) {
      candidate.nextConnection = {
        sessionCode: next.sessionCode,
        startsAt: next.startsAt,
        venue: normalisePassText(next.venue),
        walkMinutes,
      };
    }
  }

  if (attendeeName !== undefined) {
    candidate.attendeeName = cutAtUnits(normalisePassText(attendeeName), MAX_NAME_LENGTH);
  }
  return candidate;
}

/**
 * Build the validated PassFields for one confirmed session. Throws a PassError with code
 * builder.invalid_input when the session cannot form a pass at all (no start or end, a
 * session code outside the pattern, times outside the event window); the summary never
 * carries any input. Refused text never throws: it falls back as described above.
 */
export function buildPass(input: BuildPassInput, deps: BuildPassDeps): BuildPassResult {
  const { session } = input;
  const schema = windowSchema(input.eventWindow);
  if (session.startsAt === undefined || session.endsAt === undefined) {
    throw passError('builder.invalid_input', 'The session has no start or end time.');
  }

  const assembled = assembleCandidate(input, deps.connections, session.startsAt, session.endsAt);

  // First pass: judge the full normalised text, then substitute fallbacks and truncate.
  const firstIssues = schema.safeParse(assembled).error?.issues ?? [];
  const firstFailed = new Set(firstIssues.map(failedSlot).filter((slot) => slot !== undefined));
  const firstPass = applyFallbacks(assembled, firstFailed);
  firstPass.title = truncateTitle(firstPass.title);

  // Second pass: the cut title can in rare cases form a refused token (for example a
  // domain), so judge again and fall back once more before the final parse.
  const secondIssues = schema.safeParse(firstPass).error?.issues ?? [];
  const secondFailed = new Set(secondIssues.map(failedSlot).filter((slot) => slot !== undefined));
  const finalCandidate = applyFallbacks(firstPass, secondFailed);

  const result = schema.safeParse(finalCandidate);
  if (!result.success) {
    throw passError('builder.invalid_input', 'The session cannot be turned into a valid pass.');
  }
  return { fields: result.data };
}
