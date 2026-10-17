// Loopback server and port binding (events-client, S1, task 9.3, hardened by
// security findings M1 and L2).
//
// Sign-in redirects the browser to http://localhost:<port>/callback. This module
// binds the callback server and handles that one redirect.
//
// Port selection (Requirements 1.1 to 1.3): the ports 8484 to 8489 are tried in
// ascending order. A port is usable only if 127.0.0.1:P binds AND [::1]:P either
// binds or is unsupported on this machine (EADDRNOTAVAIL or EAFNOSUPPORT). When IPv6
// is supported, a second listener is kept open on [::1]:P (L2) so no other local
// process can take ::1 afterwards and receive a redirect meant for us.
//
// Request handling (Requirements 1.4 to 1.6, M1). A web page can make the browser
// send a request to localhost, so a request must not be able to use up the single
// callback slot. A request is handled as the callback only if all of these hold:
//   - the method is GET and the path is /callback,
//   - the Host header is localhost:<port> or 127.0.0.1:<port> (else 404, which also
//     defeats DNS rebinding),
//   - the state parameter equals the expected state, compared in constant time over
//     equal-length buffers.
// A request with a missing or wrong state gets a 400 page and the server keeps
// listening, until the third such request, which rejects the attempt with
// StateMismatchError. Only a matching state consumes the slot; then exactly one request is
// handled, answered with a completion page, and the server shuts down. A matching
// state with an error parameter rejects at once. The sign-in timeout starts when the
// port is bound, so a started sign-in that is never completed cannot hold the port
// forever. The HTTP server is created with header size and timeout limits, and all
// connections are closed on shutdown.
//
// The server factory is injected so port selection is testable without real sockets.
// Neither the code, the state nor any query value is ever logged or placed in an
// error message.

import { timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import {
  CallbackError,
  NoLoopbackPortError,
  SignInTimeoutError,
  StateMismatchError,
} from './errors.js';

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

/** After this many wrong-state callbacks the sign-in is rejected (Requirement 1.13). */
export const MAX_WRONG_STATE_CALLBACKS = 3;

/** HTTP server limits for the callback listener. */
export const MAX_HEADER_SIZE_BYTES = 8192;
export const HEADERS_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 10_000;

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
  /** Resolve on the one valid callback, reject on a redirect error or the timeout. */
  awaitCallback(): Promise<LoopbackResult>;
  /** Shut the server down. Safe to call more than once. */
  close(): void;
}

/** The part of an incoming request the handler reads. */
export interface RequestLike {
  url?: string;
  method?: string;
  headers: { host?: string | undefined };
}

/** The part of a response the handler writes. */
export interface ResponseLike {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body: string, onFinished?: () => void): unknown;
}

/** An HTTP request handler. */
export type RequestHandler = (req: RequestLike, res: ResponseLike) => void;

/** The part of a node:http server this module drives. */
export interface ServerLike {
  once(event: 'error', listener: (error: { code?: string }) => void): unknown;
  listen(port: number, host: string, listener: () => void): unknown;
  close(): unknown;
  closeAllConnections(): void;
  address(): { port: number } | string | null;
}

/** Injectable server factory. The default uses node:http with hardened limits. */
export interface LoopbackDeps {
  /** Create an HTTP server that routes every request to the handler. */
  createServer: (handler: RequestHandler) => ServerLike;
}

/** The default factory over node:http with header size and timeout limits. */
export const defaultLoopbackDeps: LoopbackDeps = {
  createServer: (handler) =>
    createHttpServer(
      {
        maxHeaderSize: MAX_HEADER_SIZE_BYTES,
        headersTimeout: HEADERS_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
      },
      handler,
    ),
};

/** Per-bind options. */
export interface BindOptions {
  /** The state this attempt generated. Only a callback carrying it is accepted. */
  expectedState: string;
  /** Shut down and fail with a timeout this long after the port is bound. */
  timeoutMs: number;
}

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

/** Constant-time state comparison; unequal lengths never match. */
function stateMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when the Host header names this listener (localhost or 127.0.0.1 and the port). */
function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) {
    return false;
  }
  const lower = host.toLowerCase();
  return lower === `localhost:${String(port)}` || lower === `${LOOPBACK_V4}:${String(port)}`;
}

