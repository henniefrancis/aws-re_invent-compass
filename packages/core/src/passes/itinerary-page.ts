// Itinerary_Page for the pass side (boarding-passes, S4, Requirement 7). Built last: it is
// cut-list item 1, the first thing to drop if time runs out.
//
// render turns the itinerary into one self-contained HTML document: all CSS inlined, no
// script, no inline event handler, no external resource and no network request (a Content
// Security Policy meta tag forbids them as a second line of defence). The event timezone is
// stated once, in a sentence under the heading, and every time on the page is in event local
// time. The structure supports WCAG 2.2 AA: a document language, a page title, one h1 with
// h2 per day and h3 per item in document order, a list whose items hold description lists,
// a viewport meta tag, a layout that reflows to 320 CSS pixels (no fixed widths, long text
// wraps) and a palette whose text contrast is checked in the tests. Full conformance still
// needs manual assistive-technology testing and expert review.
import {
  BOARDING_CLOSES_MINUTES,
  boardingClosesAt,
  parseInstant,
  validWalkMinutes,
} from './boarding.js';
import { APP_DIR_MODE, ITINERARY_FILE_NAME, joinInFolder, OUTPUT_FOLDER_NAME } from './app-data.js';
import type { AppDataResolver, FileSystem } from './interfaces.js';
import type { EventWindow, Itinerary, ItineraryCommitment } from './models.js';
import { passError } from './redaction.js';
import { cleanDisplayText } from './text-safety.js';

/** The page is personal data: owner read and write only. */
export const ITINERARY_FILE_MODE = 0o600;

/** The text shown as the gate when a session has no published venue. */
export const VENUE_NOT_PUBLISHED = 'Venue not published';

/** The page title. */
export const PAGE_TITLE = 're:Invent Compass itinerary';

/** The colours the page uses. The tests compute the contrast of each text colour on its background. */
export const PALETTE = {
  background: '#ffffff',
  text: '#1a1a1a',
  mutedText: '#4a4a4a',
  border: '#767676',
} as const;

/** The inlined stylesheet. No fixed widths: layout is fluid and long text wraps. */
const STYLES = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;padding:1rem;background:${PALETTE.background};color:${PALETTE.text};font:1rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
main{max-width:40rem;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 .5rem}
h2{font-size:1.25rem;margin:1.5rem 0 .5rem;padding-bottom:.25rem;border-bottom:2px solid ${PALETTE.border}}
h3{font-size:1rem;margin:0}
ol{list-style:none;margin:0;padding:0}
li{margin:0 0 .75rem;padding:.75rem;border:1px solid ${PALETTE.border};border-radius:.5rem}
.when{margin:0 0 .25rem;color:${PALETTE.mutedText}}
.note{color:${PALETTE.mutedText}}
dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem .75rem;margin:.5rem 0 0}
dt{font-weight:600}
dd{margin:0}
`.trim();

/** What the page needs to write itself. */
export interface ItineraryPageDeps {
  fs: FileSystem;
  appData: AppDataResolver;
}

/** The Itinerary_Page. */
export interface ItineraryPage {
  /** One self-contained HTML document. */
  render(itinerary: Itinerary, window: EventWindow): string;
  /** Render and write into the app-data output folder. Returns the path. */
  write(itinerary: Itinerary, window: EventWindow): Promise<string>;
}

/** Escape text for HTML element content and double-quoted attribute values. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One local-time reading of an instant. */
interface LocalTime {
  day: string;
  time: string;
}

/** Build the event-local formatter, turning a bad timezone into a safe PassError. */
function localTimeReader(timezone: string): (at: Date) => LocalTime {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw passError('itinerary.invalid_window', 'The event timezone is not valid.');
  }
  return (at) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(at).map((part) => [part.type, part.value]),
    ) as Record<'weekday' | 'day' | 'month' | 'year' | 'hour' | 'minute', string>;
    return {
      day: `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`,
      time: `${parts.hour}:${parts.minute}`,
    };
  };
}

/** The description list rows for one entry, as HTML. */
function detailRows(entry: ItineraryCommitment, read: (at: Date) => LocalTime): string[] {
  const { commitment } = entry;
  const rows: string[] = [];
  if (commitment.kind === 'reservedSession') {
    const venue = cleanDisplayText(commitment.venue ?? '');
    rows.push(`<dt>Gate</dt><dd>${escapeHtml(venue === '' ? VENUE_NOT_PUBLISHED : venue)}</dd>`);
    // Boarding closes ten minutes before the start, which can be the day before: then the
    // date is shown with the time.
    const closes = read(boardingClosesAt(commitment.startsAt));
    const closesAt =
      closes.day === read(parseInstant(commitment.startsAt)).day
        ? closes.time
        : `${closes.day}, ${closes.time}`;
    rows.push(
      `<dt>Boarding closes</dt><dd>${escapeHtml(closesAt)} (${String(BOARDING_CLOSES_MINUTES)} minutes before the start)</dd>`,
    );
    const walk = entry.walkMinutes === undefined ? undefined : validWalkMinutes(entry.walkMinutes);
    if (walk !== undefined) {
      rows.push(
        `<dt>Connection</dt><dd>${String(walk)} minutes' walk from your previous stop</dd>`,
      );
    }
  } else {
    const location = cleanDisplayText(commitment.location ?? '');
    if (location !== '') {
      rows.push(`<dt>Location</dt><dd>${escapeHtml(location)}</dd>`);
    }
  }
  return rows;
}

