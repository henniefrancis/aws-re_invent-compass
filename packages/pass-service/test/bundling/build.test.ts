import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import fc from 'fast-check';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  DOS_DATE,
  DOS_TIME,
  UNIX_FILE_MODE,
  zipDeterministic,
} from '../../src/bundling/deterministic-zip.js';
import { MAX_BUNDLE_BYTES, bundleLambdas } from '../../src/bundling/bundle-lambdas.js';
import { BASE_ENV } from '../helpers/api-fixture.js';
import { readZip } from '../helpers/zip-reader.js';

vi.setConfig({ testTimeout: 300_000 });

const folders: string[] = [];
function temp(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'compass-build-test-'));
  folders.push(folder);
  return folder;
}
afterAll(() => {
  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('Feature: pass-service, deterministic zip', () => {
  // Feature: pass-service, Property 37: The zip writer is deterministic
  test('Property 37: any order gives identical sorted entries with a fixed time and mode', () => {
    const pathArb = fc.stringMatching(/^[a-z0-9][a-z0-9._/-]{0,20}$/);
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(pathArb, fc.uint8Array({ maxLength: 300 })), {
          selector: ([p]) => p,
          maxLength: 8,
        }),
        fc.nat(),
        (pairs, seed) => {
          const entries = pairs.map(([p, data]) => ({ path: p, data }));
          const shuffled = [...entries].sort(
            (a, b) => ((a.path.length * 31 + seed) % 7) - ((b.path.length * 17 + seed) % 7),
          );
          const first = zipDeterministic(entries);
          expect(Buffer.from(zipDeterministic(shuffled)).equals(Buffer.from(first))).toBe(true);
          const read = readZip(first);
          const sortedPaths = entries
            .map((e) => e.path)
            .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
          expect(read.map((e) => e.path)).toEqual(sortedPaths);
          for (const entry of read) {
            const original = entries.find((e) => e.path === entry.path);
            expect(Buffer.from(original?.data ?? []).equals(entry.data)).toBe(true);
            expect(entry.crcOk).toBe(true);
            expect(entry.dosTime).toBe(DOS_TIME);
            expect(entry.dosDate).toBe(DOS_DATE);
            expect(entry.externalAttributes >>> 16).toBe(UNIX_FILE_MODE);
            expect(entry.extraLength).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('an empty archive is valid and a duplicate path is refused', () => {
    expect(readZip(zipDeterministic([]))).toEqual([]);
    expect(() =>
      zipDeterministic([
        { path: 'a', data: new Uint8Array() },
        { path: 'a', data: new Uint8Array() },
      ]),
    ).toThrow(RangeError);
  });
});

describe('Feature: pass-service, Lambda bundles', () => {
  test('two builds give exactly two zips with one index.mjs each, byte-identical, under 5 MB, exporting handler', async () => {
    const first = temp();
    const second = temp();
    const reports = await bundleLambdas({ outDir: first, esbuild });
    const again = await bundleLambdas({ outDir: second, esbuild });
    expect(reports.map((r) => r.name)).toEqual(['api', 'passkit']);
    expect(again).toEqual(reports);
    for (const report of reports) {
      const a = readFileSync(path.join(first, `${report.name}.zip`));
      const b = readFileSync(path.join(second, `${report.name}.zip`));
      expect(a.equals(b)).toBe(true);
      expect(report.bytes).toBe(a.length);
      expect(report.bytes).toBeLessThan(MAX_BUNDLE_BYTES);
      expect(report.sha256).toBe(createHash('sha256').update(a).digest('hex'));
      const entries = readZip(a);
      expect(entries.map((e) => e.path)).toEqual(['index.mjs']);
      const code = entries[0]?.data.toString('utf8') ?? '';
      expect(code).not.toContain('sourceMappingURL');

      const file = path.join(temp(), 'index.mjs');
      writeFileSync(file, code);
      const saved = { ...process.env };
      Object.assign(process.env, BASE_ENV);
      try {
        const module = (await import(pathToFileURL(file).href)) as { handler: unknown };
        expect(typeof module.handler).toBe('function');
      } finally {
        for (const key of Object.keys(BASE_ENV)) {
          if (saved[key] === undefined) {
            delete process.env[key];
          }
        }
      }
    }
    expect(readdirSync(first).sort()).toEqual(['api.zip', 'passkit.zip']);
  });

  test('the build fails and names the bundle when a zip reaches 5 MB', async () => {
    const noise = randomBytes(MAX_BUNDLE_BYTES + 1024);
    const fake = {
      build: () => Promise.resolve({ outputFiles: [{ contents: noise }] }),
    } as unknown as typeof esbuild;
    await expect(
      bundleLambdas({ outDir: temp(), esbuild: fake, packageRoot: temp() }),
    ).rejects.toThrow(/bundle api is \d+ bytes/);
  });
});
