import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  CACHE_DIR_MODE,
  CACHE_FILE_MODE,
  cacheFilePath,
  isoWithOffset,
  readCache,
  readCatalog,
  realFs,
  refreshCatalog,
  writeCache,
  type CacheEntry,
  type CatalogCache,
  type CatalogDeps,
} from '../../src/catalog/cache.js';
import { CacheWriteError, CatalogIncompleteError } from '../../src/catalog/errors.js';
import { normaliseSession } from '../../src/catalog/normalise.js';
import { createHarness, response } from '../api/operation-harness.js';
import { fakeFs, wireArb } from './arbitraries.js';

// Tests for the on-disk catalog cache (events-client, S1, tasks 13.13 to 13.16).
// A recording fake file system is used throughout, except one real temporary
// directory test that checks the POSIX mode.

const DIR = '/data/reinvent-compass';
const ZONE = 'America/Los_Angeles';

const entryArb: fc.Arbitrary<CacheEntry> = wireArb.map((wire) => ({
  session: normaliseSession(wire, undefined, ZONE),
  wire,
}));
const msArb = fc.integer({ min: Date.parse('2026-01-01'), max: Date.parse('2027-01-01') });

/** The wire sessions of a one-page ListSessions answer. */
function onePage(ids: string[]): ReturnType<typeof response> {
  return response(200, {
    items: ids.map((id) => ({ sessionId: id, title: `T ${id}`, venue: 'Wynn' })),
    totalCount: ids.length,
  });
}

function deps(
  h: ReturnType<typeof createHarness>,
  fs: ReturnType<typeof fakeFs>,
  overrides: Partial<CatalogDeps> = {},
): CatalogDeps {
  return {
    ctx: h.ctx,
    dir: DIR,
    fs,
    eventTimezone: ZONE,
    now: () => 1_800_000_000_000,
    ...overrides,
  };
}