/** Build the Itinerary_Page over its seams. */
export function createItineraryPage(deps: ItineraryPageDeps): ItineraryPage {
  const { fs, appData } = deps;

  function render(itinerary: Itinerary, window: EventWindow): string {
    const read = localTimeReader(window.timezone);
    const rows = itinerary.commitments
      .map((entry) => ({
        entry,
        start: parseInstant(entry.commitment.startsAt),
        end: parseInstant(entry.commitment.endsAt),
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const body: string[] = [
      '<h1>Your re:Invent itinerary</h1>',
      `<p class="note">All times are in event local time, <strong>${escapeHtml(window.timezone)}</strong>.</p>`,
    ];
    if (rows.length === 0) {
      body.push('<p>Nothing is reserved yet.</p>');
    }

    let currentDay = '';
    let open = false;
    for (const { entry, start, end } of rows) {
      const { commitment } = entry;
      const day = read(start).day;
      if (day !== currentDay) {
        if (open) {
          body.push('</ol>');
        }
        body.push(`<h2>${escapeHtml(day)}</h2>`, '<ol>');
        currentDay = day;
        open = true;
      }
      const isSession = commitment.kind === 'reservedSession';
      const cleanTitle = cleanDisplayText(commitment.title ?? '');
      const title = cleanTitle === '' ? (isSession ? 'Reserved session' : 'Layover') : cleanTitle;
      const details = detailRows(entry, read);
      body.push(
        '<li>',
        `<p class="when"><time datetime="${escapeHtml(commitment.startsAt)}">${read(start).time}</time> to <time datetime="${escapeHtml(commitment.endsAt)}">${read(end).time}</time>${isSession ? '' : ' (layover)'}</p>`,
        `<h3>${escapeHtml(title)}</h3>`,
      );
      if (details.length > 0) {
        body.push(`<dl>${details.join('')}</dl>`);
      }
      body.push('</li>');
    }
    if (open) {
      body.push('</ol>');
    }

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`,
      `<title>${PAGE_TITLE}</title>`,
      `<style>${STYLES}</style>`,
      '</head>',
      '<body>',
      '<main>',
      ...body,
      '</main>',
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }

  return {
    render,

    async write(itinerary, window) {
      const html = render(itinerary, window);
      const folder = joinInFolder(appData.resolve(), OUTPUT_FOLDER_NAME);
      const path = joinInFolder(folder, ITINERARY_FILE_NAME);
      try {
        await fs.ensureDir(folder, APP_DIR_MODE);
        await fs.writeFile(path, html, ITINERARY_FILE_MODE);
      } catch {
        throw passError('itinerary.write_failed', 'The itinerary page could not be written.');
      }
      return path;
    },
  };
}
