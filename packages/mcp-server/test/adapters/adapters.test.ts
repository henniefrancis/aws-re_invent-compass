import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFetchTransport, MAX_RESPONSE_BYTES } from '../../src/adapters/fetch-transport.js';
import { createNodeAppFileSystem } from '../../src/adapters/node-fs-adapter.js';
import { CompassError } from '../../src/ports/errors.js';
import { installNetworkGuard } from '../support/network-guard.js';

function codeOf(error: unknown): string {
  return error instanceof CompassError ? error.code : 'not a CompassError';
}

describe('fetch transport', () => {
  function recordingFetch(response: () => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn: typeof fetch = async (input, init) => {
      calls.push({ url: input instanceof URL ? input.href : 'request', init: init ?? {} });
      return response();
    };
    return { fn, calls };
  }

  test('sends https requests with no redirects and a timeout and returns bytes', async () => {
    const { fn, calls } = recordingFetch(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'application/vnd.apple.pkpass' },
        }),
    );
    const transport = createFetchTransport({ fetch: fn, timeoutMs: 5000 });
    const response = await transport.request({
      method: 'POST',
      url: 'https://compass.invalid/api/v1/passes',
      headers: { Authorization: 'Bearer x' },
      body: 'payload',
      binary: true,
    });
    expect(response.status).toBe(200);
    expect(response.body).toBe('');
    expect([...(response.bytes ?? [])]).toEqual([1, 2, 3]);
    expect(response.headers['content-type']).toBe('application/vnd.apple.pkpass');
    expect(calls[0]?.init.redirect).toBe('error');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('payload');
    const noBody = await transport.request({
      method: 'GET',
      url: 'https://compass.invalid/x',
      headers: {},
    });
    expect(noBody.status).toBe(200);
    expect('body' in (calls[1]?.init ?? {})).toBe(false);
  });

  test('refuses non-https and unparseable URLs without calling fetch', async () => {
    const { fn, calls } = recordingFetch(() => new Response('x'));
    const transport = createFetchTransport({ fetch: fn, timeoutMs: 1000 });
    for (const url of ['http://compass.invalid/x', 'not a url', 'ftp://x/y']) {
      await expect(transport.request({ method: 'GET', url, headers: {} })).rejects.toSatisfy(
        (error) => codeOf(error) === 'BadRequest',
      );
    }
    expect(calls).toEqual([]);
  });

  test('a network failure or a body read failure becomes a fixed Network error', async () => {
    const failing = createFetchTransport({
      fetch: () => Promise.reject(new Error('secret-token-123')),
      timeoutMs: 1000,
    });
    const error: unknown = await failing
      .request({ method: 'GET', url: 'https://compass.invalid/x', headers: {} })
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('Network');
    expect(String((error as Error).message)).not.toContain('secret');
    const brokenBody = createFetchTransport({
      fetch: () =>
        Promise.resolve({
          status: 200,
          headers: new Headers(),
          arrayBuffer: () => Promise.reject(new Error('x')),
          text: () => Promise.reject(new Error('x')),
        } as unknown as Response),
      timeoutMs: 1000,
    });
    for (const binary of [true, false]) {
      await expect(
        brokenBody.request({
          method: 'GET',
          url: 'https://compass.invalid/x',
          headers: {},
          binary,
        }),
      ).rejects.toSatisfy((e) => codeOf(e) === 'Network');
    }
  });

  test('a response over the size cap is refused', async () => {
    const { fn } = recordingFetch(() => new Response(new Uint8Array(MAX_RESPONSE_BYTES + 1)));
    const transport = createFetchTransport({ fetch: fn, timeoutMs: 1000 });
    for (const binary of [true, false]) {
      await expect(
        transport.request({ method: 'GET', url: 'https://compass.invalid/x', headers: {}, binary }),
      ).rejects.toSatisfy((e) => codeOf(e) === 'UnexpectedResponse');
    }
  });

  test('the default transport uses the global fetch', async () => {
    const guard = installNetworkGuard();
    try {
      const transport = createFetchTransport();
      await expect(
        transport.request({ method: 'GET', url: 'https://compass.invalid/x', headers: {} }),
      ).rejects.toSatisfy((e) => codeOf(e) === 'Network');
      expect(guard.attempts).toEqual(['fetch']);
    } finally {
      guard.restore();
    }
  });
});

