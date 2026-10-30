// Demo session snapshot maker (showcase-site, Component 6, task 41).
//
// Reads a local copy of the AWS Events API catalog (the cache file the desktop app writes) and
// writes src/lib/demo/demo-sessions.json, the committed snapshot the Demo_Page uses.
//
// The owner rule (docs/hackathon-rules.md, row 11): the demo carries the session code, title,
// start, end, venue and room only, credited to the AWS Events API. This script therefore
//   - picks sessions by the explicit codes listed below, never by a query;
//   - copies exactly those six fields and nothing else (no abstract, speaker, type, level,
//     seat or reservation data);
//   - gives the snapshot a source credit and the time the catalog was fetched;
//   - refuses to write when a session is missing, a time is outside the event window, or a
//     venue is not one of the six official 2026 names in data/venues.json.
//
// Run from the repository root; the default catalog path is under APPDATA.
//
// Venue names: the catalog says "Venetian" for The Venetian and "Wynn/Encore" for both Wynn and
// Encore. The first is mapped to the official name. The second is split by the room, and only
// where the room says which resort it is in: "Encore Ballroom ..." is Encore and "... Convention
// Promenade ..." is Wynn. Any other "Wynn/Encore" room stops the script.
//
// The cache file is never committed and is only read here. Run from the repository root:
//   node site/scripts/make-demo-sessions.mjs [path-to-catalog-cache.json]
// The default path is the desktop app cache under APPDATA.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maybeRunCli } from './cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, '..', 'src', 'lib', 'demo', 'demo-sessions.json');
const VENUES = join(HERE, '..', '..', 'data', 'venues.json');

export const SOURCE = Object.freeze({
  name: 'AWS Events API',
  note: 'Session code, title, start, end, venue and room only. Not affiliated with AWS.',
});

/** The window of the demo event, in event local time (-08:00). */
export const WINDOW = Object.freeze({
  start: '2026-11-30T00:00:00-08:00',
  end: '2026-12-04T23:59:00-08:00',
});

/** The sessions of the demo, by code, in the order the snapshot lists them. */
export const DEMO_CODES = Object.freeze([
  // Monday 30 November
  'INV530-R1',
  'CMP325-R',
  'TNC334-R',
  'CMP340',
  // Tuesday 1 December
  'KEY002',
  'AIM433',
  'SEC318-R1',
  'ANT414',
  'COP304',
  'IND3304-R1',
  // Wednesday 2 December
  'ACT053',
  'SEC318-R',
  // Thursday 3 December
  'STG412',
  'SNR309',
  'TNC334-R1',
  'ANT402-R1',
  'SEC411',
]);

/** The only fields copied from the catalog. */
const FIELDS = Object.freeze(['code', 'title', 'venue', 'room', 'startsAt', 'endsAt']);

/**
 * The official venue name for a catalog session, or undefined when the catalog gives no venue
 * that is one of the six. Throws when a "Wynn/Encore" room does not say which resort it is in.
 * @param {{ code: string, venue?: string, room?: string }} session
 * @returns {string | undefined}
 */
export function officialVenue(session) {
  const { venue, room = '' } = session;
  if (venue === 'Venetian' || venue === 'The Venetian') {
    return 'The Venetian';
  }
  if (venue === 'Wynn/Encore') {
    if (/Encore Ballroom/.test(room)) {
      return 'Encore';
    }
    if (/Convention Promenade/.test(room)) {
      return 'Wynn';
    }
    throw new Error(
      `${session.code}: the room "${room}" does not say whether it is Wynn or Encore`,
    );
  }
  return venue;
}

/**
 * Build the snapshot from the parsed cache file.
 * @param {{ fetchedAt: string, eventId: string, entries: { session: Record<string, unknown> }[] }} cache
 * @param {readonly string[]} officialNames
 * @param {readonly string[]} [codes] the sessions to take, by code (default: DEMO_CODES)
 */
export function buildSnapshot(cache, officialNames, codes = DEMO_CODES) {
  const byCode = new Map(cache.entries.map((entry) => [entry.session.code, entry.session]));
  const startMs = Date.parse(WINDOW.start);
  const endMs = Date.parse(WINDOW.end);
  const sessions = codes.map((code) => {
    const found = byCode.get(code);
    if (found === undefined) {
      throw new Error(`${code} is not in the catalog cache`);
    }
    const venue = officialVenue(found);
    if (venue !== undefined && !officialNames.includes(venue)) {
      throw new Error(`${code}: "${venue}" is not an official venue`);
    }
    const from = Date.parse(String(found.startsAt));
    const to = Date.parse(String(found.endsAt));
    if (!(from >= startMs && to <= endMs && from < to)) {
      throw new Error(`${code}: its times are outside the event window`);
    }
    const copy = { ...found, venue };
    /** @type {Record<string, string>} */
    const record = {};
    for (const field of FIELDS) {
      const value = copy[field];
      if (typeof value === 'string' && value !== '') {
        record[field] = value;
      }
    }
    return record;
  });
  return { source: SOURCE, fetchedAt: cache.fetchedAt, eventId: cache.eventId, sessions };
}

/**
 * Read the cache and the venue file, build the snapshot and write it. Paths are parameters so a
 * test can use temporary files.
 *
 * @param {{ cachePath?: string, appData?: string, venuesPath?: string, outputPath?: string }} options
 * @returns {Promise<{ code: number, stdout?: string, stderr?: string }>}
 */
export async function runCli({
  cachePath,
  appData = '',
  venuesPath = VENUES,
  outputPath = OUTPUT,
} = {}) {
  const source = cachePath ?? join(appData, 'reinvent-compass', 'catalog-cache.reinvent2026.json');
  try {
    const cache = JSON.parse(await readFile(source, 'utf8'));
    const venueFile = JSON.parse(await readFile(venuesPath, 'utf8'));
    const names = venueFile.venues.map((entry) => entry.venue.name);
    const snapshot = buildSnapshot(cache, names);
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return {
      code: 0,
      stdout: `Wrote ${String(snapshot.sessions.length)} sessions to ${outputPath}\n`,
    };
  } catch (error) {
    // Every failure here is an Error: a missing or invalid file, or a check in buildSnapshot.
    return { code: 1, stderr: `${/** @type {Error} */ (error).message}\n` };
  }
}

/** The command line run: the first argument is the cache path, else the app cache under APPDATA. */
export function runDefault() {
  return runCli({ cachePath: process.argv[2], appData: process.env['APPDATA'] });
}

await maybeRunCli({ runCli: runDefault, argv1: process.argv[1], metaUrl: import.meta.url });
