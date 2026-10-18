// Fixture loading for the simulated transport (events-client, S1, task 14.1).
//
// Two kinds of data are served:
//   - the session catalog, from the read-only synthetic catalog at
//     fixtures/synthetic/catalog.json (owned by another stream; never edited here and
//     never supplemented with invented sessions),
//   - canned responses, from fixtures/api/<operation>/<scenario>.json, where the
//     folder is the kebab-case operation name (for example reserve-sessions).
// Each canned response is { status, headers?, body? }. The loader is an interface so
// tests can supply their own data; the default reads the repository's fixture files.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SessionWireSchema, type SessionWire } from '@compass/contracts';
import type { OperationName } from '../api/transport.js';

/** One canned HTTP response. */
export interface FixtureFile {
  status: number;
  headers?: Record<string, string> | undefined;
  body?: unknown;
}

/** Supplies the catalog and the canned responses. */
export interface FixtureLoader {
  /** The synthetic session catalog, validated against SessionWireSchema. */
  catalog(): SessionWire[];
  /** The canned response for an operation and scenario name. */
  fixture(operation: OperationName, scenario: string): FixtureFile;
}

const FixtureFileSchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});

const CatalogSchema = z.array(SessionWireSchema);
const SCENARIO_PATTERN = /^[a-z0-9-]+$/;

/** The kebab-case folder name for an operation, for example "reserve-sessions". */
export function operationFolder(operation: OperationName): string {
  return operation.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Reads a file as UTF-8 text. Injectable so tests need no real files. */
export type ReadText = (path: string) => string;

/** The fixtures directory of this repository, found relative to this source file. */
export function defaultFixturesRoot(): string {
  return fileURLToPath(new URL('../../../../fixtures/', import.meta.url));
}

/**
 * A loader over a fixtures directory (fixtures/api and fixtures/synthetic under
 * `root`). Files are parsed once and cached.
 */
export function createFsFixtureLoader(
  root: string = defaultFixturesRoot(),
  readText: ReadText = (path) => readFileSync(path, 'utf8'),
): FixtureLoader {
  const cache = new Map<string, FixtureFile>();
  let catalog: SessionWire[] | undefined;
  return {
    catalog() {
      catalog ??= CatalogSchema.parse(
        JSON.parse(readText(join(root, 'synthetic', 'catalog.json'))),
      );
      return catalog;
    },
    fixture(operation, scenario) {
      if (!SCENARIO_PATTERN.test(scenario)) {
        throw new Error('Invalid fixture scenario name');
      }
      const path = join(root, 'api', operationFolder(operation), `${scenario}.json`);
      let file = cache.get(path);
      if (file === undefined) {
        file = FixtureFileSchema.parse(JSON.parse(readText(path)));
        cache.set(path, file);
      }
      return file;
    },
  };
}
