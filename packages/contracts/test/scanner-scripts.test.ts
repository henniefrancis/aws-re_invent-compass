import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  genCopy,
  removeQuietly,
  runCli as genCopyRunCli,
} from '../../../.github/scripts/gen-copy.mjs';
import { genTypes, runCli as genTypesRunCli } from '../../../.github/scripts/gen-types.mjs';
import {
  regenerate,
  check,
  emit,
  describeError,
  runCli as catalogRunCli,
} from '../../../.github/scripts/catalog-check.mjs';
import { runCli as hashRunCli } from '../../../.github/scripts/hash-check.mjs';
import { runCli as placeholderRunCli } from '../../../.github/scripts/placeholder-safety.mjs';
import { runCli as dashRunCli } from '../../../.github/scripts/dash-check.mjs';
import { applyCli, isMain, maybeRunCli } from '../../../.github/scripts/cli.mjs';

// Coverage tests for the generator and scanner scripts (foundation-contracts, S0).
//
// Every script keeps its real logic in exported functions and a pure runCli()
// that returns { code, stdout, stderr }. These tests drive each function and each
// runCli branch in-process (success, failure and, where relevant, write modes),
// plus the shared cli.mjs helpers, so .github/scripts/*.mjs and
// fixtures/synthetic/generate.ts reach 100% coverage with no new exclusions and no
// subprocess.

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');
const scriptsDir = resolve(repoRoot, '.github', 'scripts');

// Run a callback with process.exitCode preserved, so a runCli applied to the
// process by a test never leaks into the test runner's own exit code.
async function withPreservedExitCode<T>(fn: () => T | Promise<T>): Promise<T> {
  const saved = process.exitCode;
  try {
    return await fn();
  } finally {
    process.exitCode = saved;
  }
}

describe('Feature: foundation-contracts, cli helpers', () => {
  test('applyCli writes output and sets the exit code', async () => {
    await withPreservedExitCode(() => {
      applyCli({ code: 0 });
      expect(process.exitCode).toBe(0);
      applyCli({ code: 1, stdout: 'out\n', stderr: 'err\n' });
      expect(process.exitCode).toBe(1);
    });
  });

  test('isMain is true only for a matching argv and module URL', () => {
    const url = pathToFileURL(resolve(scriptsDir, 'hash-check.mjs')).href;
    expect(isMain(fileURLToPath(url), url)).toBe(true);
    expect(isMain(undefined, url)).toBe(false);
    expect(isMain(fileURLToPath(url), 'file:///other.mjs')).toBe(false);
  });

  test('maybeRunCli runs when driven as main and skips otherwise', async () => {
    const url = pathToFileURL(resolve(scriptsDir, 'hash-check.mjs')).href;
    let ran = 0;
    const fakeRunCli = () => {
      ran += 1;
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    // Not main: does not run.
    expect(await maybeRunCli({ runCli: fakeRunCli, argv1: undefined, metaUrl: url })).toBe(false);
    expect(ran).toBe(0);
    // Forced main: runs once. Preserve the exit code it sets.
    await withPreservedExitCode(async () => {
      expect(
        await maybeRunCli({ runCli: fakeRunCli, argv1: fileURLToPath(url), metaUrl: url }),
      ).toBe(true);
    });
    expect(ran).toBe(1);
  });
});

describe('Feature: foundation-contracts, gen-copy', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gen-copy-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('genCopy copies the source byte for byte to every destination, creating dirs', async () => {
    const source = join(dir, 'source.yaml');
    const payload = 'openapi: 3.0.1\n';
    await writeFile(source, payload, 'utf8');
    const copies = [join(dir, 'a', 'copy.yaml'), join(dir, 'b', 'copy.yaml')];
    const result = await genCopy({ source, copies });
    expect(result.bytes).toBe(Buffer.byteLength(payload));
    for (const c of copies) {
      expect(await readFile(c, 'utf8')).toBe(payload);
    }
  });

  test('runCli reports success over the real committed files', async () => {
    const r = await genCopyRunCli();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Copied');
  });

  test('runCli reports failure when the source is missing', async () => {
    const r = await genCopyRunCli({
      source: join(dir, 'missing.yaml'),
      copies: [join(dir, 'out.yaml')],
    });
    expect(r.code).toBe(1);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test('genCopy cleans up and rethrows when the rename to a destination fails', async () => {
    // Make the destination an existing non-empty directory so mkdir succeeds, the
    // temp write succeeds, but the rename onto a directory fails. That drives the
    // inner catch-and-cleanup branch before the error is rethrown.
    const source = join(dir, 'source.yaml');
    await writeFile(source, 'openapi: 3.0.1\n', 'utf8');
    const destDir = join(dir, 'dest.yaml');
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, 'occupant'), 'x', 'utf8');
    await expect(genCopy({ source, copies: [destDir] })).rejects.toThrow();
  });

  test('removeQuietly deletes an existing file and ignores a missing one', async () => {
    const existing = join(dir, 'tmp.txt');
    await writeFile(existing, 'x', 'utf8');
    // Deletes the existing file (success path).
    await expect(removeQuietly(existing)).resolves.toBeUndefined();
    // Ignores a missing file (the swallowed-error path).
    await expect(removeQuietly(join(dir, 'never.txt'))).resolves.toBeUndefined();
  });
});

