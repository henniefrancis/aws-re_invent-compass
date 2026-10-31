// Static_Server (showcase-site, Component 19).
//
// Serves the built site for the Playwright suite and nothing else. It mirrors what S6 builds in
// front of the private S3 origin: an extensionless path such as /demo is served from
// /demo/index.html (the CloudFront directory rewrite), and an unknown path answers 403 (S3
// through CloudFront). Every response carries the Required_CSP, so the browser tests run
// every flow under it.
//
// Run from site/ after the build:  node scripts/serve-static.mjs [port]
// The port defaults to 4173. It binds to 127.0.0.1 only.

import { createServer } from 'node:http';
import { readFile as readFileFs } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { maybeRunCli } from './cli.mjs';
import { REQUIRED_PERMISSIONS_POLICY } from './required-permissions-policy.mjs';
import { LOCAL_CSP, REQUIRED_CSP } from './required-csp.mjs';

export { LOCAL_CSP, REQUIRED_CSP, REQUIRED_PERMISSIONS_POLICY };

export const DEFAULT_PORT = 4173;
export const HOST = '127.0.0.1';

/**
 * Response headers on every answer. The policy is the Required_CSP without
 * upgrade-insecure-requests, because this server speaks plain http (see required-csp.mjs).
 */
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': LOCAL_CSP,
  'Permissions-Policy': REQUIRED_PERMISSIONS_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
});

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
});

/** The content type of a file, by its extension. */
export function contentType(file) {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Map a request URL to a file path inside the site folder, or refuse it.
 * '/' is index.html, an extensionless path is its index.html, and anything that tries to leave
 * the folder is refused.
 *
 * @param {string} urlPath the request URL (path, query and hash)
 * @returns {{ ok: true, path: string } | { ok: false }}
 */
export function resolveSitePath(urlPath) {
  const bare = urlPath.split('#')[0].split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return { ok: false };
  }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) {
    return { ok: false };
  }
  const segments = decoded.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return { ok: false };
  }
  const last = segments.at(-1) ?? '';
  const path = last.includes('.') ? segments.join('/') : [...segments, 'index.html'].join('/');
  return { ok: true, path };
}

/**
 * The HTTP server. `readFile` is injected, so the server can be tested with no disk.
 *
 * @param {{ root: string, readFile: (absolutePath: string) => Promise<Uint8Array> }} deps
 */
export function createStaticServer({ root, readFile }) {
  const base = resolve(root);
  return createServer((request, response) => {
    const send = (status, body, type) => {
      response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
      response.end(body);
    };
    const target = resolveSitePath(String(request.url));
    const absolute = target.ok ? normalize(join(base, target.path)) : '';
    if (request.method !== 'GET' || !target.ok || !absolute.startsWith(base + sep)) {
      send(403, 'Forbidden', 'text/plain; charset=utf-8');
      return;
    }
    readFile(absolute).then(
      (body) => {
        send(200, body, contentType(absolute));
      },
      () => {
        send(403, 'Forbidden', 'text/plain; charset=utf-8');
      },
    );
  });
}

/**
 * Start the server on a port and resolve when it is listening.
 *
 * @param {{ root: string, port: number, readFile?: (p: string) => Promise<Uint8Array> }} options
 * @returns {Promise<{ server: import('node:http').Server, port: number }>}
 */
export function startServer({ root, port, readFile = (path) => readFileFs(path) }) {
  const server = createStaticServer({ root, readFile });
  return new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      resolveListening({
        server,
        port: /** @type {import('node:net').AddressInfo} */ (server.address()).port,
      });
    });
  });
}

const DEFAULT_ROOT = join(import.meta.dirname, '..', 'dist', 'site', 'browser');

/** The command line entry: serve the build output and report the address. */
export async function runServerCli({ argv = process.argv, start = startServer } = {}) {
  const started = await start({ root: DEFAULT_ROOT, port: Number(argv[2] ?? DEFAULT_PORT) });
  return {
    code: 0,
    stdout: `serving ${DEFAULT_ROOT} at http://${HOST}:${String(started.port)}${String.fromCharCode(10)}`,
    stderr: '',
  };
}

await maybeRunCli({ runCli: runServerCli, argv1: process.argv[1], metaUrl: import.meta.url });
