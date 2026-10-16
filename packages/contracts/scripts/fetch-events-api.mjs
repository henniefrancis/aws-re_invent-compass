// Operator-run fetch helper for the official AWS Events API OpenAPI document.
//
// This is an operator action, not a CI or test action. No vitest test imports
// or runs the live fetch path: tests mock the helper instead (see task 3.3).
//
// Behaviour (Requirements 3.1 and 3.5):
//  - Retrieves the OpenAPI document from the source URL using global fetch.
//  - On a network error (fetch rejects) or a non-200 status, throws a
//    descriptive Error that names the URL and the HTTP status (for non-200) or
//    the underlying cause (for network errors), and writes nothing. Any
//    previously committed document is left byte for byte unchanged.
//  - On success, writes the exact response bytes to a temp file in the same
//    directory as the destination, then atomically renames it over the
//    destination (temp file then rename).
//
// Dependency free: Node builtins and global fetch only.

import { rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EVENTS_API_OPENAPI_URL = 'https://api.awsevents.com/v1/openapi.json';

// Resolve the committed document path relative to the repository root. This
// file lives at packages/contracts/scripts/, so the repo root is three levels
// up, and the committed document is packages/contracts/events-api.openapi.json.
const thisDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_PATH = resolve(thisDir, '..', 'events-api.openapi.json');

/**
 * Fetch the Events API OpenAPI document and write it atomically to outPath.
 *
 * @param {object} options
 * @param {string} options.url The source URL to retrieve.
 * @param {string} options.outPath The destination file path.
 * @returns {Promise<{ url: string, outPath: string, bytes: number }>}
 */
export async function fetchEventsApiOpenApi({ url, outPath }) {
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Failed to fetch the Events API OpenAPI document from ${url}: network error (${reason}). The committed document was left unchanged.`,
      { cause },
    );
  }

  if (response.status !== 200) {
    throw new Error(
      `Failed to fetch the Events API OpenAPI document from ${url}: unexpected HTTP status ${response.status}. The committed document was left unchanged.`,
    );
  }

  // Preserve the exact bytes received. Read as text and write with no
  // reformatting so the committed document is exactly the official bytes.
  const body = await response.text();

  // Write to a temp file in the same directory, then rename over outPath so the
  // replace is atomic and a failed write never truncates the committed file.
  const tempPath = `${outPath}.tmp-${process.pid}`;
  try {
    await writeFile(tempPath, body, 'utf8');
    await rename(tempPath, outPath);
  } catch (cause) {
    // Best effort cleanup of the temp file so a partial write leaves no trace.
    await unlink(tempPath).catch(() => {});
    throw cause;
  }

  return { url, outPath, bytes: Buffer.byteLength(body, 'utf8') };
}

// CLI entry: run directly to fetch the official document into the committed
// location. Example: node packages/contracts/scripts/fetch-events-api.mjs
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  fetchEventsApiOpenApi({
    url: EVENTS_API_OPENAPI_URL,
    outPath: DEFAULT_OUT_PATH,
  })
    .then((result) => {
      process.stdout.write(`Wrote ${result.bytes} bytes from ${result.url} to ${result.outPath}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
