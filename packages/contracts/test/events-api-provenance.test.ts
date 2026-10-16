import { afterEach, describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Unit tests for the Events API fetch helper and the ADR-023 provenance record
// (foundation-contracts, S0).
//
// These are ordinary unit assertions, not property tests. They prove two things:
//  1. A failing fetch (non-200 status or a network error) surfaces a descriptive
//     error that names the source URL and leaves the committed document byte for
//     byte unchanged. Validates Requirement 3.5.
//  2. ADR-023 records the source URL and a SHA-256 that equals the hash of the
//     committed Events API OpenAPI document. Validates Requirement 3.2.
//
// Safety: no test here ever calls the live Events API. global fetch is stubbed
// with vi.stubGlobal in every case that exercises the helper, and the stub is
// removed after each test. The tests run with COMPASS_MODE=simulated, set by
// vitest.config.ts.

// Resolve the repository root by walking up from this test file until a
// package.json that declares a workspaces field is found. This mirrors the
// resolution used by the sibling scaffold tests and is robust across OSes.
function findRepoRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
          workspaces?: unknown;
        };
        if (parsed.workspaces !== undefined) {
          return current;
        }
      } catch {
        // Ignore an unparseable manifest and keep walking up.
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(dirname(fileURLToPath(import.meta.url)));
    }
    current = parent;
  }
}

const repoRoot = findRepoRoot();

// Absolute paths to the real committed document, the helper module and the ADR.
const committedDocPath = join(repoRoot, 'packages', 'contracts', 'events-api.openapi.json');
const helperPath = join(repoRoot, 'packages', 'contracts', 'scripts', 'fetch-events-api.mjs');
const adrPath = join(repoRoot, 'docs', 'decisions', 'ADR-023-events-api-openapi-source.md');

// The helper is an .mjs ESM module. Import it by file URL so resolution works on
// every OS regardless of the test file location. The dynamic import is awaited
// inside each test that needs it.
type FetchHelperModule = {
  fetchEventsApiOpenApi: (options: {
    url: string;
    outPath: string;
  }) => Promise<{ url: string; outPath: string; bytes: number }>;
  EVENTS_API_OPENAPI_URL: string;
  DEFAULT_OUT_PATH: string;
};

async function loadHelper(): Promise<FetchHelperModule> {
  return (await import(pathToFileURL(helperPath).href)) as FetchHelperModule;
}

// Compute the SHA-256 of a file as lowercase hex.
function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('Feature: foundation-contracts, Events API fetch helper', () => {
  afterEach(() => {
    // Remove the fetch stub after every test so no stub leaks across tests and
    // so the real global fetch is never left replaced.
    vi.unstubAllGlobals();
  });

  test('a non-200 status throws a descriptive error naming the URL and status, and leaves the committed document unchanged', async () => {
    const { fetchEventsApiOpenApi, EVENTS_API_OPENAPI_URL } = await loadHelper();

    // Capture the exact committed bytes before the failing call.
    const bytesBefore = readFileSync(committedDocPath);

    // Mock fetch to resolve to a Response-shaped object with a 500 status. The
    // helper must throw before writing anything, so pointing outPath at the real
    // committed document is safe: a failed fetch never touches it.
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        status: 500,
        text: () => Promise.resolve('internal server error'),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      fetchEventsApiOpenApi({
        url: EVENTS_API_OPENAPI_URL,
        outPath: committedDocPath,
      }),
    ).rejects.toThrow(
      new RegExp(`${EVENTS_API_OPENAPI_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*500`),
    );

    // fetch was called exactly once with the source URL, and no real network
    // request was made.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(EVENTS_API_OPENAPI_URL);

    // The committed document is byte for byte identical to the pre-captured bytes.
    const bytesAfter = readFileSync(committedDocPath);
    expect(bytesAfter.equals(bytesBefore)).toBe(true);
  });

  test('a network error throws a descriptive error naming the URL and surfacing the cause, and leaves the committed document unchanged', async () => {
    const { fetchEventsApiOpenApi, EVENTS_API_OPENAPI_URL } = await loadHelper();

    const bytesBefore = readFileSync(committedDocPath);

    // Mock fetch to reject with a network error. The helper must throw before any
    // write, so the real committed document is provably untouched.
    const cause = new Error('boom');
    const mockFetch = vi.fn(() => Promise.reject(cause));
    vi.stubGlobal('fetch', mockFetch);

    const call = fetchEventsApiOpenApi({
      url: EVENTS_API_OPENAPI_URL,
      outPath: committedDocPath,
    });

    // The error names the URL and surfaces the underlying cause message.
    await expect(call).rejects.toThrow(
      new RegExp(EVENTS_API_OPENAPI_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    await expect(call).rejects.toThrow(/boom/);

    // The helper invoked fetch exactly once for this single call, and no real
    // network request was made.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(EVENTS_API_OPENAPI_URL);

    const bytesAfter = readFileSync(committedDocPath);
    expect(bytesAfter.equals(bytesBefore)).toBe(true);
  });

  test('a successful 200 fetch writes the exact bytes to a temp destination without touching the committed document', async () => {
    const { fetchEventsApiOpenApi, EVENTS_API_OPENAPI_URL } = await loadHelper();

    const bytesBefore = readFileSync(committedDocPath);

    // A unique temp destination in the OS temp directory, never the committed path.
    const tempOut = join(tmpdir(), `events-api-success-${process.pid}-${Date.now()}.json`);
    const payload = '{"ok":true}';

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        text: () => Promise.resolve(payload),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    try {
      const result = await fetchEventsApiOpenApi({
        url: EVENTS_API_OPENAPI_URL,
        outPath: tempOut,
      });

      // The temp file now holds exactly the mocked bytes, and the helper reports
      // the written byte count.
      expect(readFileSync(tempOut, 'utf8')).toBe(payload);
      expect(result.bytes).toBe(Buffer.byteLength(payload, 'utf8'));
      expect(result.outPath).toBe(tempOut);

      // The committed document is still byte for byte unchanged.
      const bytesAfter = readFileSync(committedDocPath);
      expect(bytesAfter.equals(bytesBefore)).toBe(true);
    } finally {
      // Clean up the temp file whether or not the assertions passed.
      rmSync(tempOut, { force: true });
    }
  });
});

describe('Feature: foundation-contracts, ADR-023 provenance', () => {
  test('ADR-023 records the source URL of the committed Events API document', () => {
    const adrText = readFileSync(adrPath, 'utf8');
    expect(adrText).toContain('https://api.awsevents.com/v1/openapi.json');
  });

  test('the SHA-256 recorded in ADR-023 equals the hash of the committed Events API document', () => {
    const adrText = readFileSync(adrPath, 'utf8');

    // Extract a 64 character lowercase hex string from the ADR text. This is the
    // recorded SHA-256 of the committed document.
    const match = adrText.match(/[0-9a-f]{64}/);
    expect(match, 'ADR-023 must record a 64 character lowercase hex SHA-256').not.toBeNull();
    const recordedHash = match?.[0];

    // Compute the actual SHA-256 of the committed document and compare. This is
    // the real guard that the ADR matches the file currently committed.
    const actualHash = sha256OfFile(committedDocPath);
    expect(recordedHash).toBe(actualHash);
  });
});
