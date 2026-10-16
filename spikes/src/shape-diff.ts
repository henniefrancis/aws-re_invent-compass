// SP5 shape-diff logic (foundation-contracts, S0).
//
// The SP5 spike compares the shape of real API recordings (git-ignored, under
// fixtures/.raw/) against the synthetic catalog and the Events API OpenAPI. It
// reports FIELD-LEVEL differences only: which field names are present on one side
// but not the other, and where a field's JSON type differs. It never prints a
// recorded VALUE (Requirement 10.6). This module holds the pure diff logic so it
// can be unit tested without any real recording.
//
// This file contains no em dash or en dash.

/** The JSON type descriptors used in a diff. Never a value, only a type name. */
export type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'absent';

/**
 * Describe the JSON type of a value as a short descriptor. Returns a type name
 * only, never the value itself.
 */
export function jsonType(value: unknown): JsonType {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return t;
  }
  if (t === 'object') {
    return 'object';
  }
  // undefined, function, symbol, bigint: treat as absent for shape purposes.
  return 'absent';
}

/** One field-level difference. Carries names and type descriptors only. */
export interface FieldDiff {
  // The dotted path to the field (object keys only; array elements are compared by
  // the type of their first element, never by content).
  path: string;
  // What kind of difference this is.
  kind: 'only-in-expected' | 'only-in-actual' | 'type-mismatch';
  // The type seen on the expected (catalog or OpenAPI) side.
  expectedType: JsonType;
  // The type seen on the actual (recording) side.
  actualType: JsonType;
}

// Collect the set of object keys for a value, or an empty list for a non-object.
function keysOf(value: unknown): string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value).sort();
  }
  return [];
}

/**
 * Diff the shape of two values, returning field-level differences only. The diff
 * descends into nested objects and into the FIRST element of arrays (to learn the
 * element shape), but never records any scalar value. Field order does not matter;
 * paths are reported in sorted order.
 *
 * @param expected the reference shape (synthetic catalog or OpenAPI-derived sample)
 * @param actual the recording's shape
 * @param basePath the dotted path prefix (used in recursion)
 * @returns the field differences, sorted by path
 */
export function diffShape(expected: unknown, actual: unknown, basePath = ''): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const expectedType = jsonType(expected);
  const actualType = jsonType(actual);

  // A type mismatch at this node (only when both sides are present).
  if (
    expectedType !== actualType &&
    expectedType !== 'absent' &&
    actualType !== 'absent' &&
    basePath !== ''
  ) {
    diffs.push({ path: basePath, kind: 'type-mismatch', expectedType, actualType });
    // Do not descend when the node types disagree; the mismatch is the finding.
    return diffs;
  }

  // Descend into objects: compare the union of key sets.
  if (expectedType === 'object' || actualType === 'object') {
    const expectedObj = (expected ?? {}) as Record<string, unknown>;
    const actualObj = (actual ?? {}) as Record<string, unknown>;
    const allKeys = Array.from(new Set([...keysOf(expected), ...keysOf(actual)])).sort();
    for (const key of allKeys) {
      const childPath = basePath === '' ? key : `${basePath}.${key}`;
      const inExpected = Object.prototype.hasOwnProperty.call(expectedObj, key);
      const inActual = Object.prototype.hasOwnProperty.call(actualObj, key);
      if (inExpected && !inActual) {
        diffs.push({
          path: childPath,
          kind: 'only-in-expected',
          expectedType: jsonType(expectedObj[key]),
          actualType: 'absent',
        });
      } else if (!inExpected && inActual) {
        diffs.push({
          path: childPath,
          kind: 'only-in-actual',
          expectedType: 'absent',
          actualType: jsonType(actualObj[key]),
        });
      } else {
        diffs.push(...diffShape(expectedObj[key], actualObj[key], childPath));
      }
    }
    return diffs;
  }

  // Descend into arrays by their first element only, to learn element shape
  // without ever reading element values beyond their type.
  if (expectedType === 'array' && actualType === 'array') {
    const e = expected as unknown[];
    const a = actual as unknown[];
    if (e.length > 0 && a.length > 0) {
      diffs.push(...diffShape(e[0], a[0], `${basePath}[]`));
    }
    return diffs;
  }

  return diffs;
}

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * List the .json recording files in a raw directory. Returns an empty list when
 * the directory is absent or contains no .json files. Never throws for a missing
 * directory.
 *
 * @param rawDir the directory to scan (for example fixtures/.raw)
 * @returns the absolute-ish paths (rawDir joined with each matching file name)
 */
export async function listRecordings(rawDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(rawDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(rawDir, name));
}

/**
 * The result of a shape-diff run: the lines to print and the process exit code.
 * An absent or empty raw directory is the normal clean state and exits 0.
 */
export interface ShapeDiffRun {
  lines: string[];
  exitCode: number;
}

/**
 * Run the shape diff for every recording in rawDir against a reference shape.
 * Returns report lines (field names and type descriptors only, never a recorded
 * value) and an exit code. When there are no recordings it reports that and exits
 * 0 (Requirement 10.4). This function does the file reading so the wrapper stays
 * thin and this logic stays unit testable.
 *
 * @param options.rawDir the recordings directory
 * @param options.reference the reference shape to diff each recording against
 * @param options.readJson reads and parses a JSON file (injectable for tests)
 * @returns the lines and exit code
 */
export async function runShapeDiff({
  rawDir,
  reference,
  readJson = defaultReadJson,
}: {
  rawDir: string;
  reference: unknown;
  readJson?: (path: string) => Promise<unknown>;
}): Promise<ShapeDiffRun> {
  const recordings = await listRecordings(rawDir);
  if (recordings.length === 0) {
    return { lines: ['no recordings present'], exitCode: 0 };
  }

  const lines: string[] = [];
  for (const file of recordings) {
    const recording = await readJson(file);
    // Array.isArray narrows recording to any[]; keep the element typed as unknown
    // so no any flows into diffShape (which accepts unknown).
    const sample: unknown = Array.isArray(recording)
      ? (recording as unknown[])[0]
      : recording;
    const diffs = diffShape(reference, sample);
    lines.push(`Recording ${file}:`);
    lines.push(...formatDiffReport(diffs));
  }
  return { lines, exitCode: 0 };
}

/** Default JSON reader used by runShapeDiff in production. */
async function defaultReadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

/**
 * Render field diffs as report lines. Each line names the path, the kind and the
 * type descriptors. No value ever appears.
 */
export function formatDiffReport(diffs: FieldDiff[]): string[] {
  if (diffs.length === 0) {
    return ['No shape differences found.'];
  }
  return diffs.map((d) => {
    switch (d.kind) {
      case 'only-in-expected':
        return `  ${d.path}: present in reference (${d.expectedType}), absent in recording`;
      case 'only-in-actual':
        return `  ${d.path}: present in recording (${d.actualType}), absent in reference`;
      case 'type-mismatch':
        return `  ${d.path}: type differs (reference ${d.expectedType}, recording ${d.actualType})`;
    }
  });
}
