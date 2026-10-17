// Loopback server and port binding (events-client, S1, task 9.3).
//
// Sign-in redirects the browser to http://localhost:<port>/callback. This module
// binds the callback server on 127.0.0.1 and handles that one redirect.
//
// Port selection (Requirements 1.1 to 1.3): the ports 8484 to 8489 are tried in
// ascending order. A port is usable only if 127.0.0.1:P binds AND [::1]:P either
// binds or is unsupported on this machine (EADDRNOTAVAIL or EAFNOSUPPORT). The IPv6
// check matters because a browser may resolve "localhost" to ::1, where another
// process could be listening and would receive the authorization code instead.
// The ::1 probe socket is released straight away; the real server stays on 127.0.0.1.
//
// Request handling (Requirements 1.4 to 1.6): exactly one /callback request is
// handled, answered with a browser-visible completion page, and then the server
// shuts down. Any other path gets a 404 and the server stays up. A callback that
// carries an error is rejected at once. If nothing arrives before the timeout, the
// server is shut down and a timeout error is raised.
//
// The server and probe factories are injected so port selection is testable without
// real sockets; the defaults use node:http and node:net. Neither the code, the state
// nor any query value is ever logged or placed in an error message.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { CallbackError, NoLoopbackPortError, SignInTimeoutError } from './errors.js';

/** The ports tried, in order, for the loopback redirect (Requirement 1.2). */
export const LOOPBACK_PORTS: readonly number[] = [8484, 8485, 8486, 8487, 8488, 8489];

/** The only path the redirect is accepted on. */
export const CALLBACK_PATH = '/callback';

const LOOPBACK_V4 = '127.0.0.1';
const LOOPBACK_V6 = '::1';
/** Error codes that mean "this address family cannot be used here". */
const UNSUPPORTED_CODES: ReadonlySet<string> = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);
/** The longest code or state value accepted from the redirect. */
const MAX_PARAM_LENGTH = 2048;
const COMPLETE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Signed in</title>' +
  '<p>Sign-in is complete. You can close this tab and return to your editor.</p>';
const FAILED_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Sign-in not completed</title>' +
  '<p>Sign-in was not completed. You can close this tab and try again.</p>';
const NOT_FOUND_PAGE = 'Not found';

/** What a successful redirect yields. */
export interface LoopbackResult {
  code: string;
  state: string;
  port: number;
}

/** A bound loopback server waiting for the single redirect. */
export interface LoopbackServer {
  /** The port actually bound. */
  readonly port: number;
  /** Resolve on the one /callback request, reject on error or timeout. Shuts down. */
  awaitCallback(timeoutMs: number): Promise<LoopbackResult>;
  /** Shut the server down. Safe to call more than once. */
  close(): void;
}

/** The part of an incoming request the handler reads. */
export interface RequestLike {
  url?: string;
  method?: string;
}

/** The part of a response the handler writes. */
export interface ResponseLike {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body: string): unknown;
}

/** An HTTP request handler. */
export type RequestHandler = (req: RequestLike, res: ResponseLike) => void;

/** The part of a node:net or node:http server this module drives. */
export interface ServerLike {
  once(event: 'error', listener: (error: { code?: string }) => void): unknown;
  listen(port: number, host: string, listener: () => void): unknown;
  close(): unknown;
  address(): { port: number } | string | null;
}

/** Injectable server factories. Defaults use node:http and node:net. */
export interface LoopbackDeps {
  /** Create the HTTP server that receives the redirect. */
  createServer: (handler: RequestHandler) => ServerLike;
  /** Create a bare socket server used only to probe whether [::1]:P can be bound. */
  createProbeServer: () => ServerLike;
}

/** The default factories over node:http and node:net. */
export const defaultLoopbackDeps: LoopbackDeps = {
  createServer: (handler) => createHttpServer(handler),
  createProbeServer: () => createNetServer(),
};

/** The outcome of one listen attempt: bound, or the failing error code. */
type ListenOutcome = { bound: true; port: number } | { bound: false; code: string | undefined };