describe('Feature: events-client, Property 26: Cache write and read round-trip atomically with an ISO-8601 timestamp', () => {
  // Validates: Requirements 14.4, 14.5, 14.6
  test('for any catalog and time, write then read returns the same entries and an offset timestamp', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 5 }), msArb, (entries, ms) => {
        const fs = fakeFs();
        const cache: CatalogCache = { fetchedAt: isoWithOffset(ms), entries };
        writeCache(DIR, cache, fs);
        const back = readCache(DIR, fs);
        expect(back).toEqual(cache);
        expect(back?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
        expect(Date.parse(back?.fetchedAt ?? '')).toBe(ms);
      }),
      { numRuns: 100 },
    );
  });

  test('the write is atomic: temp file renamed into place, dir 0o700, file 0o600', () => {
    const fs = fakeFs();
    writeCache(DIR, { fetchedAt: isoWithOffset(0), entries: [] }, fs);
    expect(fs.dirs).toEqual([{ path: DIR, mode: CACHE_DIR_MODE }]);
    expect(CACHE_DIR_MODE).toBe(0o700);
    expect(CACHE_FILE_MODE).toBe(0o600);
    const target = cacheFilePath(DIR);
    const written = fs.calls.find((c) => c.startsWith('write '))?.slice(6) ?? '';
    expect(written).not.toBe(target);
    expect(written.startsWith(target)).toBe(true);
    expect(fs.calls.at(-1)).toBe(`rename ${written} ${target}`);
    expect(fs.modes.get(target)).toBe(0o600);
    expect([...fs.files.keys()]).toEqual([target]);
  });

  test('a refresh overwrites the same file in place with new data and a new timestamp', async () => {
    const fs = fakeFs();
    let now = 1_800_000_000_000;
    const first = createHarness({ responses: [onePage(['a'])] });
    await refreshCatalog(deps(first, fs, { now: () => now }));
    const before = readCache(DIR, fs);
    now += 5000;
    const second = createHarness({ responses: [onePage(['b', 'c'])] });
    await refreshCatalog(deps(second, fs, { now: () => now }));
    const after = readCache(DIR, fs);
    expect(before?.entries.map((e) => e.session.sessionId)).toEqual(['a']);
    expect(after?.entries.map((e) => e.session.sessionId)).toEqual(['b', 'c']);
    expect(Date.parse(after?.fetchedAt ?? '') - Date.parse(before?.fetchedAt ?? '')).toBe(5000);
    expect([...fs.files.keys()]).toEqual([cacheFilePath(DIR)]);
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
    const touched = fs.calls
      .filter((c) => !c.startsWith('read '))
      .flatMap((c) => c.split(' ').slice(1));
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

  test('a real directory gets mode 0o700 and a 0o600 file on POSIX', () => {
    const root = mkdtempSync(join(tmpdir(), 'compass-cache-'));
    try {
      const dir = join(root, 'nested', 'reinvent-compass');
      writeCache(dir, { fetchedAt: isoWithOffset(0), entries: [] }, realFs);
      expect(readCache(dir, realFs)?.entries).toEqual([]);
      expect(readdirSync(dir)).toEqual(['catalog-cache.json']);
      expect(JSON.parse(readFileSync(cacheFilePath(dir), 'utf8'))).toMatchObject({ entries: [] });
      realFs.rmSync(cacheFilePath(dir), { force: true });
      expect(readCache(dir, realFs)).toBeUndefined();
      writeCache(dir, { fetchedAt: isoWithOffset(0), entries: [] }, realFs);
      if (process.platform !== 'win32') {
        expect(statSync(dir).mode & 0o777).toBe(0o700);
        expect(statSync(cacheFilePath(dir)).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('cacheFilePath uses the separator of the directory', () => {
    expect(cacheFilePath('C:\\Users\\Pat\\AppData\\Roaming\\reinvent-compass')).toBe(
      'C:\\Users\\Pat\\AppData\\Roaming\\reinvent-compass\\catalog-cache.json',
    );
    expect(cacheFilePath('/a/b')).toBe('/a/b/catalog-cache.json');
  });

  test('readCache returns undefined for a missing, corrupt, or invalid file', () => {
    const fs = fakeFs();
    expect(readCache(DIR, fs)).toBeUndefined();
    const target = cacheFilePath(DIR);
    for (const content of [
      'not json',
      '{}',
      JSON.stringify({ fetchedAt: '2026-01-01', entries: [] }),
      JSON.stringify({ fetchedAt: '2026-13-45T99:99:99+00:00', entries: [] }),
      JSON.stringify({ fetchedAt: '2026-01-01T00:00:00Z', entries: [{ session: {}, wire: {} }] }),
    ]) {
      fs.files.set(target, content);
      expect(readCache(DIR, fs)).toBeUndefined();
    }
    fs.files.set(target, JSON.stringify({ fetchedAt: '2026-01-01T00:00:00Z', entries: [] }));
    fs.failOn.add('read');
    expect(readCache(DIR, fs)).toBeUndefined();
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
          const now = 1_800_000_000_000;
          writeCache(DIR, { fetchedAt: isoWithOffset(now - ageSeconds * 1000), entries: [] }, fs);
          const h = createHarness({ responses: [onePage(['fresh'])] });
          const got = await readCatalog(deps(h, fs, { maxAgeSeconds: maxAge, now: () => now }));
          const stale = ageSeconds > maxAge;
          expect(h.sent).toHaveLength(stale ? 1 : 0);
          expect(got.map((e) => e.session.sessionId)).toEqual(stale ? ['fresh'] : []);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('without a configured positive max age a cache is never stale', async () => {
    for (const maxAgeSeconds of [undefined, 0, -5, Number.NaN]) {
      const fs = fakeFs();
      writeCache(DIR, { fetchedAt: isoWithOffset(0), entries: [] }, fs);
      const h = createHarness({ responses: [onePage(['x'])] });
      const options: Partial<CatalogDeps> = maxAgeSeconds === undefined ? {} : { maxAgeSeconds };
      await readCatalog(deps(h, fs, options));
      expect(h.sent).toHaveLength(0);
    }
  });

  test('a missing cache is fetched, and a failed fetch writes nothing', async () => {
    const fs = fakeFs();
    const h = createHarness({ responses: [onePage(['n'])] });
    expect((await readCatalog(deps(h, fs))).map((e) => e.session.sessionId)).toEqual(['n']);
    const bad = createHarness({ responses: [response(500, undefined)] });
    const empty = fakeFs();
    await expect(readCatalog(deps(bad, empty))).rejects.toBeInstanceOf(CatalogIncompleteError);
    expect(empty.files.size).toBe(0);
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
          writeCache(DIR, { fetchedAt: isoWithOffset(1), entries: oldEntries }, fs);
          const target = cacheFilePath(DIR);
          const before = fs.files.get(target);
          fs.failOn.add(failing);
          if (rmAlsoFails) {
            fs.failOn.add('rm');
          }
          expect(() => {
            writeCache(DIR, { fetchedAt: isoWithOffset(2), entries: newEntries }, fs);
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
    const old: CatalogCache = { fetchedAt: isoWithOffset(1), entries: [] };
    writeCache(DIR, old, fs);
    fs.failOn.add('rename');
    const h = createHarness({ responses: [onePage(['z'])] });
    await expect(refreshCatalog(deps(h, fs))).rejects.toBeInstanceOf(CacheWriteError);
    fs.failOn.clear();
    expect(readCache(DIR, fs)).toEqual(old);
  });
});
