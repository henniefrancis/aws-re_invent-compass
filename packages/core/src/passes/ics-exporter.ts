// Ics_Exporter for the pass side (boarding-passes, S4, Requirement 6).
//
// buildCalendar turns the itinerary into RFC 5545 text with ical-generator: one VEVENT per
// commitment, every time in UTC with the Z designator and no TZID or VTIMEZONE (so the file is
// unambiguous on every device). A reserved session gets a "boarding closes" alarm ten minutes
// before the start and, when the itinerary carries a walk from an earlier commitment, a
// "leave now" alarm that many minutes earlier still. writeCalendar writes the text only into
// the app-data output folder, with mode 0600 because it is personal data.
//
// Each event has a stable UID, so importing a regenerated file updates events rather than
// duplicating them: a reserved session keys on its session id, a layover on its
// personalTimeId or, when it has none, on a hash of its title and start.
import { createHash } from 'node:crypto';
import ical, { ICalAlarmType } from 'ical-generator';
import { APP_DIR_MODE, CALENDAR_FILE_NAME, joinInFolder, OUTPUT_FOLDER_NAME } from './app-data.js';
import { BOARDING_CLOSES_MINUTES, parseInstant, validWalkMinutes } from './boarding.js';
import type { AppDataResolver, Clock, FileSystem } from './interfaces.js';
import type { EventWindow, Itinerary, ItineraryCommitment } from './models.js';
import { passError } from './redaction.js';
import { cleanDisplayText } from './text-safety.js';

/** The calendar file is personal data: owner read and write only. */
export const CALENDAR_FILE_MODE = 0o600;

/** The domain part of every UID. */
const UID_DOMAIN = 'reinvent-compass';

/** What the exporter needs. */
export interface IcsExporterDeps {
  fs: FileSystem;
  appData: AppDataResolver;
  /** Supplies DTSTAMP, so a build is deterministic under a fixed clock. */
  clock: Clock;
}

/** The Ics_Exporter. */
export interface IcsExporter {
  /** RFC 5545 text for the itinerary. */
  buildCalendar(itinerary: Itinerary, window: EventWindow): string;
  /** Build the calendar and write it into the app-data output folder. Returns the path. */
  writeCalendar(itinerary: Itinerary, window: EventWindow): Promise<string>;
}

/** A short stable hash for a UID, from the text it is built over. */
function shortHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 24);
}

/** An identifier safe to put in a UID as it is. Anything else is replaced by a hash of itself. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function safeId(id: string): string {
  return SAFE_ID.test(id) ? id : shortHash(id);
}

/**
 * The UID local part for a commitment, before any duplicate suffix. A reserved session keys on
 * its session id and a layover on its personalTimeId, so the UID does not change when the event
 * moves and a re-import updates the event instead of duplicating it. A layover with no id keys
 * on a hash of its title and start.
 */
function uidKey(entry: ItineraryCommitment): string {
  const { commitment } = entry;
  if (commitment.kind === 'reservedSession') {
    return `session-${safeId(commitment.sessionId)}`;
  }
  return `layover-${safeId(commitment.personalTimeId ?? shortHash(`${commitment.title}|${commitment.startsAt}`))}`;
}

/**
 * One UID per commitment, in itinerary order. Commitments that share a key are numbered in the
 * order of their start time: the earliest keeps the plain UID, the next gets -2, then -3. If a
 * duplicate is moved past another, the suffixes swap between them (a known limit of keying on
 * the id alone).
 */
function assignUids(entries: ItineraryCommitment[]): string[] {
  const starts = entries.map((entry) => parseInstant(entry.commitment.startsAt).getTime());
  const groups = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const key = uidKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const uids: string[] = [];
  for (const [key, indices] of groups) {
    indices
      .sort((a, b) => (starts[a] as number) - (starts[b] as number))
      .forEach((index, order) => {
        uids[index] = `${order === 0 ? key : `${key}-${String(order + 1)}`}@${UID_DOMAIN}`;
      });
  }
  return uids;
}

/** Display text for an iCalendar TEXT value, with a fallback when nothing is left. */
function cleanText(text: string, fallback: string): string {
  const cleaned = cleanDisplayText(text);
  return cleaned === '' ? fallback : cleaned;
}

/** Check a carried walk: absent, or whole minutes from 0 to 90. */
function checkedWalk(entry: ItineraryCommitment): number | undefined {
  if (entry.walkMinutes === undefined) {
    return undefined;
  }
  const walk = validWalkMinutes(entry.walkMinutes);
  if (walk === undefined) {
    throw passError('ics.invalid_commitment', 'A walk time in the itinerary is not valid.');
  }
  return walk;
}

/** Build the Ics_Exporter over its seams. */
export function createIcsExporter(deps: IcsExporterDeps): IcsExporter {
  const { fs, appData, clock } = deps;

  function buildCalendar(itinerary: Itinerary, window: EventWindow): string {
    // The timezone goes into the calendar description, so it must be a real zone, not text.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: window.timezone });
    } catch {
      throw passError('ics.invalid_window', 'The event timezone is not valid.');
    }
    const calendar = ical({
      name: 're:Invent Compass itinerary',
      description: `Event times are written in UTC. The event timezone is ${window.timezone}.`,
      prodId: { company: UID_DOMAIN, product: 'boarding-passes', language: 'EN' },
    });
    const stamp = clock.now();
    const uids = assignUids(itinerary.commitments);

    for (const [index, entry] of itinerary.commitments.entries()) {
      const { commitment } = entry;
      const start = parseInstant(commitment.startsAt);
      const end = parseInstant(commitment.endsAt);
      if (end.getTime() <= start.getTime()) {
        throw passError(
          'ics.invalid_commitment',
          'A commitment in the itinerary ends before it starts.',
        );
      }
      const walk = checkedWalk(entry);

      const uid = uids[index] as string;

      if (commitment.kind === 'reservedSession') {
        const title = cleanText(commitment.title ?? '', 'Reserved session');
        const event = calendar.createEvent({
          id: uid,
          stamp,
          start,
          end,
          summary: title,
          location: cleanText(commitment.venue ?? '', ''),
          description: `Reserved session. Boarding closes ${String(BOARDING_CLOSES_MINUTES)} minutes before the start, when your seat can be released to walk-ups.`,
        });
        if (walk !== undefined) {
          event.createAlarm({
            type: ICalAlarmType.display,
            triggerBefore: (BOARDING_CLOSES_MINUTES + walk) * 60,
            description: `Leave now: ${title}`,
          });
        }
        event.createAlarm({
          type: ICalAlarmType.display,
          triggerBefore: BOARDING_CLOSES_MINUTES * 60,
          description: `Boarding closes: ${title}`,
        });
      } else {
        calendar.createEvent({
          id: uid,
          stamp,
          start,
          end,
          summary: cleanText(commitment.title, 'Layover'),
          location: cleanText(commitment.location ?? '', ''),
          description: 'Layover (personal time).',
        });
      }
    }
    // RFC 5545 ends every content line, the last included, with CRLF.
    return `${calendar.toString()}\r\n`;
  }

  return {
    buildCalendar,

    async writeCalendar(itinerary, window) {
      const text = buildCalendar(itinerary, window);
      const folder = joinInFolder(appData.resolve(), OUTPUT_FOLDER_NAME);
      const path = joinInFolder(folder, CALENDAR_FILE_NAME);
      try {
        await fs.ensureDir(folder, APP_DIR_MODE);
        await fs.writeFile(path, text, CALENDAR_FILE_MODE);
      } catch {
        throw passError('ics.write_failed', 'The calendar file could not be written.');
      }
      return path;
    },
  };
}
