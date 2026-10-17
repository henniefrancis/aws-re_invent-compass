// Catalog cache on disk (events-client, S1, task 13.13).
//
// The cache is one JSON file, { fetchedAt, entries }, where each entry pairs the
// normalised session with the wire session it came from (so a re-normalisation needs
// no refetch). It is private to the user (Requirements 14.4 to 14.8):
//   - the directory is created with mode 0o700 and the file written with mode 0o600
//     (on Windows the mode only toggles the read-only bit; privacy there relies on
//     the per-user ACL of %APPDATA%),
//   - writing is atomic: a temp file in the same directory is written and renamed
//     over the target, so a failed write leaves any existing file unchanged,
//   - fetchedAt is an ISO 8601 timestamp with an explicit offset.
// The file system is injected so tests use a recording fake.

import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { posix, win32 } from 'node:path';
import { z } from 'zod';
import {
  NormalisedSessionSchema,
  SessionWireSchema,
  type NormalisedSession,
  type SessionWire,
} from '@compass/contracts';
import { CacheWriteError } from './errors.js';
import { fetchAllSessions } from './paginate.js';
import { normaliseSession } from './normalise.js';
import { parseVenues } from './venue-recovery.js';
import type { ClientContext } from '../api/transport.js';

/** The cache file name inside the cache directory. */
export const CACHE_FILE_NAME = 'catalog-cache.json';
/** Directory and file modes (Requirement 14.4). */
export const CACHE_DIR_MODE = 0o700;
export const CACHE_FILE_MODE = 0o600;

/** One cached session: the normalised view and the wire it came from. */
export interface CacheEntry {
  session: NormalisedSession;
  wire: SessionWire;
}

/** The cache file contents. */
export interface CatalogCache {
  /** ISO 8601 with offset. */
  fetchedAt: string;
  entries: CacheEntry[];
}

/** The file system calls the cache needs. */
export interface FsLike {
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown;
  writeFileSync(path: string, data: string, options: { mode: number }): void;
  renameSync(from: string, to: string): void;
  readFileSync(path: string, encoding: 'utf8'): string;
  rmSync(path: string, options: { force: true }): void;
}

/** The real file system. */
export const realFs: FsLike = {
  mkdirSync: (path, options) => nodeFs.mkdirSync(path, options),
  writeFileSync: (path, data, options) => {
    nodeFs.writeFileSync(path, data, options);
  },
  renameSync: (from, to) => {
    nodeFs.renameSync(from, to);
  },
  readFileSync: (path, encoding) => nodeFs.readFileSync(path, encoding),
  rmSync: (path, options) => {
    nodeFs.rmSync(path, options);
  },
};

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const CatalogCacheSchema = z.object({
  fetchedAt: z.string().refine((v) => ISO_WITH_OFFSET.test(v) && !Number.isNaN(Date.parse(v))),
  entries: z.array(z.object({ session: NormalisedSessionSchema, wire: SessionWireSchema })),
});

/** The cache file path inside a directory, using the separator the directory uses. */
export function cacheFilePath(dir: string): string {
  const path = dir.includes('\\') && !dir.includes('/') ? win32 : posix;
  return path.join(dir, CACHE_FILE_NAME);
}

/** Format epoch milliseconds as ISO 8601 with an explicit +00:00 offset. */
export function isoWithOffset(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('Z', '+00:00');
}

/**
 * Write the cache atomically. On any failure the temp file is removed, the existing
 * cache file is left as it was, and CacheWriteError is thrown.
 */
export function writeCache(dir: string, cache: CatalogCache, fs: FsLike): void {
  const target = cacheFilePath(dir);
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: CACHE_DIR_MODE });
    fs.writeFileSync(temp, JSON.stringify(cache), { mode: CACHE_FILE_MODE });
    fs.renameSync(temp, target);
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Best effort: a leftover temp file never replaces the real cache.
    }
    throw new CacheWriteError();
  }
}

/** Read the cache, or undefined when it is missing, unreadable or not valid. */
export function readCache(dir: string, fs: FsLike): CatalogCache | undefined {
  let text: string;
  try {
    text = fs.readFileSync(cacheFilePath(dir), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = CatalogCacheSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Everything the catalog read and refresh need, all injectable. */
export interface CatalogDeps {
  ctx: ClientContext;
  /** The cache directory, see resolveAppDataDir. */
  dir: string;
  fs: FsLike;
  /** The IANA timezone read from the API (see resolveEventWindow). */
  eventTimezone: string;
  /** The raw venue list from data/venues.json (parsed through VenueSchema here). */
  venues?: unknown;
  /** Refetch on read when the cache is older than this many seconds. Positive only. */
  maxAgeSeconds?: number;
  /** Whether a refetch includes abstracts. Defaults to true. */
  includeAbstracts?: boolean;
  now: () => number;
}

/** Refetch the whole catalog and overwrite the cache in place. */
export async function refreshCatalog(deps: CatalogDeps): Promise<CacheEntry[]> {
  const wires = await fetchAllSessions(deps.ctx, {
    includeAbstracts: deps.includeAbstracts ?? true,
  });
  const venues = parseVenues(deps.venues);
  const entries = wires.map((wire) => ({
    session: normaliseSession(wire, venues, deps.eventTimezone),
    wire,
  }));
  writeCache(deps.dir, { fetchedAt: isoWithOffset(deps.now()), entries }, deps.fs);
  return entries;
}

/** True when the cache is older than the configured positive maximum age. */
function isStale(cache: CatalogCache, deps: CatalogDeps): boolean {
  const max = deps.maxAgeSeconds;
  if (max === undefined || !(max > 0)) {
    return false;
  }
  return (deps.now() - Date.parse(cache.fetchedAt)) / 1000 > max;
}

/** Read the catalog from the cache, refetching when it is missing or stale. */
export async function readCatalog(deps: CatalogDeps): Promise<CacheEntry[]> {
  const cache = readCache(deps.dir, deps.fs);
  if (cache === undefined || isStale(cache, deps)) {
    return refreshCatalog(deps);
  }
  return cache.entries;
}
