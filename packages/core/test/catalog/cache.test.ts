import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  CACHE_DIR_MODE,
  CACHE_FILE_MODE,
  CACHE_FILE_PREFIX,
  DEFAULT_MAX_AGE_SECONDS,
  MAX_CACHE_BYTES,
  TEMP_MAX_AGE_MS,
  cacheFilePath,
  isoWithOffset,
  readCache,
  readCatalog,
  realFs,
  refreshCatalog,
  safeEventIdForFileName,
  writeCache,
  type CacheEntry,
  type CatalogCache,
  type CatalogDeps,
} from '../../src/catalog/cache.js';
import { CacheWriteError, CatalogIncompleteError } from '../../src/catalog/errors.js';
import { normaliseSession } from '../../src/catalog/normalise.js';
import { createHarness, response } from '../api/operation-harness.js';
import { fakeFs, wireArb, type FakeFs } from './arbitraries.js';

// Tests for the on-disk catalog cache (events-client, S1, tasks 13.13 to 13.16 and the
// final-round findings M2, N5 and L5). A recording fake file system is used
// throughout, except one real temporary directory test that checks the POSIX mode.

const DIR = '/data/reinvent-compass';
const ZONE = 'America/Los_Angeles';
const EVENT = 'reinvent2026';
const NOW = 1_800_000_000_000;

const entryArb: fc.Arbitrary<CacheEntry> = wireArb.map((wire) => ({
  session: normaliseSession(wire, undefined, ZONE),
  wire,
}));
const msArb = fc.integer({ min: Date.parse('2026-01-01'), max: Date.parse('2027-01-01') });

function makeCache(
  entries: CacheEntry[],
  ms: number,
  overrides: Partial<CatalogCache> = {},
): CatalogCache {
  return {
    fetchedAt: isoWithOffset(ms),
    eventId: EVENT,
    includeAbstracts: true,
    entries,
    ...overrides,
  };
}

/** The wire sessions of a one-page ListSessions answer. */
function onePage(ids: string[]): ReturnType<typeof response> {
  return response(200, {
    items: ids.map((id) => ({ sessionId: id, title: `T ${id}`, venue: 'Wynn' })),
    totalCount: ids.length,
  });
}

function deps(
  h: ReturnType<typeof createHarness>,
  fs: FakeFs,
  overrides: Partial<CatalogDeps> = {},
): CatalogDeps {
  return { ctx: h.ctx, dir: DIR, fs, eventTimezone: ZONE, now: () => NOW, ...overrides };
}

