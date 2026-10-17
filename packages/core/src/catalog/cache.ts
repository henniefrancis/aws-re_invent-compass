// Catalog cache on disk (events-client, S1, task 13.13, hardened by security N5 and
// QA M2 and L5).
//
// The cache is one JSON file per event, { fetchedAt, eventId, includeAbstracts,
// entries }, where each entry pairs the normalised session with the wire session it
// came from. The file is data from disk and is not trusted: on load every wire
// session is sanitised again and the normalised session is recomputed from it, so a
// tampered or stale `session` is never served. The file is private to the user
// (Requirements 14.4 to 14.8):
//   - the directory is created with mode 0o700 and the file written with mode 0o600
//     (on Windows the mode only toggles the read-only bit; privacy there relies on
//     the per-user ACL of %APPDATA%),
//   - the cache directory is checked with lstat and a symlink or junction is refused,
//     for both reads and writes,
//   - writing is atomic: a temp file in the same directory is created with the wx flag
//     (it must not already exist), written, and renamed over the target, so a failed
//     write leaves any existing file unchanged; temp files left behind by an earlier
//     crash and older than one hour are removed,
//   - a file larger than 50 MB is not read,
//   - fetchedAt is an ISO 8601 timestamp with an explicit offset; a fetchedAt in the
//     future is treated as now.
// The file is named by a safe form of the event id, and a file whose stored eventId or
// includeAbstracts differs from the request is stale. Without a configured maximum age
// a cache is stale after 24 hours. If a refetch fails and a cache for this event
// exists, the stale cache is served and flagged as stale.
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
import { sanitiseWire } from './sanitise-wire.js';
import { parseVenues } from './venue-recovery.js';
import type { ClientContext } from '../api/transport.js';

/** The cache file name prefix and suffix inside the cache directory. */
export const CACHE_FILE_PREFIX = 'catalog-cache.';
export const CACHE_FILE_SUFFIX = '.json';
/** Directory and file modes (Requirement 14.4). */
export const CACHE_DIR_MODE = 0o700;
export const CACHE_FILE_MODE = 0o600;
/** A cache file larger than this is never read. */
export const MAX_CACHE_BYTES = 50 * 1024 * 1024;
/** Orphaned temp files older than this are removed. */
export const TEMP_MAX_AGE_MS = 60 * 60 * 1000;
/** The maximum cache age when none is configured: 24 hours. */
export const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

/** One cached session: the normalised view and the wire it came from. */
export interface CacheEntry {
  session: NormalisedSession;
  wire: SessionWire;
}

/** The cache file contents. */
export interface CatalogCache {
  /** ISO 8601 with offset. */
  fetchedAt: string;
  /** The event the catalog belongs to. */
  eventId: string;
  /** Whether the fetch included abstracts. */
  includeAbstracts: boolean;
  entries: CacheEntry[];
}

/** The file system calls the cache needs. */
export interface FsLike {
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown;
  writeFileSync(path: string, data: string, options: { mode: number; flag: 'wx' }): void;
  renameSync(from: string, to: string): void;
  readFileSync(path: string, encoding: 'utf8'): string;
  rmSync(path: string, options: { force: true }): void;
  /** Like lstat: does not follow a symlink. */
  lstatSync(path: string): { isSymbolicLink(): boolean };
  statSync(path: string): { size: number; mtimeMs: number };
  readdirSync(path: string): string[];
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
  lstatSync: (path) => nodeFs.lstatSync(path),
  statSync: (path) => nodeFs.statSync(path),
  readdirSync: (path) => nodeFs.readdirSync(path),
};

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const CatalogCacheSchema = z.object({
  fetchedAt: z.string().refine((v) => ISO_WITH_OFFSET.test(v) && !Number.isNaN(Date.parse(v))),
  eventId: z.string(),
  includeAbstracts: z.boolean(),
  entries: z.array(z.object({ session: NormalisedSessionSchema, wire: SessionWireSchema })),
});

/** The path module matching the separator the directory uses. */
function pathFor(dir: string): typeof posix {
  return dir.includes('\\') && !dir.includes('/') ? win32 : posix;
}

/** The event id reduced to characters that are safe in a file name. */
export function safeEventIdForFileName(eventId: string): string {
  return eventId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
}

/** The cache file path for an event inside a directory. */
export function cacheFilePath(dir: string, eventId: string): string {
  return pathFor(dir).join(
    dir,
    `${CACHE_FILE_PREFIX}${safeEventIdForFileName(eventId)}${CACHE_FILE_SUFFIX}`,
  );
}

/** Format epoch milliseconds as ISO 8601 with an explicit +00:00 offset. */
export function isoWithOffset(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('Z', '+00:00');
}

/** True when the directory exists and is a symlink or junction. A missing one is fine. */
function isLinkedDir(dir: string, fs: FsLike): boolean {
  try {
    return fs.lstatSync(dir).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Remove orphaned temp files older than an hour. Best effort: it never fails a write. */
function sweepTempFiles(dir: string, fs: FsLike, nowMs: number): void {
  try {
    const path = pathFor(dir);
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(CACHE_FILE_PREFIX) && name.endsWith('.tmp')) {
        const file = path.join(dir, name);
        if (nowMs - fs.statSync(file).mtimeMs > TEMP_MAX_AGE_MS) {
          fs.rmSync(file, { force: true });
        }
      }
    }
  } catch {
    // Nothing here may stop the real write.
  }
}