describe('Feature: foundation-contracts, gen-types', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gen-types-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('genTypes generates a banner-prefixed type file for each target', async () => {
    const input = join(dir, 'mini.yaml');
    const output = join(dir, 'mini.ts');
    await writeFile(
      input,
      ['openapi: 3.0.1', 'info:', '  title: Mini', '  version: 1.0.0', 'paths: {}', ''].join('\n'),
      'utf8',
    );
    const written = await genTypes({ targets: [{ input, output }] });
    expect(written).toEqual([output]);
    expect((await readFile(output, 'utf8')).startsWith('// Generated by openapi-typescript.')).toBe(
      true,
    );
  });

  test('runCli reports success over a temp target', async () => {
    const input = join(dir, 'mini.yaml');
    const output = join(dir, 'mini.ts');
    await writeFile(
      input,
      ['openapi: 3.0.1', 'info:', '  title: Mini', '  version: 1.0.0', 'paths: {}', ''].join('\n'),
      'utf8',
    );
    const r = await genTypesRunCli({ targets: [{ input, output }] });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Generated');
  });

  test('runCli reports failure when a target input is missing', async () => {
    const r = await genTypesRunCli({
      targets: [{ input: join(dir, 'missing.yaml'), output: join(dir, 'out.ts') }],
    });
    expect(r.code).toBe(1);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});

describe('Feature: foundation-contracts, catalog-check', () => {
  // Every write-mode test emits into this temp directory, never the tracked
  // fixtures, so parallel readers of fixtures/synthetic/catalog.json are never
  // raced against a concurrent write.
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'catalog-write-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('regenerate yields byte-stable catalog and index strings and the sessions', async () => {
    const { catalog, index, sessions } = await regenerate();
    expect(catalog.endsWith('\n')).toBe(true);
    expect(index.endsWith('\n')).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
  });

  test('check passes against the committed catalog', async () => {
    const { ok, problems } = await check();
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
  });

  test('emit writes to the given paths atomically and the written files round-trip', async () => {
    const catalogPath = join(dir, 'catalog.json');
    const indexPath = join(dir, 'index.json');
    const r = await emit({ catalogPath, indexPath });
    expect(r.count).toBeGreaterThan(0);
    expect(r.catalogBytes).toBeGreaterThan(0);
    expect(r.indexBytes).toBeGreaterThan(0);
    // The emitted files match the generator output, so a check against them passes.
    const after = await check({ catalogPath, indexPath });
    expect(after.ok).toBe(true);
  });

  test('runCli check mode reports ok', async () => {
    const r = await catalogRunCli();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('catalog check ok');
  });

  test('runCli write mode reports what it wrote and writes only to the temp paths', async () => {
    const catalogPath = join(dir, 'catalog.json');
    const indexPath = join(dir, 'index.json');
    const r = await catalogRunCli({
      mode: '--write',
      emitFn: () => emit({ catalogPath, indexPath }),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('wrote catalog.json');
  });
});

describe('Feature: foundation-contracts, catalog-check failure branches', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'catalog-fail-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('describeError handles both an Error and a non-Error value', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain string cause')).toBe('plain string cause');
    expect(describeError(42)).toBe('42');
  });

  test('reports a read error when a committed file is absent', async () => {
    const { problems, ok } = await check({
      catalogPath: join(dir, 'missing-catalog.json'),
      indexPath: join(dir, 'missing-index.json'),
    });
    expect(ok).toBe(false);
    expect(problems.some((p) => p.includes('cannot read a committed catalog file'))).toBe(true);
  });

  test('emit cleans up and rethrows when a destination write fails', async () => {
    // A catalog path whose parent does not exist makes the atomic temp write fail,
    // driving the cleanup-and-rethrow branch. Nothing tracked is touched.
    const badCatalog = join(dir, 'no-such-dir', 'catalog.json');
    await expect(
      emit({ catalogPath: badCatalog, indexPath: join(dir, 'index.json') }),
    ).rejects.toThrow();
  });

  test('reports a byte mismatch when the committed files differ from the generator', async () => {
    // A valid JSON array that is not the generator output, plus a wrong index.
    const catalogPath = join(dir, 'catalog.json');
    const indexPath = join(dir, 'index.json');
    await writeFile(catalogPath, '[]\n', 'utf8');
    await writeFile(indexPath, '{}\n', 'utf8');
    const { problems, ok } = await check({ catalogPath, indexPath });
    expect(ok).toBe(false);
    expect(problems.some((p) => p.includes('catalog.json does not match'))).toBe(true);
    expect(problems.some((p) => p.includes('index.json does not match'))).toBe(true);
  });

  test('reports invalid JSON in the committed catalog', async () => {
    const catalogPath = join(dir, 'catalog.json');
    const indexPath = join(dir, 'index.json');
    await writeFile(catalogPath, 'not json', 'utf8');
    await writeFile(indexPath, '{}\n', 'utf8');
    const { problems, ok } = await check({ catalogPath, indexPath });
    expect(ok).toBe(false);
    expect(problems.some((p) => p.includes('is not valid JSON'))).toBe(true);
  });

  test('reports when the committed catalog is not a JSON array', async () => {
    const catalogPath = join(dir, 'catalog.json');
    const indexPath = join(dir, 'index.json');
    await writeFile(catalogPath, '{"not":"an array"}', 'utf8');
    await writeFile(indexPath, '{}\n', 'utf8');
    const { problems, ok } = await check({ catalogPath, indexPath });
    expect(ok).toBe(false);
    expect(problems.some((p) => p.includes('is not a JSON array'))).toBe(true);
  });

  test('reports the first session that fails the schema', async () => {
    const catalogPath = join(dir, 'catalog.json');
    const indexPath = join(dir, 'index.json');
    // A JSON array whose first element is missing the required sessionId and title.
    await writeFile(catalogPath, JSON.stringify([{ nope: true }]), 'utf8');
    await writeFile(indexPath, '{}\n', 'utf8');
    const { problems, ok } = await check({ catalogPath, indexPath });
    expect(ok).toBe(false);
    expect(problems.some((p) => p.includes('fails SessionWireSchema'))).toBe(true);
  });

  test('runCli check mode formats a FAILED report for crafted mismatching files', async () => {
    const catalogPath = join(dir, 'catalog.json');
    const indexPath = join(dir, 'index.json');
    await writeFile(catalogPath, '[]\n', 'utf8');
    await writeFile(indexPath, '{}\n', 'utf8');
    const r = await catalogRunCli({ checkOptions: { catalogPath, indexPath } });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('catalog check FAILED');
  });

  test('runCli surfaces a thrown error in write mode', async () => {
    const r = await catalogRunCli({
      mode: '--write',
      emitFn: () => Promise.reject(new Error('emit boom')),
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('emit boom');
  });

  test('runCli surfaces a thrown error in check mode', async () => {
    const r = await catalogRunCli({
      checkFn: () => Promise.reject(new Error('check boom')),
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('check boom');
  });
});

describe('Feature: foundation-contracts, scanner runCli branches', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scanner-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('hash-check runCli reports ok, mismatch and read error', async () => {
    const ok = await hashRunCli();
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('hash check ok');

    const a = join(dir, 'a.yaml');
    const b = join(dir, 'b.yaml');
    await writeFile(a, 'one', 'utf8');
    await writeFile(b, 'two', 'utf8');
    const bad = await hashRunCli({ files: [a, b] });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('hash check FAILED');

    const err = await hashRunCli({ files: [join(dir, 'missing.yaml')] });
    expect(err.code).toBe(1);
    expect(err.stderr.length).toBeGreaterThan(0);
  });

  test('placeholder-safety runCli reports ok, findings and read error', async () => {
    const ok = await placeholderRunCli();
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('placeholder safety ok');

    const bad = join(dir, 'bad.yaml');
    await writeFile(bad, 'account 123456789012 here\n', 'utf8');
    const found = await placeholderRunCli({ files: [bad] });
    expect(found.code).toBe(1);
    expect(found.stderr).toContain('placeholder safety FAILED');

    const err = await placeholderRunCli({ files: [join(dir, 'missing.yaml')] });
    expect(err.code).toBe(1);
    expect(err.stderr.length).toBeGreaterThan(0);
  });

  test('dash-check runCli reports ok and findings, and skips unreadable files', async () => {
    const ok = dashRunCli();
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('dash check ok');

    // A file with an en dash is flagged.
    await writeFile(join(dir, 'doc.md'), 'a \u2013 b\n', 'utf8');
    const bad = dashRunCli({ cwd: dir, files: ['doc.md'] });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('dash check FAILED');

    // An unreadable (missing) listed file is skipped, not an error, so with only a
    // missing file the result is ok.
    const skipped = dashRunCli({ cwd: dir, files: ['missing-file.md'] });
    expect(skipped.code).toBe(0);
    expect(skipped.stdout).toContain('dash check ok');

    // A thrown error from the scan is surfaced as a non-zero code.
    const errored = dashRunCli({
      dashCheckFn: () => {
        throw new Error('scan boom');
      },
    });
    expect(errored.code).toBe(1);
    expect(errored.stderr).toContain('scan boom');
  });
});