describe('Feature: events-client, Property 26: Cache write and read round-trip atomically with an ISO-8601 timestamp', () => {
  // Validates: Requirements 14.4, 14.5, 14.6
  test('for any catalog and time, write then read returns the same envelope and an offset timestamp', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 5 }), msArb, fc.boolean(), (entries, ms, abs) => {
        const fs = fakeFs();
        const cache = makeCache(entries, ms, { includeAbstracts: abs });
        writeCache(DIR, cache, fs, NOW);
        const back = readCache(DIR, EVENT, fs);
        expect(back).toEqual(cache);
        expect(back?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
        expect(Date.parse(back?.fetchedAt ?? '')).toBe(ms);
      }),
      { numRuns: 100 },
    );
  });

  test('the write is atomic: temp file created with wx, renamed into place, dir 0o700, file 0o600', () => {
    const fs = fakeFs();
    writeCache(DIR, makeCache([], 0), fs, NOW);
    expect(fs.dirs).toEqual([{ path: DIR, mode: CACHE_DIR_MODE }]);
    expect(CACHE_DIR_MODE).toBe(0o700);
    expect(CACHE_FILE_MODE).toBe(0o600);
    const target = cacheFilePath(DIR, EVENT);
    const written = fs.calls.find((c) => c.startsWith('write '))?.split(' ')[1] ?? '';
    expect(fs.calls.find((c) => c.startsWith('write '))?.endsWith(' wx')).toBe(true);
    expect(written).not.toBe(target);
    expect(written.startsWith(target)).toBe(true);
    expect(written.endsWith('.tmp')).toBe(true);
    expect(fs.calls.at(-1)).toBe(`rename ${written} ${target}`);
    expect(fs.modes.get(target)).toBe(0o600);
    expect([...fs.files.keys()]).toEqual([target]);
  });

  test('a temp file that already exists is never overwritten (wx), so the write fails cleanly', () => {
    const fs = fakeFs();
    const original = makeCache([], 1);
    writeCache(DIR, original, fs, NOW);
    const target = cacheFilePath(DIR, EVENT);
    const before = fs.files.get(target);
    fs.writeFileSync(`${target}.preexisting.tmp`, 'x', { mode: 0o600, flag: 'wx' });
    expect(() => {
      fs.writeFileSync(`${target}.preexisting.tmp`, 'y', { mode: 0o600, flag: 'wx' });
    }).toThrow();
    expect(fs.files.get(target)).toBe(before);
  });

  test('a refresh overwrites the same file in place with new data and a new timestamp', async () => {
    const fs = fakeFs();
    let now = NOW;
    const first = createHarness({ responses: [onePage(['a'])] });
    await refreshCatalog(deps(first, fs, { now: () => now }));
    const before = readCache(DIR, EVENT, fs);
    now += 5000;
    const second = createHarness({ responses: [onePage(['b', 'c'])] });
    await refreshCatalog(deps(second, fs, { now: () => now }));
    const after = readCache(DIR, EVENT, fs);
    expect(before?.entries.map((e) => e.session.sessionId)).toEqual(['a']);
    expect(after?.entries.map((e) => e.session.sessionId)).toEqual(['b', 'c']);
    expect(Date.parse(after?.fetchedAt ?? '') - Date.parse(before?.fetchedAt ?? '')).toBe(5000);
    expect([...fs.files.keys()]).toEqual([cacheFilePath(DIR, EVENT)]);
    expect(after?.eventId).toBe(EVENT);
    expect(after?.includeAbstracts).toBe(true);
  });

  test('refresh normalises through the injected venue list and writes only inside the directory', async () => {
    const fs = fakeFs();
    const h = createHarness({
      responses: [
        response(200, {
          items: [{ sessionId: 'a', title: 'T', room: 'Venetian | Room 1' }],
          totalCount: 1,
        }),
      ],
    });
    const entries = await refreshCatalog(
      deps(h, fs, { venues: [{ name: 'Venetian' }], includeAbstracts: false }),
    );
    expect(entries[0]?.session.venue).toBe('Venetian');
    expect(h.sent[0]?.query?.includeAbstracts).toBe('false');
    expect(readCache(DIR, EVENT, fs)?.includeAbstracts).toBe(false);
    const touched = fs.calls
      .filter((c) => c.startsWith('write ') || c.startsWith('rename ') || c.startsWith('mkdir '))
      .flatMap((c) => c.split(' ').slice(1))
      .filter((p) => p.startsWith('/'));
    expect(touched.every((p) => p.startsWith(DIR))).toBe(true);
    expect(touched.some((p) => p.endsWith('venues.json'))).toBe(false);
  });

  test('a bad or absent venue list leaves venue recovery off', async () => {
    const fs = fakeFs();
    const h = createHarness({
      responses: [
        response(200, { items: [{ sessionId: 'a', title: 'T', room: 'Venetian' }], totalCount: 1 }),
      ],
    });
    const entries = await refreshCatalog(deps(h, fs, { venues: 'not a list' }));
    expect(entries[0]?.session.venue).toBeUndefined();
    expect(entries[0]?.session.missingFields).toContain('venue');
  });

  test('a real directory gets mode 0o700 and a 0o600 file on POSIX, and no temp file is left', () => {
    const root = mkdtempSync(join(tmpdir(), 'compass-cache-'));
    try {
      const dir = join(root, 'nested', 'reinvent-compass');
      writeCache(dir, makeCache([], 0), realFs, NOW);
      expect(readCache(dir, EVENT, realFs)?.entries).toEqual([]);
      const file = cacheFilePath(dir, EVENT);
      expect(readdirSync(dir)).toEqual([`${CACHE_FILE_PREFIX}${EVENT}.json`]);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ entries: [], eventId: EVENT });
      realFs.rmSync(file, { force: true });
      expect(readCache(dir, EVENT, realFs)).toBeUndefined();
      writeCache(dir, makeCache([], 0), realFs, NOW);
      if (process.platform !== 'win32') {
        expect(statSync(dir).mode & 0o777).toBe(0o700);
        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the file is named by a safe form of the event id', () => {
    expect(cacheFilePath(DIR, EVENT)).toBe(`${DIR}/catalog-cache.reinvent2026.json`);
    expect(safeEventIdForFileName('a/b\\c..d e')).toBe('a_b_c__d_e');
    expect(safeEventIdForFileName('x'.repeat(300))).toHaveLength(100);
    expect(cacheFilePath('C:\\Users\\Pat\\AppData\\Roaming\\reinvent-compass', EVENT)).toBe(
      'C:\\Users\\Pat\\AppData\\Roaming\\reinvent-compass\\catalog-cache.reinvent2026.json',
    );
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (id) => {
        const path = cacheFilePath(DIR, id);
        expect(path.startsWith(`${DIR}/${CACHE_FILE_PREFIX}`)).toBe(true);
        expect(path.slice(DIR.length + 1)).toMatch(/^catalog-cache\.[A-Za-z0-9_-]*\.json$/);
      }),
      { numRuns: 100 },
    );
  });

  test('readCache returns undefined for a missing, corrupt, oversized or invalid file', () => {
    const fs = fakeFs();
    expect(readCache(DIR, EVENT, fs)).toBeUndefined();
    const target = cacheFilePath(DIR, EVENT);
    const good = makeCache([], 1);
    for (const content of [
      'not json',
      '{}',
      JSON.stringify({ ...good, fetchedAt: '2026-01-01' }),
      JSON.stringify({ ...good, fetchedAt: '2026-13-45T99:99:99+00:00' }),
      JSON.stringify({ ...good, eventId: undefined }),
      JSON.stringify({ ...good, includeAbstracts: 'yes' }),
      JSON.stringify({ ...good, entries: [{ session: {}, wire: {} }] }),
    ]) {
      fs.files.set(target, content);
      expect(readCache(DIR, EVENT, fs)).toBeUndefined();
    }
    fs.files.set(target, JSON.stringify(good));
    expect(readCache(DIR, EVENT, fs)).toEqual(good);
    fs.sizes.set(target, MAX_CACHE_BYTES + 1);
    expect(readCache(DIR, EVENT, fs)).toBeUndefined();
    fs.sizes.set(target, MAX_CACHE_BYTES);
    expect(readCache(DIR, EVENT, fs)).toEqual(good);
    fs.failOn.add('read');
    expect(readCache(DIR, EVENT, fs)).toBeUndefined();
    fs.failOn.clear();
    fs.failOn.add('stat');
    expect(readCache(DIR, EVENT, fs)).toBeUndefined();
  });

  test('a cache directory that is a symlink or junction is neither read nor written', () => {
    const fs = fakeFs();
    writeCache(DIR, makeCache([], 1), fs, NOW);
    const before = fs.files.get(cacheFilePath(DIR, EVENT));
    fs.links.add(DIR);
    expect(readCache(DIR, EVENT, fs)).toBeUndefined();
    expect(() => {
      writeCache(DIR, makeCache([], 2), fs, NOW);
    }).toThrow(CacheWriteError);
    expect(fs.files.get(cacheFilePath(DIR, EVENT))).toBe(before);
    expect(fs.files.size).toBe(1);
  });

  test('a directory swapped for a link between the first check and the write is caught by the second check', () => {
    const fs = fakeFs();
    const mkdir = fs.mkdirSync.bind(fs);
    fs.mkdirSync = (path, options) => {
      mkdir(path, options);
      fs.links.add(path);
    };
    expect(() => {
      writeCache(DIR, makeCache([], 1), fs, NOW);
    }).toThrow(CacheWriteError);
    expect(fs.files.size).toBe(0);
  });

  test('an lstat failure is treated as "not a link" (a missing directory is normal)', () => {
    const fs = fakeFs();
    fs.failOn.add('lstat');
    writeCache(DIR, makeCache([], 1), fs, NOW);
    expect(readCache(DIR, EVENT, fs)?.entries).toEqual([]);
  });

  test('orphaned temp files older than an hour are swept; recent and unrelated files are kept', () => {
    const fs = fakeFs();
    const old = `${DIR}/${CACHE_FILE_PREFIX}reinvent2026.json.aaa.tmp`;
    const recent = `${DIR}/${CACHE_FILE_PREFIX}reinvent2026.json.bbb.tmp`;
    const other = `${DIR}/notes.tmp`;
    for (const p of [old, recent, other]) {
      fs.files.set(p, 'x');
    }
    fs.mtimes.set(old, NOW - TEMP_MAX_AGE_MS - 1);
    fs.mtimes.set(recent, NOW - TEMP_MAX_AGE_MS + 1000);
    fs.mtimes.set(other, 0);
    writeCache(DIR, makeCache([], 1), fs, NOW);
    expect(fs.files.has(old)).toBe(false);
    expect(fs.files.has(recent)).toBe(true);
    expect(fs.files.has(other)).toBe(true);
  });

  test('a failing sweep never fails the write', () => {
    for (const failing of ['readdir', 'stat', 'rm'] as const) {
      const fs = fakeFs();
      const old = `${DIR}/${CACHE_FILE_PREFIX}x.json.aaa.tmp`;
      fs.files.set(old, 'x');
      fs.failOn.add(failing);
      // rm failing also hits the sweep only; the write itself does not call rm.
      writeCache(DIR, makeCache([], 1), fs, NOW);
      fs.failOn.clear();
      expect(readCache(DIR, EVENT, fs)).toBeDefined();
    }
  });
});

