import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DEMO_CODES,
  SOURCE,
  WINDOW,
  buildSnapshot,
  officialVenue,
  runCli,
  runDefault,
} from '../../scripts/make-demo-sessions.mjs';

const OFFICIAL = ['Caesars Forum', 'Caesars Palace', 'Encore', 'MGM Grand', 'The Venetian', 'Wynn'];

function session(code: string, extra: Record<string, unknown> = {}): { session: object } {
  return {
    session: {
      sessionId: `id-${code}`,
      code,
      title: `Title of ${code}`,
      type: 'Chalk talk',
      level: '300',
      venue: 'MGM Grand',
      room: 'Level 1 | Room 1',
      startsAt: '2026-12-01T10:00:00-08:00',
      endsAt: '2026-12-01T11:00:00-08:00',
      isAllDay: false,
      isReservable: true,
      seatAvailability: 'available',
      abstract: 'An abstract that must never be copied.',
      speakers: ['A speaker'],
      ...extra,
    },
  };
}

const cache = (entries: object[]) => ({
  fetchedAt: '2026-10-29T10:23:39.262+00:00',
  eventId: 'reinvent2026',
  entries,
});

describe('officialVenue', () => {
  test('maps the catalog spellings to the official names', () => {
    expect(officialVenue({ code: 'A', venue: 'Venetian' })).toBe('The Venetian');
    expect(officialVenue({ code: 'A', venue: 'The Venetian' })).toBe('The Venetian');
    expect(officialVenue({ code: 'A', venue: 'MGM Grand' })).toBe('MGM Grand');
    expect(officialVenue({ code: 'A' })).toBeUndefined();
  });

  test('splits Wynn/Encore only by a room that names the resort', () => {
    const base = { code: 'A', venue: 'Wynn/Encore' };
    expect(officialVenue({ ...base, room: 'Level 1 | Encore Ballroom 3' })).toBe('Encore');
    expect(officialVenue({ ...base, room: 'Convention Promenade | Latour 5' })).toBe('Wynn');
    expect(() => officialVenue({ ...base, room: 'Level 1 | Chopin 2' })).toThrow(/Wynn or Encore/);
    expect(() => officialVenue(base)).toThrow(/Wynn or Encore/);
  });
});

describe('buildSnapshot', () => {
  test('copies the six fields only, in the order of the codes, with the credit and fetch time', () => {
    const snapshot = buildSnapshot(cache([session('B'), session('A')]), OFFICIAL, ['A', 'B']);
    expect(snapshot.source).toBe(SOURCE);
    expect(snapshot.fetchedAt).toBe('2026-10-29T10:23:39.262+00:00');
    expect(snapshot.sessions.map((s) => s['code'])).toEqual(['A', 'B']);
    expect(Object.keys(snapshot.sessions[0] ?? {}).sort()).toEqual([
      'code',
      'endsAt',
      'room',
      'startsAt',
      'title',
      'venue',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('abstract');
    expect(JSON.stringify(snapshot)).not.toContain('speaker');
  });

  test('leaves out a venue or room the catalog does not give', () => {
    const entry = session('A', { venue: undefined, room: '' });
    const snapshot = buildSnapshot(cache([entry]), OFFICIAL, ['A']);
    expect(Object.keys(snapshot.sessions[0] ?? {}).sort()).toEqual([
      'code',
      'endsAt',
      'startsAt',
      'title',
    ]);
  });

  test('refuses a missing code, an unofficial venue and a time outside the event window', () => {
    expect(() => buildSnapshot(cache([]), OFFICIAL, ['A'])).toThrow('A is not in the catalog');
    expect(() =>
      buildSnapshot(cache([session('A', { venue: 'Mandalay Bay' })]), OFFICIAL, ['A']),
    ).toThrow(/not an official venue/);
    const late = session('A', {
      startsAt: '2026-12-05T10:00:00-08:00',
      endsAt: '2026-12-05T11:00:00-08:00',
    });
    expect(() => buildSnapshot(cache([late]), OFFICIAL, ['A'])).toThrow(/outside the event window/);
    const backwards = session('A', {
      startsAt: '2026-12-01T11:00:00-08:00',
      endsAt: '2026-12-01T10:00:00-08:00',
    });
    expect(() => buildSnapshot(cache([backwards]), OFFICIAL, ['A'])).toThrow(
      /outside the event window/,
    );
  });

  test('the demo codes are unique and the window is the demo event', () => {
    expect(new Set(DEMO_CODES).size).toBe(DEMO_CODES.length);
    expect(DEMO_CODES.length).toBeGreaterThanOrEqual(15);
    expect(DEMO_CODES.length).toBeLessThanOrEqual(20);
    expect(WINDOW.start).toBe('2026-11-30T00:00:00-08:00');
  });
});

describe('runCli', () => {
  test('writes the snapshot, reads the default cache under APPDATA, and reports failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'demo-sessions-'));
    try {
      const appData = join(dir, 'appdata');
      await mkdir(join(appData, 'reinvent-compass'), { recursive: true });
      const entries = DEMO_CODES.map((code) => session(code));
      await writeFile(
        join(appData, 'reinvent-compass', 'catalog-cache.reinvent2026.json'),
        JSON.stringify(cache(entries)),
      );
      const venuesPath = join(dir, 'venues.json');
      await writeFile(
        venuesPath,
        JSON.stringify({ venues: OFFICIAL.map((name) => ({ venue: { name } })) }),
      );
      const outputPath = join(dir, 'out.json');
      const ok = await runCli({ appData, venuesPath, outputPath });
      expect(ok.code).toBe(0);
      expect(ok.stdout).toContain(`Wrote ${String(DEMO_CODES.length)} sessions`);
      const written = JSON.parse(await readFile(outputPath, 'utf8')) as { sessions: unknown[] };
      expect(written.sessions).toHaveLength(DEMO_CODES.length);

      const missing = await runCli({ cachePath: join(dir, 'nope.json'), venuesPath, outputPath });
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain('ENOENT');

      const noAppData = await runCli({ venuesPath, outputPath });
      expect(noAppData.code).toBe(1);

      const thrown = await runCli({
        cachePath: join(dir, 'bad.json'),
        venuesPath,
        outputPath,
      }).catch(() => null);
      expect(thrown?.code).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('runDefault takes the cache path from the first argument', async () => {
    const original = process.argv[2];
    process.argv[2] = join(tmpdir(), 'demo-sessions-no-such-cache.json');
    try {
      const result = await runDefault();
      expect(result.code).toBe(1);
    } finally {
      if (original === undefined) {
        process.argv.length = 2;
      } else {
        process.argv[2] = original;
      }
    }
  });

  test('reports a cache that is not a catalog', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'demo-sessions-'));
    try {
      const cachePath = join(dir, 'cache.json');
      await writeFile(cachePath, 'null');
      const result = await runCli({ cachePath, venuesPath: join(dir, 'v.json') });
      expect(result.code).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