/**
 * Write the cache atomically. On any failure (including a symlinked directory) the
 * temp file is removed, the existing cache file is left as it was, and
 * CacheWriteError is thrown.
 */
export function writeCache(dir: string, cache: CatalogCache, fs: FsLike, nowMs: number): void {
  const target = cacheFilePath(dir, cache.eventId);
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    if (isLinkedDir(dir, fs)) {
      throw new Error('cache directory is a link');
    }
    fs.mkdirSync(dir, { recursive: true, mode: CACHE_DIR_MODE });
    if (isLinkedDir(dir, fs)) {
      throw new Error('cache directory is a link');
    }
    sweepTempFiles(dir, fs, nowMs);
    fs.writeFileSync(temp, JSON.stringify(cache), { mode: CACHE_FILE_MODE, flag: 'wx' });
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

/**
 * Read the cache for an event, or undefined when it is missing, unreadable, larger
 * than 50 MB, in a symlinked directory or not valid.
 */
export function readCache(dir: string, eventId: string, fs: FsLike): CatalogCache | undefined {
  if (isLinkedDir(dir, fs)) {
    return undefined;
  }
  const file = cacheFilePath(dir, eventId);
  let text: string;
  try {
    if (fs.statSync(file).size > MAX_CACHE_BYTES) {
      return undefined;
    }
    text = fs.readFileSync(file, 'utf8');
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
  /** Refetch on read when the cache is older than this many seconds. Default 24 hours. */
  maxAgeSeconds?: number;
  /** Whether a fetch includes abstracts. Defaults to true. */
  includeAbstracts?: boolean;
  now: () => number;
}

/** A catalog read: the entries and whether they are a stale fallback. */
export interface CatalogRead {
  entries: CacheEntry[];
  /** True when the refetch failed and an out-of-date cache is served instead. */
  stale: boolean;
  /** True when the client is simulated, so the catalog is not real data (finding N2). */
  simulated: boolean;
}

/** Refetch the whole catalog and overwrite the cache in place. */
export async function refreshCatalog(deps: CatalogDeps): Promise<CacheEntry[]> {
  const includeAbstracts = deps.includeAbstracts ?? true;
  const wires = await fetchAllSessions(deps.ctx, { includeAbstracts });
  const venues = parseVenues(deps.venues);
  const entries = wires.map((raw) => {
    const wire = sanitiseWire(raw);
    return { session: normaliseSession(wire, venues, deps.eventTimezone), wire };
  });
  writeCache(
    deps.dir,
    {
      fetchedAt: isoWithOffset(deps.now()),
      eventId: deps.ctx.eventId,
      includeAbstracts,
      entries,
    },
    deps.fs,
    deps.now(),
  );
  return entries;
}

/** True when the cache must be refetched: a different request shape, or too old. */
function isStale(cache: CatalogCache, deps: CatalogDeps): boolean {
  if (
    cache.eventId !== deps.ctx.eventId ||
    cache.includeAbstracts !== (deps.includeAbstracts ?? true)
  ) {
    return true;
  }
  const configured = deps.maxAgeSeconds;
  const max =
    configured !== undefined && Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_MAX_AGE_SECONDS;
  // A fetchedAt in the future (clock change, tampering) counts as now.
  const fetched = Math.min(Date.parse(cache.fetchedAt), deps.now());
  return (deps.now() - fetched) / 1000 > max;
}

/** Sanitise the cached wire again and recompute each session from it. */
function rebuild(cache: CatalogCache, deps: CatalogDeps): CacheEntry[] {
  const venues = parseVenues(deps.venues);
  return cache.entries.map((entry) => {
    const wire = sanitiseWire(entry.wire);
    return { session: normaliseSession(wire, venues, deps.eventTimezone), wire };
  });
}

/**
 * Read the catalog from the cache, refetching when it is missing or stale. If the
 * refetch fails and a cache for this event exists, that cache is returned flagged
 * `stale: true`; a failed cache write is still an error, and with no cache the fetch
 * error is thrown.
 */
export async function readCatalog(deps: CatalogDeps): Promise<CatalogRead> {
  const simulated = deps.ctx.transport.simulated === true;
  const cache = readCache(deps.dir, deps.ctx.eventId, deps.fs);
  const usable = cache !== undefined && cache.eventId === deps.ctx.eventId;
  if (cache !== undefined && usable && !isStale(cache, deps)) {
    return { entries: rebuild(cache, deps), stale: false, simulated };
  }
  try {
    return { entries: await refreshCatalog(deps), stale: false, simulated };
  } catch (error) {
    if (cache !== undefined && usable && !(error instanceof CacheWriteError)) {
      return { entries: rebuild(cache, deps), stale: true, simulated };
    }
    throw error;
  }
}
