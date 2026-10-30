import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, test } from 'vitest';
import { REQUIRED_CSP as CSP_FROM_SOURCE } from '../../scripts/required-csp.mjs';
import {
  DEFAULT_PORT,
  HOST,
  LOCAL_CSP,
  REQUIRED_CSP,
  REQUIRED_PERMISSIONS_POLICY,
  SECURITY_HEADERS,
  contentType,
  createStaticServer,
  resolveSitePath,
  runServerCli,
  startServer,
} from '../../scripts/serve-static.mjs';

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

async function serve(files: Record<string, string>) {
  const server = createStaticServer({
    root: join(tmpdir(), 'site-root'),
    readFile: (path) => {
      const name = path
        .slice(join(tmpdir(), 'site-root').length + 1)
        .split('\\')
        .join('/');
      const body = files[name];
      return body === undefined
        ? Promise.reject(new Error('missing'))
        : Promise.resolve(new TextEncoder().encode(body));
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, HOST, resolve);
  });
  const address = server.address() as { port: number };
  return (path: string, init?: RequestInit) =>
    fetch(`http://${HOST}:${String(address.port)}${path}`, init);
}

describe('the Required_CSP', () => {
  test('is the policy of the requirements, with base-uri self for the base element', () => {
    expect(REQUIRED_CSP).toBe(CSP_FROM_SOURCE);
    expect(REQUIRED_CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests",
    );
    expect(REQUIRED_CSP).not.toContain('unsafe');
  });

  test('the local server sends it without upgrade-insecure-requests, and only without that', () => {
    expect(LOCAL_CSP).not.toContain('upgrade-insecure-requests');
    expect(`${LOCAL_CSP}; upgrade-insecure-requests`).toBe(REQUIRED_CSP);
  });

  test('every response header set carries it with nosniff and no referrer', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).toBe(LOCAL_CSP);
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer');
  });
});

describe('the Permissions-Policy', () => {
  test('lets only the site itself use the location and switches the rest off', () => {
    expect(REQUIRED_PERMISSIONS_POLICY).toBe(
      'accelerometer=(), camera=(), geolocation=(self), gyroscope=(), microphone=(), payment=(), usb=()',
    );
    expect(REQUIRED_PERMISSIONS_POLICY).not.toContain('*');
    expect(SECURITY_HEADERS['Permissions-Policy']).toBe(REQUIRED_PERMISSIONS_POLICY);
  });
});

