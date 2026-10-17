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
import { CALENDAR_FILE_NAME, joinInFolder, OUTPUT_FOLDER_NAME } from './app-data.js';
import { BOARDING_CLOSES_MINUTES, parseInstant } from './boarding.js';
import type { AppDataResolver, Clock, FileSystem } from './interfaces.js';
import type { EventWindow, Itinerary, ItineraryCommitment } from './models.js';
import { passError } from './redaction.js';

/** The calendar file is personal data: owner read and write only. */
export const CALENDAR_FILE_MODE = 0o600;

/** The domain part of every UID. */
const UID_DOMAIN = 'reinvent-compass';
/** The most minutes a walk can be, as in the PassFields schema. */
const MAX_WALK_MINUTES = 90;

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

/** The UID local part for a commitment, before any duplicate suffix. */
function uidKey(entry: ItineraryCommitment): string {
  const { commitment } = entry;
  if (commitment.kind === 'reservedSession') {
    return `session-${commitment.sessionId}`;
  }
  return `layover-${commitment.personalTimeId ?? shortHash(`${commitment.title}|${commitment.startsAt}`)}`;
}

/**
 * Make free text safe for an iCalendar TEXT value: control characters (which the format
 * forbids, and which would let a title break a line) become spaces.
 */
function cleanText(text: string, fallback: string): string {
  const cleaned = Array.from(text, (character) => {
    const code = character.codePointAt(0) as number;
    return code < 0x20 || code === 0x7f ? ' ' : character;
  })
    .join('')
    .trim();
  return cleaned === '' ? fallback : cleaned;
}

/** Check a carried walk: absent, or a finite number of minutes from 0 to 90. */
function checkedWalk(entry: ItineraryCommitment): number | undefined {
  const { walkMinutes } = entry;
  if (walkMinutes === undefined) {
    return undefined;
  }
  if (!Number.isFinite(walkMinutes) || walkMinutes < 0 || walkMinutes > MAX_WALK_MINUTES) {
    throw passError('ics.invalid_commitment', 'A walk time in the itinerary is not valid.');
  }
  return Math.round(walkMinutes);
}

/** Build the Ics_Exporter over its seams. */
export function createIcsExporter(deps: IcsExporterDeps): IcsExporter {
  const { fs, appData, clock } = deps;

  function buildCalendar(itinerary: Itinerary, window: EventWindow): string {
    const calendar = ical({
      name: 're:Invent Compass itinerary',
      description: `Event times are written in UTC. The event timezone is ${window.timezone}.`,
      prodId: { company: UID_DOMAIN, product: 'boarding-passes', language: 'EN' },
    });
    const stamp = clock.now();
    const seen = new Map<string, number>();

    for (const entry of itinerary.commitments) {
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

      // Two commitments that would share a UID get a numeric suffix, so every UID in the
      // file is unique and a rebuild gives the same UIDs.
      const key = uidKey(entry);
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      const uid = `${count === 0 ? key : `${key}-${String(count)}`}@${UID_DOMAIN}`;

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
        await fs.ensureDir(folder);
        await fs.writeFile(path, text, CALENDAR_FILE_MODE);
      } catch {
        throw passError('ics.write_failed', 'The calendar file could not be written.');
      }
      return path;
    },
  };
}