/** Parse a request target, returning undefined for anything that is not a valid URL. */
function parseRequestUrl(target: string | undefined): URL | undefined {
  try {
    return new URL(target ?? '/', 'http://localhost');
  } catch {
    return undefined;
  }
}

function respond(
  res: ResponseLike,
  status: number,
  body: string,
  type = 'text/plain',
  onFinished?: () => void,
): void {
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Length': String(Buffer.byteLength(body)),
    Connection: 'close',
    'Cache-Control': 'no-store',
  });
  res.end(body, onFinished);
}

/** Start a loopback server on the lowest usable port in `ports`. */
export async function bindLoopback(
  ports: readonly number[],
  deps: LoopbackDeps,
  options: BindOptions,
): Promise<LoopbackServer> {
  for (const candidate of ports) {
    // Each attempt gets its own state so a failed attempt leaves nothing behind.
    const servers: ServerLike[] = [];
    let closed = false;
    let handled = false;
    let wrongState = 0;
    let boundPort = candidate;
    const timers: { handle?: ReturnType<typeof setTimeout> } = {};
    let settle: { resolve: (r: LoopbackResult) => void; reject: (e: Error) => void };
    const outcomePromise = new Promise<LoopbackResult>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // A rejection with nobody awaiting yet must not become an unhandled rejection.
    outcomePromise.catch(() => undefined);

    const shutdown = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearTimeout(timers.handle);
      for (const server of servers) {
        server.close();
        server.closeAllConnections();
      }
    };

    const handler: RequestHandler = (req, res) => {
      const url = parseRequestUrl(req.url);
      if (
        handled ||
        url === undefined ||
        url.pathname !== CALLBACK_PATH ||
        req.method !== 'GET' ||
        !hostAllowed(req.headers.host, boundPort)
      ) {
        respond(res, 404, NOT_FOUND_PAGE);
        return;
      }
      const state = readParam(url.searchParams, 'state');
      if (state === undefined || !stateMatches(options.expectedState, state)) {
        // Not our redirect: answer it, keep the slot and keep listening. Only after
        // MAX_WRONG_STATE_CALLBACKS of them is the attempt rejected as a state mismatch.
        wrongState += 1;
        if (wrongState >= MAX_WRONG_STATE_CALLBACKS) {
          handled = true;
          respond(res, 400, FAILED_PAGE, 'text/html', shutdown);
          settle.reject(new StateMismatchError());
        } else {
          respond(res, 400, FAILED_PAGE, 'text/html');
        }
        return;
      }
      handled = true;
      const errorParam = url.searchParams.get('error');
      const code = readParam(url.searchParams, 'code');
      if (errorParam !== null) {
        respond(res, 400, FAILED_PAGE, 'text/html', shutdown);
        settle.reject(new CallbackError(safeErrorCode(errorParam)));
      } else if (code === undefined) {
        respond(res, 400, FAILED_PAGE, 'text/html', shutdown);
        settle.reject(new CallbackError('invalid_callback'));
      } else {
        respond(res, 200, COMPLETE_PAGE, 'text/html', shutdown);
        settle.resolve({ code, state, port: boundPort });
      }
    };

    const v4Server = deps.createServer(handler);
    servers.push(v4Server);
    const v4 = await tryListen(v4Server, candidate, LOOPBACK_V4);
    if (!v4.bound) {
      continue;
    }
    boundPort = v4.port;

    // Hold ::1 too when it exists, so nothing else can take it after us (L2). Any
    // failure other than "IPv6 loopback not supported" means something else owns it.
    const v6Server = deps.createServer(handler);
    const v6 = await tryListen(v6Server, boundPort, LOOPBACK_V6);
    if (v6.bound) {
      servers.push(v6Server);
    } else if (v6.code === undefined || !UNSUPPORTED_CODES.has(v6.code)) {
      shutdown();
      continue;
    }

    timers.handle = setTimeout(() => {
      shutdown();
      settle.reject(new SignInTimeoutError());
    }, options.timeoutMs);

    return {
      port: boundPort,
      awaitCallback: () => outcomePromise,
      close: shutdown,
    };
  }
  throw new NoLoopbackPortError();
}