describe('resolveSitePath', () => {
  test('maps the root, extensionless paths and files', () => {
    expect(resolveSitePath('/')).toEqual({ ok: true, path: 'index.html' });
    expect(resolveSitePath('/demo')).toEqual({ ok: true, path: 'demo/index.html' });
    expect(resolveSitePath('/demo/')).toEqual({ ok: true, path: 'demo/index.html' });
    expect(resolveSitePath('/board?x=1#h=abc')).toEqual({ ok: true, path: 'board/index.html' });
    expect(resolveSitePath('/main-ABC.js')).toEqual({ ok: true, path: 'main-ABC.js' });
    expect(resolveSitePath('/artwork/favicon.svg')).toEqual({
      ok: true,
      path: 'artwork/favicon.svg',
    });
  });

  test('refuses traversal, bad encoding, backslashes, NUL and relative paths', () => {
    for (const url of [
      '/../secret',
      '/a/../../b',
      '/%2e%2e/secret',
      '/a/./b',
      '/%E0%A4%A',
      '/a\\b',
      '/a%00b',
      'no-slash',
    ]) {
      expect(resolveSitePath(url), url).toEqual({ ok: false });
    }
  });

  test('never returns a path that leaves the folder', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (url) => {
        const result = resolveSitePath(`/${url}`);
        if (result.ok) {
          expect(result.path.split('/')).not.toContain('..');
          expect(result.path.startsWith('/')).toBe(false);
          expect(result.path).not.toContain('\\');
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('contentType', () => {
  test('knows the site file types and falls back to bytes', () => {
    expect(contentType('index.html')).toBe('text/html; charset=utf-8');
    expect(contentType('a.JS')).toBe('text/javascript; charset=utf-8');
    expect(contentType('a.css')).toBe('text/css; charset=utf-8');
    expect(contentType('a.svg')).toBe('image/svg+xml');
    expect(contentType('a.ico')).toBe('image/x-icon');
    expect(contentType('a.webp')).toBe('image/webp');
    expect(contentType('pass-background.jpg')).toBe('image/jpeg');
    expect(contentType('a.json')).toBe('application/json; charset=utf-8');
    expect(contentType('a.txt')).toBe('text/plain; charset=utf-8');
    expect(contentType('a.bin')).toBe('application/octet-stream');
  });
});

describe('the server', () => {
  test('serves files, rewrites directories and sends the headers every time', async () => {
    const get = await serve({
      'index.html': '<h1>Home</h1>',
      'demo/index.html': '<h1>Demo</h1>',
      'main.js': 'x',
    });
    const home = await get('/');
    expect(home.status).toBe(200);
    expect(await home.text()).toBe('<h1>Home</h1>');
    expect(home.headers.get('content-security-policy')).toBe(LOCAL_CSP);
    expect(home.headers.get('x-content-type-options')).toBe('nosniff');
    expect(home.headers.get('referrer-policy')).toBe('no-referrer');
    expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await (await get('/demo')).text()).toBe('<h1>Demo</h1>');
    expect((await get('/main.js')).headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
  });

  test('answers 403 for an unknown path, a refused path and any method but GET', async () => {
    const get = await serve({ 'index.html': 'x' });
    const unknown = await get('/nope');
    expect(unknown.status).toBe(403);
    expect(unknown.headers.get('content-security-policy')).toBe(LOCAL_CSP);
    expect((await get('/api/v1/handoffs/abc')).status).toBe(403);
    expect((await get('/%2e%2e/x')).status).toBe(403);
    expect((await get('/', { method: 'POST', body: 'x' })).status).toBe(403);
  });
});

describe('raw requests that a browser would normalise away', () => {
  test('a path that climbs out of the folder answers 403', async () => {
    const real = await startServer({ root: tmpdir(), port: 0 });
    servers.push(real.server);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: HOST, port: real.port, path: '/../../etc/passwd' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});

describe('startServer and the command line', () => {
  test('listens on the given port with the default disk reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'site-serve-'));
    try {
      await mkdir(join(root, 'demo'), { recursive: true });
      await writeFile(join(root, 'demo', 'index.html'), 'on disk', 'utf8');
      const { server, port } = await startServer({ root, port: 0 });
      servers.push(server);
      expect(port).toBeGreaterThan(0);
      expect(await (await fetch(`http://${HOST}:${String(port)}/demo`)).text()).toBe('on disk');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects when the port is taken', async () => {
    const first = await startServer({ root: tmpdir(), port: 0 });
    servers.push(first.server);
    await expect(startServer({ root: tmpdir(), port: first.port })).rejects.toThrow();
  });

  test('the command line reads the port from argv, and defaults to 4173', async () => {
    const seen: number[] = [];
    const start = (options: { port: number }) => {
      seen.push(options.port);
      return Promise.resolve({ server: undefined as never, port: options.port });
    };
    const withPort = await runServerCli({ argv: ['node', 'serve', '8123'], start });
    expect(withPort.code).toBe(0);
    expect(withPort.stdout).toContain(`http://${HOST}:8123`);
    await runServerCli({ argv: ['node', 'serve'], start });
    expect(seen).toEqual([8123, DEFAULT_PORT]);
    expect(DEFAULT_PORT).toBe(4173);
  });

  test('the command line starts a real server on the first argument', async () => {
    const real = await startServer({ root: tmpdir(), port: 0 });
    servers.push(real.server);
    const result = await runServerCli({
      argv: ['node', 'serve', '0'],
      start: async (options: { root: string; port: number }) => {
        const started = await startServer(options);
        servers.push(started.server);
        return started;
      },
    });
    expect(result.stdout).toContain(`http://${HOST}:`);
  });
});
