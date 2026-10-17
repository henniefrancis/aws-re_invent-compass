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
    });
    expect(response.status).toBe(200);
    expect([...response.body]).toEqual([1, 2, 3]);
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
        } as unknown as Response),
      timeoutMs: 1000,
    });
    await expect(
      brokenBody.request({ method: 'GET', url: 'https://compass.invalid/x', headers: {} }),
    ).rejects.toSatisfy((e) => codeOf(e) === 'Network');
  });

  test('a response over the size cap is refused', async () => {
    const { fn } = recordingFetch(() => new Response(new Uint8Array(MAX_RESPONSE_BYTES + 1)));
    const transport = createFetchTransport({ fetch: fn, timeoutMs: 1000 });
    await expect(
      transport.request({ method: 'GET', url: 'https://compass.invalid/x', headers: {} }),
    ).rejects.toSatisfy((e) => codeOf(e) === 'UnexpectedResponse');
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

  test('creates directories, writes, reads, renames, removes and reports existence', async () => {
    const dir = join(temp, 'a', 'b');
    await fs.ensureDir(dir, 0o700);
    const file = join(dir, 'one.bin');
    expect(await fs.exists(file)).toBe(false);
    expect(await fs.readFile(file)).toBeUndefined();
    await fs.writeFile(file, new Uint8Array([1, 2, 3]));
    await fs.writeFile(file, 'text');
    expect(new TextDecoder().decode(await fs.readFile(file))).toBe('text');
    await fs.createExclusive(join(dir, 'two.txt'), 'x');
    await expect(fs.createExclusive(join(dir, 'two.txt'), 'y')).rejects.toThrow();
    await fs.rename(join(dir, 'two.txt'), join(dir, 'three.txt'));
    expect(await fs.exists(join(dir, 'three.txt'))).toBe(true);
    await fs.remove(join(dir, 'three.txt'));
    await fs.remove(join(dir, 'three.txt'));
    expect(await fs.exists(join(dir, 'three.txt'))).toBe(false);
  });

  test('other read errors are not swallowed', async () => {
    await expect(fs.readFile(temp)).rejects.toThrow();
  });

  test.skipIf(process.platform === 'win32')(
    'files are 0o600 and directories 0o700 on POSIX',
    async () => {
      const dir = join(temp, 'modes');
      await fs.ensureDir(dir, 0o700);
      await fs.writeFile(join(dir, 'f'), 'x');
      expect((await stat(join(dir, 'f'))).mode & 0o777).toBe(0o600);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    },
  );

  test('refuses a symbolic link for write, exclusive create and rename, and rethrows other probe errors', async () => {
    await mkdir(join(temp, 'link-case'), { recursive: true });
    await writeFile(join(temp, 'link-case', 'target.txt'), 'target');
    const linkPath = join(temp, 'link-case', 'link.txt');
    const reportsLink = createNodeAppFileSystem((path) =>
      Promise.resolve({ isSymbolicLink: () => path === linkPath }),
    );
    await expect(reportsLink.writeFile(linkPath, 'x')).rejects.toSatisfy(
      (e) => codeOf(e) === 'UnsafePath',
    );
    await expect(reportsLink.createExclusive(linkPath, 'x')).rejects.toSatisfy(
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
    await expect(broken.writeFile(join(temp, 'link-case', 'z'), 'x')).rejects.toThrow('EIO');
  });
});