describe('Feature: events-client, Property 27: Stale cache is refetched', () => {
  // Validates: Requirements 14.7
  test('for any max age, clock and fetch time a refetch happens if and only if the age exceeds the max', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 2_000_000 }),
        async (maxAge, ageSeconds) => {
          const fs = fakeFs();
          writeCache(DIR, makeCache([], NOW - ageSeconds * 1000), fs, NOW);
          const h = createHarness({ responses: [onePage(['fresh'])] });
          const got = await readCatalog(deps(h, fs, { maxAgeSeconds: maxAge }));
          const stale = ageSeconds > maxAge;
          expect(h.sent).toHaveLength(stale ? 1 : 0);
          expect(got.entries.map((e) => e.session.sessionId)).toEqual(stale ? ['fresh'] : []);
          expect(got.stale).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('without a positive configured max age the default of 24 hours applies', async () => {
    expect(DEFAULT_MAX_AGE_SECONDS).toBe(86_400);
    for (const maxAgeSeconds of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const [ageSeconds, refetches] of [
        [86_400, 0],
        [86_401, 1],
      ] as const) {
        const fs = fakeFs();
        writeCache(DIR, makeCache([], NOW - ageSeconds * 1000), fs, NOW);
        const h = createHarness({ responses: [onePage(['x'])] });
        const options: Partial<CatalogDeps> = maxAgeSeconds === undefined ? {} : { maxAgeSeconds };
        await readCatalog(deps(h, fs, options));
        expect(h.sent).toHaveLength(refetches);
      }
    }
  });

  test('a cache for another event or another abstracts setting is stale', async () => {
    for (const [overrides, request] of [
      [{ eventId: 'other' }, {}],
      [{ includeAbstracts: false }, {}],
      [{ includeAbstracts: true }, { includeAbstracts: false }],
    ] as const) {
      const fs = fakeFs();
      writeCache(DIR, makeCache([], NOW), fs, NOW);
      const file = cacheFilePath(DIR, EVENT);
      fs.files.set(file, JSON.stringify(makeCache([], NOW, overrides)));
      const h = createHarness({ responses: [onePage(['fresh'])] });
      const got = await readCatalog(deps(h, fs, request));
      expect(h.sent).toHaveLength(1);
      expect(got.entries.map((e) => e.session.sessionId)).toEqual(['fresh']);
    }
  });

  test('a fetchedAt in the future counts as now and does not break the age check', async () => {
    const fs = fakeFs();
    writeCache(DIR, makeCache([], NOW + 86_400_000), fs, NOW);
    const h = createHarness({ responses: [onePage(['x'])] });
    const got = await readCatalog(deps(h, fs, { maxAgeSeconds: 10 }));
    expect(h.sent).toHaveLength(0);
    expect(got.stale).toBe(false);
  });

  test('a missing cache is fetched, and a failed fetch writes nothing', async () => {
    const fs = fakeFs();
    const h = createHarness({ responses: [onePage(['n'])] });
    expect((await readCatalog(deps(h, fs))).entries.map((e) => e.session.sessionId)).toEqual(['n']);
    const bad = createHarness({ responses: [response(500, undefined)] });
    const empty = fakeFs();
    await expect(readCatalog(deps(bad, empty))).rejects.toBeInstanceOf(CatalogIncompleteError);
    expect(empty.files.size).toBe(0);
  });
});