/** Try to listen on host:port, resolving with the outcome instead of throwing. */
function tryListen(server: ServerLike, port: number, host: string): Promise<ListenOutcome> {
  return new Promise((resolve) => {
    server.once('error', (error) => {
      resolve({ bound: false, code: error.code });
    });
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        bound: true,
        port: typeof address === 'object' && address !== null ? address.port : port,
      });
    });
  });
}

/**
 * True when [::1]:port is usable for our purposes: it binds (nothing else holds it)
 * or the machine has no IPv6 loopback. Any other failure means something else holds
 * the port, so it is treated as taken.
 */
async function ipv6Usable(deps: LoopbackDeps, port: number): Promise<boolean> {
  const probe = deps.createProbeServer();
  const outcome = await tryListen(probe, port, LOOPBACK_V6);
  if (outcome.bound) {
    probe.close();
    return true;
  }
  return outcome.code !== undefined && UNSUPPORTED_CODES.has(outcome.code);
}

/** Read one query value, rejecting missing, empty or oversized values. */
function readParam(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name);
  if (value === null || value.length === 0 || value.length > MAX_PARAM_LENGTH) {
    return undefined;
  }
  return value;
}

/** A redirect error code is kept only if it is a short lower-case OAuth code. */
function safeErrorCode(raw: string | null): string {
  return raw !== null && /^[a-z_]{1,40}$/.test(raw) ? raw : 'unknown_error';
}

/** Parse a request target, returning undefined for anything that is not a valid URL. */
function parseRequestUrl(target: string | undefined): URL | undefined {
  try {
    return new URL(target ?? '/', 'http://localhost');
  } catch {
    return undefined;
  }
}

function respond(res: ResponseLike, status: number, body: string, type = 'text/plain'): void {
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Length': String(Buffer.byteLength(body)),
    Connection: 'close',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** Start a loopback server on the lowest usable port in `ports`. */
export async function bindLoopback(
  ports: readonly number[] = LOOPBACK_PORTS,
  deps: LoopbackDeps = defaultLoopbackDeps,
): Promise<LoopbackServer> {
  for (const candidate of ports) {
    // Each attempt gets its own state so a failed attempt leaves nothing behind.
    let closed = false;
    let handled = false;
    let settle: { resolve: (r: LoopbackResult) => void; reject: (e: Error) => void };
    let boundPort = candidate;
    const outcomePromise = new Promise<LoopbackResult>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // A rejection with nobody awaiting yet must not become an unhandled rejection.
    outcomePromise.catch(() => undefined);

    const server = deps.createServer((req, res) => {
      const url = parseRequestUrl(req.url);
      if (handled || url === undefined || url.pathname !== CALLBACK_PATH || req.method !== 'GET') {
        respond(res, 404, NOT_FOUND_PAGE);
        return;
      }
      handled = true;
      const errorParam = url.searchParams.get('error');
      const code = readParam(url.searchParams, 'code');
      const state = readParam(url.searchParams, 'state');
      if (errorParam !== null) {
        respond(res, 400, FAILED_PAGE, 'text/html');
        shutdown();
        settle.reject(new CallbackError(safeErrorCode(errorParam)));
      } else if (code === undefined || state === undefined) {
        respond(res, 400, FAILED_PAGE, 'text/html');
        shutdown();
        settle.reject(new CallbackError('invalid_callback'));
      } else {
        respond(res, 200, COMPLETE_PAGE, 'text/html');
        shutdown();
        settle.resolve({ code, state, port: boundPort });
      }
    });

    function shutdown(): void {
      if (!closed) {
        closed = true;
        server.close();
      }
    }

    const v4 = await tryListen(server, candidate, LOOPBACK_V4);
    if (!v4.bound) {
      continue;
    }
    boundPort = v4.port;
    if (!(await ipv6Usable(deps, boundPort))) {
      shutdown();
      continue;
    }

    return {
      port: boundPort,
      awaitCallback(timeoutMs: number): Promise<LoopbackResult> {
        return new Promise<LoopbackResult>((resolve, reject) => {
          const timer = setTimeout(() => {
            shutdown();
            reject(new SignInTimeoutError());
          }, timeoutMs);
          outcomePromise
            .finally(() => {
              clearTimeout(timer);
            })
            .then(resolve, reject);
        });
      },
      close: shutdown,
    };
  }
  throw new NoLoopbackPortError();
}
