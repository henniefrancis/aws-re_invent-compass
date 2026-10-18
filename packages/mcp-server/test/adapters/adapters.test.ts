import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
          body: { getReader: () => ({ read: () => Promise.reject(new Error('x')) }) },
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

  test('the body is read as a stream and the request is aborted at the byte cap (security L5)', async () => {
    let pulls = 0;
    let signal: AbortSignal | undefined;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const transport = createFetchTransport({
      fetch: (_url, init) => {
        signal = init?.signal ?? undefined;
        return Promise.resolve(new Response(endless));
      },
      timeoutMs: 5000,
    });
    const error: unknown = await transport
      .request({ method: 'GET', url: 'https://compass.invalid/x', headers: {} })
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('UnexpectedResponse');
    expect(signal?.aborted).toBe(true);
    // 10 MiB is the cap and the stream is endless: it was cancelled right after, not read on.
    expect(pulls).toBeLessThanOrEqual(13);
  });

  test('a declared length over the cap is refused before any byte is read', async () => {
    const transport = createFetchTransport({
      fetch: () =>
        Promise.resolve({
          status: 200,
          headers: new Headers({ 'content-length': String(MAX_RESPONSE_BYTES + 1) }),
          // Reading would be a Network error, so an UnexpectedResponse proves nothing was read.
          body: {
            getReader: () => {
              throw new Error('the body must not be read');
            },
          },
        } as unknown as Response),
      timeoutMs: 5000,
    });
    await expect(
      transport.request({ method: 'GET', url: 'https://compass.invalid/x', headers: {} }),
    ).rejects.toMatchObject({ code: 'UnexpectedResponse' });
  });

  test('a body that cannot be cancelled after the cap is still an oversize response', async () => {
    const transport = createFetchTransport({
      fetch: () =>
        Promise.resolve({
          status: 200,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: () =>
                Promise.resolve({ done: false, value: new Uint8Array(MAX_RESPONSE_BYTES + 1) }),
              cancel: () => Promise.reject(new Error('already closed')),
            }),
          },
        } as unknown as Response),
      timeoutMs: 5000,
    });
    await expect(
      transport.request({ method: 'GET', url: 'https://compass.invalid/x', headers: {} }),
    ).rejects.toMatchObject({ code: 'UnexpectedResponse' });
  });

  test('a response with no body is an empty one, and text and bytes are read in chunks', async () => {
    const empty = createFetchTransport({
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
      timeoutMs: 5000,
    });
    expect(
      await empty.request({ method: 'DELETE', url: 'https://compass.invalid/x', headers: {} }),
    ).toMatchObject({ status: 204, body: '' });
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hel'));
        controller.enqueue(new TextEncoder().encode('lo'));
        controller.close();
      },
    });
    const transport = createFetchTransport({
      fetch: () => Promise.resolve(new Response(chunked)),
      timeoutMs: 5000,
    });
    expect(
      await transport.request({ method: 'GET', url: 'https://compass.invalid/x', headers: {} }),
    ).toMatchObject({ body: 'hello' });
  });

  test('ensureDir refuses a link anywhere from the app folder down, but not above it (security L4)', async () => {
    const seen: string[] = [];
    const linkAt = (needle: string) =>
      createNodeAppFileSystem((path) => {
        seen.push(path);
        return Promise.resolve({
          isSymbolicLink: () => path.endsWith(needle),
          isDirectory: () => true,
        });
      });
    const root = join(temp, 'ensure', 'reinvent-compass', 'simulated', 'x');
    // A link at the app folder, in the middle, or at the end is refused, and nothing is created.
    for (const needle of ['reinvent-compass', 'simulated', 'x']) {
      seen.length = 0;
      await expect(linkAt(needle).ensureDir(root, 0o700), needle).rejects.toMatchObject({
        code: 'UnsafePath',
      });
      expect(await readdir(join(temp)).then((names) => names.includes('ensure'))).toBe(false);
    }
    // A link above the app folder (a user's own folder) is fine, and only the app folder and below are looked at.
    seen.length = 0;
    await linkAt('ensure').ensureDir(root, 0o700);
    expect(seen.every((path) => path.includes('reinvent-compass'))).toBe(true);
    expect(seen).toContain(root);
    expect((await stat(root)).isDirectory()).toBe(true);
  });

  test('ensureDir checks only the last component when the path has no app folder, and works with either separator', async () => {
    const seen: string[] = [];
    const recording = createNodeAppFileSystem((path) => {
      seen.push(path);
      return Promise.resolve({ isSymbolicLink: () => false, isDirectory: () => true });
    });
    const plain = join(temp, 'plain', 'folder');
    await recording.ensureDir(plain, 0o700);
    expect(seen).toEqual([plain, plain]);
    seen.length = 0;
    const win = createNodeAppFileSystem((path) => {
      seen.push(path);
      return Promise.reject(Object.assign(new Error('stop'), { code: 'EPERM' }));
    });
    await expect(
      win.ensureDir(String.raw`C:\Users\me\reinvent-compass\sub`, 0o700),
    ).rejects.toThrow('stop');
    expect(seen).toEqual([String.raw`C:\Users\me\reinvent-compass`]);
  });
});