describe('events-client, N5: the cache is not trusted when it is loaded', () => {
  test('a tampered normalised session is ignored: it is recomputed from the sanitised wire', async () => {
    const fs = fakeFs();
    const wire = {
      sessionId: 's1',
      title: `Real${String.fromCodePoint(0x202e)}title`,
      venue: 'Wynn',
    };
    const forged = normaliseSession(
      { sessionId: 's1', title: 'EVIL', venue: 'Elsewhere' },
      undefined,
      ZONE,
    );
    writeCache(DIR, makeCache([{ session: forged, wire }], NOW), fs, NOW);
    const h = createHarness({ responses: [] });
    const got = await readCatalog(deps(h, fs));
    expect(got.entries[0]?.session.title).toBe('Realtitle');
    expect(got.entries[0]?.session.venue).toBe('Wynn');
    expect(got.entries[0]?.wire.title).toBe('Realtitle');
    expect(h.sent).toHaveLength(0);
  });

  test('the venue list is applied to cached sessions on load', async () => {
    const fs = fakeFs();
    const wire = { sessionId: 's1', title: 'T', room: 'Venetian | Room 1' };
    writeCache(
      DIR,
      makeCache([{ session: normaliseSession(wire, undefined, ZONE), wire }], NOW),
      fs,
      NOW,
    );
    const got = await readCatalog(
      deps(createHarness({ responses: [] }), fs, { venues: [{ name: 'Venetian' }] }),
    );
    expect(got.entries[0]?.session.venue).toBe('Venetian');
  });
});

