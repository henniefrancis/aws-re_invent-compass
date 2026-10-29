// @compass/core/catalog entry point (events-client, S1).
//
// Pagination, the private on-disk cache, session normalisation, venue recovery,
// local filtering and the event window read from the API. The venue list is only
// ever received by injection and read; nothing here writes it.

export { CatalogIncompleteError, CacheWriteError, type CatalogIncompleteReason } from './errors.js';
export { resolveAppDataDir, APP_DATA_DIR_NAME, type AppDataEnv } from './app-data-dir.js';
export {
  fetchAllSessions,
  MAX_CATALOG_PAGES,
  MAX_CATALOG_SESSIONS,
  type FetchAllOptions,
} from './paginate.js';
export { sanitiseWire } from './sanitise-wire.js';
export { normaliseSession } from './normalise.js';
export { recoverVenue, parseVenues } from './venue-recovery.js';
export {
  computeSessionInterval,
  fromZoneWallClock,
  isValidTimeZone,
  startOfDayBefore,
  toZoneWallClock,
  MAX_CACHED_ZONES,
  type SessionInterval,
} from './session-time.js';
export {
  readCatalog,
  refreshCatalog,
  readCache,
  writeCache,
  cacheFilePath,
  isoWithOffset,
  realFs,
  CACHE_FILE_PREFIX,
  CACHE_FILE_SUFFIX,
  MAX_CACHE_BYTES,
  TEMP_MAX_AGE_MS,
  DEFAULT_MAX_AGE_SECONDS,
  safeEventIdForFileName,
  CACHE_DIR_MODE,
  CACHE_FILE_MODE,
  type CacheEntry,
  type CatalogCache,
  type CatalogDeps,
  type CatalogRead,
  type FsLike,
} from './cache.js';
export { filterCatalog, type CatalogFilter } from './filter.js';
export { resolveEventWindow, type EventWindow } from './event-window.js';
