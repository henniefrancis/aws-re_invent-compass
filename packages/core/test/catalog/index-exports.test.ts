import { describe, expect, test } from 'vitest';
import * as catalog from '../../src/catalog/index.js';

// Structural export test for the catalog entry point (events-client, S1, task 16.1).
// The list is explicit so the public surface changes only on purpose.

const EXPECTED = [
  'sanitiseWire',
  'MAX_CATALOG_PAGES',
  'MAX_CATALOG_SESSIONS',
  'MAX_CACHED_ZONES',
  'APP_DATA_DIR_NAME',
  'CACHE_DIR_MODE',
  'CACHE_FILE_MODE',
  'CACHE_FILE_PREFIX',
  'CACHE_FILE_SUFFIX',
  'MAX_CACHE_BYTES',
  'TEMP_MAX_AGE_MS',
  'DEFAULT_MAX_AGE_SECONDS',
  'safeEventIdForFileName',
  'CacheWriteError',
  'CatalogIncompleteError',
  'cacheFilePath',
  'computeSessionInterval',
  'fetchAllSessions',
  'filterCatalog',
  'isValidTimeZone',
  'isoWithOffset',
  'normaliseSession',
  'parseVenues',
  'readCache',
  'readCatalog',
  'realFs',
  'recoverVenue',
  'refreshCatalog',
  'resolveAppDataDir',
  'resolveEventWindow',
  'writeCache',
];

describe('events-client, task 16.1: the catalog entry point', () => {
  test('exports exactly the listed runtime names', () => {
    expect(Object.keys(catalog).sort()).toEqual([...EXPECTED].sort());
  });
});