describe('events-client, L5: a failed refetch falls back to the stale cache, flagged', () => {
  const old = (): FakeFs => {
    const fs = fakeFs();
    const wire = { sessionId: 'old', title: 'Old' };
    writeCache(
      DIR,
      makeCache([{ session: normaliseSession(wire, undefined, ZONE), wire }], NOW - 2 * 86_400_000),
      fs,
      NOW,
    );
    return fs;
  };

  test('with a stale cache and a failing refetch the old entries are served with stale true', async () => {
    const fs = old();
    const h = createHarness({ responses: [response(503, undefined)] });
    const got = await readCatalog(deps(h, fs));
    expect(got.stale).toBe(true);
    expect(got.entries.map((e) => e.session.sessionId)).toEqual(['old']);
  });

  test('with no cache the fetch error is thrown', async () => {
    const h = createHarness({ responses: [response(503, undefined)] });
    await expect(readCatalog(deps(h, fakeFs()))).rejects.toBeInstanceOf(CatalogIncompleteError);
  });

  test('a failed cache write after a good fetch is still an error, not a fallback', async () => {
    const fs = old();
    fs.failOn.add('rename');
    const h = createHarness({ responses: [onePage(['new'])] });
    await expect(readCatalog(deps(h, fs))).rejects.toBeInstanceOf(CacheWriteError);
  });

  test('a cache file that belongs to another event is never served as a fallback', async () => {
    const fs = fakeFs();
    const file = cacheFilePath(DIR, EVENT);
    fs.files.set(file, JSON.stringify(makeCache([], NOW - 2 * 86_400_000, { eventId: 'other' })));
    const h = createHarness({ responses: [response(503, undefined)] });
    await expect(readCatalog(deps(h, fs))).rejects.toBeInstanceOf(CatalogIncompleteError);
  });
});

describe('Feature: events-client, Property 28: A failed cache write leaves the existing file unchanged', () => {
  // Validates: Requirements 14.8
  test('for any existing cache and any failing step the old file is intact and the error is typed', () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { maxLength: 3 }),
        fc.array(entryArb, { maxLength: 3 }),
        fc.constantFrom<'mkdir' | 'write' | 'rename'>('mkdir', 'write', 'rename'),
        fc.boolean(),
        (oldEntries, newEntries, failing, rmAlsoFails) => {
          const fs = fakeFs();
          writeCache(DIR, makeCache(oldEntries, 1), fs, NOW);
          const target = cacheFilePath(DIR, EVENT);
          const before = fs.files.get(target);
          fs.failOn.add(failing);
          if (rmAlsoFails) {
            fs.failOn.add('rm');
          }
          expect(() => {
            writeCache(DIR, makeCache(newEntries, 2), fs, NOW);
          }).toThrow(CacheWriteError);
          expect(fs.files.get(target)).toBe(before);
          if (!rmAlsoFails) {
            expect([...fs.files.keys()]).toEqual([target]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('a refresh whose write fails surfaces the cache-write error and keeps the old cache', async () => {
    const fs = fakeFs();
    const old = makeCache([], 1);
    writeCache(DIR, old, fs, NOW);
    fs.failOn.add('rename');
    const h = createHarness({ responses: [onePage(['z'])] });
    await expect(refreshCatalog(deps(h, fs))).rejects.toBeInstanceOf(CacheWriteError);
    fs.failOn.clear();
    expect(readCache(DIR, EVENT, fs)).toEqual(old);
  });
});