describe('node app file system', () => {
  let temp: string;
  const fs = createNodeAppFileSystem();

  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'compass-appfs-'));
  });
  afterAll(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  test('creates folders, writes, reads, renames, removes and reports modification times', async () => {
    const dir = join(temp, 'a', 'b');
    await fs.ensureDir(dir, 0o700);
    const file = join(dir, 'one.txt');
    expect(await fs.readFile(file)).toBeUndefined();
    expect(await fs.mtimeMs(file)).toBeUndefined();
    await fs.writeFile(file, 'first', 0o600);
    await fs.writeFile(file, 'text', 0o600);
    expect(await fs.readFile(file)).toBe('text');
    expect(typeof (await fs.mtimeMs(file))).toBe('number');
    await fs.rename(file, join(dir, 'two.txt'));
    expect(await fs.readFile(join(dir, 'two.txt'))).toBe('text');
    await fs.remove(join(dir, 'two.txt'));
    await fs.remove(join(dir, 'two.txt'));
    expect(await fs.readFile(join(dir, 'two.txt'))).toBeUndefined();
  });

  test('createExclusive creates once and reports false when the file exists', async () => {
    const file = join(temp, 'lock.txt');
    expect(await fs.createExclusive(file, 'one', 0o600)).toBe(true);
    expect(await fs.createExclusive(file, 'two', 0o600)).toBe(false);
    expect(await fs.readFile(file)).toBe('one');
  });

  test('remove deletes a real folder with everything under it', async () => {
    const dir = join(temp, 'tree');
    await fs.ensureDir(join(dir, 'inner'), 0o700);
    await fs.writeFile(join(dir, 'inner', 'f.txt'), 'x', 0o600);
    await fs.remove(dir);
    expect(await fs.readFile(join(dir, 'inner', 'f.txt'))).toBeUndefined();
  });

  test('other read and stat errors are not swallowed', async () => {
    await expect(fs.readFile(temp)).rejects.toThrow();
    await expect(fs.mtimeMs(`${temp}${String.fromCharCode(0)}bad`)).rejects.toThrow();
    await expect(fs.remove(`${temp}${String.fromCharCode(0)}bad`)).rejects.toThrow();
    await expect(fs.createExclusive(join(temp, 'no-such-dir', 'f'), 'x', 0o600)).rejects.toThrow();
  });

  test.skipIf(process.platform === 'win32')(
    'files are 0o600 and folders 0o700 on POSIX',
    async () => {
      const dir = join(temp, 'modes');
      await fs.ensureDir(dir, 0o700);
      await fs.writeFile(join(dir, 'f'), 'x', 0o600);
      expect((await stat(join(dir, 'f'))).mode & 0o777).toBe(0o600);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    },
  );

  test('refuses a symbolic link for write, exclusive create and rename, and rethrows other probe errors', async () => {
    await mkdir(join(temp, 'link-case'), { recursive: true });
    await writeFile(join(temp, 'link-case', 'target.txt'), 'target');
    const linkPath = join(temp, 'link-case', 'link.txt');
    const reportsLink = createNodeAppFileSystem((path) =>
      Promise.resolve({ isSymbolicLink: () => path === linkPath, isDirectory: () => false }),
    );
    await expect(reportsLink.writeFile(linkPath, 'x', 0o600)).rejects.toSatisfy(
      (e) => codeOf(e) === 'UnsafePath',
    );
    await expect(reportsLink.createExclusive(linkPath, 'x', 0o600)).rejects.toSatisfy(
      (e) => codeOf(e) === 'UnsafePath',
    );
    await expect(reportsLink.rename(linkPath, join(temp, 'link-case', 'x'))).rejects.toSatisfy(
      (e) => codeOf(e) === 'UnsafePath',
    );
    await expect(
      reportsLink.rename(join(temp, 'link-case', 'target.txt'), linkPath),
    ).rejects.toSatisfy((e) => codeOf(e) === 'UnsafePath');
    expect(await readFile(join(temp, 'link-case', 'target.txt'), 'utf8')).toBe('target');
    const broken = createNodeAppFileSystem(() => Promise.reject(new Error('EIO')));
    await expect(broken.writeFile(join(temp, 'link-case', 'z'), 'x', 0o600)).rejects.toThrow('EIO');
  });

  test('remove unlinks a link and never follows it, even when it points at a folder', async () => {
    const victim = join(temp, 'victim');
    await mkdir(victim, { recursive: true });
    await writeFile(join(victim, 'keep.txt'), 'keep');
    const linkPath = join(temp, 'link-to-victim');
    await writeFile(linkPath, 'stand-in for a link');
    const reportsFolderLink = createNodeAppFileSystem(() =>
      Promise.resolve({ isSymbolicLink: () => true, isDirectory: () => true }),
    );
    await reportsFolderLink.remove(linkPath);
    expect(await fs.readFile(linkPath)).toBeUndefined();
    expect(await readFile(join(victim, 'keep.txt'), 'utf8')).toBe('keep');
  });
});
