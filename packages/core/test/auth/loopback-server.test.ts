import { get, request, type Server } from 'node:http';
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  CALLBACK_PATH,
  HEADERS_TIMEOUT_MS,
  LOOPBACK_PORTS,
  MAX_HEADER_SIZE_BYTES,
  REQUEST_TIMEOUT_MS,
  bindLoopback,
  defaultLoopbackDeps,
  type BindOptions,
  type LoopbackDeps,
  type RequestHandler,
  type RequestLike,
  type ResponseLike,
  type ServerLike,
} from '../../src/auth/loopback-server.js';
import { CallbackError, NoLoopbackPortError, SignInTimeoutError } from '../../src/auth/errors.js';

// Tests for the loopback server (events-client, S1, tasks 9.3 to 9.5, plus the M1 and
// L2 hardening). Port selection (Property 2) runs against fake server factories keyed
// by port, so it never depends on ports 8484 to 8489 being free. The request-handling
// tests drive the handler directly through a fake factory, and a small set of
// real-socket tests bind 127.0.0.1 on port 0 only.

/** What a fake bind attempt does for one host and port. */
type FakeBind = 'ok' | 'EADDRINUSE' | 'EADDRNOTAVAIL' | 'EAFNOSUPPORT' | 'EACCES' | 'nocode';

const STATE = 'expected-state-value-123';
const OPTIONS: BindOptions = { expectedState: STATE, timeoutMs: 60_000 };

interface FakeWorld {
  deps: LoopbackDeps;
  servers: FakeServer[];
  handlers: RequestHandler[];
}

class FakeServer implements ServerLike {
  closeCount = 0;
  closeAllCount = 0;
  listenedHost: string | undefined;
  bound = false;
  private errorListener: ((error: { code?: string }) => void) | undefined;
  private port = 0;
  constructor(
    private readonly behave: (host: string, port: number) => FakeBind,
    private readonly addressOf: (port: number) => { port: number } | string | null,
  ) {}
  once(_event: 'error', listener: (error: { code?: string }) => void): void {
    this.errorListener = listener;
  }
  listen(port: number, host: string, listener: () => void): void {
    this.port = port;
    this.listenedHost = host;
    const outcome = this.behave(host, port);
    queueMicrotask(() => {
      if (outcome === 'ok') {
        this.bound = true;
        listener();
      } else {
        this.errorListener?.(outcome === 'nocode' ? {} : { code: outcome });
      }
    });
  }
  close(): void {
    this.closeCount += 1;
  }
  closeAllConnections(): void {
    this.closeAllCount += 1;
  }
  address(): { port: number } | string | null {
    return this.addressOf(this.port);
  }
}

function fakeWorld(
  behave: (host: string, port: number) => FakeBind,
  addressOf: (port: number) => { port: number } | string | null = (port) => ({ port }),
): FakeWorld {
  const world: FakeWorld = {
    servers: [],
    handlers: [],
    deps: {
      createServer: (handler) => {
        const server = new FakeServer(behave, addressOf);
        world.servers.push(server);
        world.handlers.push(handler);
        return server;
      },
    },
  };
  return world;
}

/** A recording fake response that reports it finished, as a real one does. */
function fakeRes(): ResponseLike & { status?: number; body?: string } {
  const res: ResponseLike & { status?: number; body?: string } = {
    writeHead(status) {
      res.status = status;
    },
    end(body, onFinished) {
      res.body = body;
      onFinished?.();
    },
  };
  return res;
}

function req(url: string | undefined, host: string | undefined, method = 'GET'): RequestLike {
  return { ...(url === undefined ? {} : { url }), method, headers: { host } };
}

const v4 = '127.0.0.1';

describe('Feature: events-client, Property 2: Loopback binds the lowest free port in range', () => {
  // Validates: Requirements 1.2, 1.3
  const v6Arb = fc.constantFrom<FakeBind>(
    'ok',
    'EADDRINUSE',
    'EADDRNOTAVAIL',
    'EAFNOSUPPORT',
    'EACCES',
    'nocode',
  );
  const v4Arb = fc.constantFrom<FakeBind>('ok', 'EADDRINUSE', 'EACCES');
  const stateArb = fc.record({ v4: v4Arb, v6: v6Arb });

  test('for any bindability pattern the smallest usable port wins, else no port is available', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stateArb, { minLength: 6, maxLength: 6 }), async (states) => {
        const world = fakeWorld((host, port) => {
          const state = states[LOOPBACK_PORTS.indexOf(port)];
          return host === v4 ? (state?.v4 ?? 'EADDRINUSE') : (state?.v6 ?? 'EADDRINUSE');
        });
        const usable = LOOPBACK_PORTS.filter((_, i) => {
          const s = states[i];
          return (
            s?.v4 === 'ok' && (s.v6 === 'ok' || s.v6 === 'EADDRNOTAVAIL' || s.v6 === 'EAFNOSUPPORT')
          );
        });
        if (usable.length === 0) {
          await expect(bindLoopback(LOOPBACK_PORTS, world.deps, OPTIONS)).rejects.toBeInstanceOf(
            NoLoopbackPortError,
          );
          // Every listener that was opened has been released.
          expect(world.servers.filter((s) => s.bound && s.closeCount === 0)).toHaveLength(0);
        } else {
          const server = await bindLoopback(LOOPBACK_PORTS, world.deps, OPTIONS);
          expect(server.port).toBe(usable[0]);
          const v6Held = states[LOOPBACK_PORTS.indexOf(usable[0] ?? 0)]?.v6 === 'ok';
          // The chosen listeners stay up: 127.0.0.1, plus [::1] when IPv6 exists.
          const open = world.servers.filter((s) => s.bound && s.closeCount === 0);
          expect(open.map((s) => s.listenedHost).sort()).toEqual(
            v6Held ? ['127.0.0.1', '::1'] : ['127.0.0.1'],
          );
          expect(world.servers.filter((s) => s.bound).length).toBeGreaterThanOrEqual(open.length);
          server.close();
          expect(world.servers.filter((s) => s.bound && s.closeCount === 0)).toHaveLength(0);
          expect(open.every((s) => s.closeAllCount === 1)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('when IPv6 is supported a second listener holds [::1] on the same port', async () => {
    const world = fakeWorld(() => 'ok');
    const server = await bindLoopback([8484], world.deps, OPTIONS);
    expect(world.servers.map((s) => s.listenedHost)).toEqual([v4, '::1']);
    server.close();
    expect(world.servers.map((s) => [s.closeCount, s.closeAllCount])).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  test('when IPv6 is unsupported only 127.0.0.1 is held', async () => {
    const world = fakeWorld((host) => (host === v4 ? 'ok' : 'EAFNOSUPPORT'));
    const server = await bindLoopback([8484], world.deps, OPTIONS);
    server.close();
    expect(world.servers[0]?.closeCount).toBe(1);
    expect(world.servers[1]?.closeCount).toBe(0);
  });

  test('a port whose [::1] side is taken is skipped and its 127.0.0.1 listener released', async () => {
    const world = fakeWorld((host, port) => (host !== v4 && port === 8484 ? 'EADDRINUSE' : 'ok'));
    const server = await bindLoopback(LOOPBACK_PORTS, world.deps, OPTIONS);
    expect(server.port).toBe(8485);
    expect(world.servers[0]?.closeCount).toBe(1);
    expect(world.servers[0]?.closeAllCount).toBe(1);
  });

  test('the ports are exactly 8484 to 8489 in ascending order', () => {
    expect(LOOPBACK_PORTS).toEqual([8484, 8485, 8486, 8487, 8488, 8489]);
  });

  test('the bound port falls back to the requested port when the address is not an object', async () => {
    const asString = fakeWorld(
      () => 'ok',
      () => 'pipe',
    );
    expect((await bindLoopback([9001], asString.deps, OPTIONS)).port).toBe(9001);
    const asNull = fakeWorld(
      () => 'ok',
      () => null,
    );
    expect((await bindLoopback([9002], asNull.deps, OPTIONS)).port).toBe(9002);
  });

  test('an empty port list has no port available', async () => {
    await expect(bindLoopback([], fakeWorld(() => 'ok').deps, OPTIONS)).rejects.toBeInstanceOf(
      NoLoopbackPortError,
    );
  });
});

describe('events-client, M1: only a matching state consumes the single callback slot', () => {
  const goodUrl = (extra = ''): string => `${CALLBACK_PATH}?code=abc&state=${STATE}${extra}`;
  const HOST = 'localhost:8484';

  async function bound(timeoutMs = 60_000): Promise<{
    world: FakeWorld;
    handler: RequestHandler;
    server: Awaited<ReturnType<typeof bindLoopback>>;
  }> {
    const world = fakeWorld(() => 'ok');
    const server = await bindLoopback([8484], world.deps, { expectedState: STATE, timeoutMs });
    const handler = world.handlers[0];
    if (handler === undefined) {
      throw new Error('no handler');
    }
    return { world, handler, server };
  }

  test('a valid callback resolves once, answers 200 and shuts everything down', async () => {
    const { world, handler, server } = await bound();
    const res = fakeRes();
    handler(req(goodUrl(), HOST), res);
    await expect(server.awaitCallback()).resolves.toEqual({
      code: 'abc',
      state: STATE,
      port: 8484,
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Sign-in is complete');
    expect(world.servers.every((s) => s.closeCount === 1 && s.closeAllCount === 1)).toBe(true);
  });

  test('any host spelling of localhost or 127.0.0.1 with the bound port is accepted', async () => {
    for (const host of ['localhost:8484', 'LOCALHOST:8484', '127.0.0.1:8484']) {
      const { handler, server } = await bound();
      handler(req(goodUrl(), host), fakeRes());
      await expect(server.awaitCallback()).resolves.toMatchObject({ code: 'abc' });
    }
  });

  test('a wrong, missing or oversized state is answered 400 and does not use up the slot', async () => {
    const { world, handler, server } = await bound();
    const badUrls = [
      `${CALLBACK_PATH}?code=abc&state=wrong`,
      `${CALLBACK_PATH}?code=abc`,
      `${CALLBACK_PATH}?code=abc&state=`,
      `${CALLBACK_PATH}?code=abc&state=${STATE}x`,
      `${CALLBACK_PATH}?code=abc&state=${STATE.slice(0, -1)}`,
      `${CALLBACK_PATH}?code=abc&state=${'s'.repeat(2049)}`,
      `${CALLBACK_PATH}?error=access_denied`,
      `${CALLBACK_PATH}?error=access_denied&state=nope`,
    ];
    for (const url of badUrls) {
      const res = fakeRes();
      handler(req(url, HOST), res);
      expect(res.status).toBe(400);
      expect(res.body).not.toContain('abc');
    }
    expect(world.servers.every((s) => s.closeCount === 0)).toBe(true);
    // The real redirect still completes afterwards, within the same timeout.
    handler(req(goodUrl(), HOST), fakeRes());
    await expect(server.awaitCallback()).resolves.toMatchObject({ code: 'abc' });
  });

  test('a wrong Host header, path, method, bad target or a second callback is a 404 and keeps the slot', async () => {
    const { world, handler, server } = await bound();
    const cases: RequestLike[] = [
      req(goodUrl(), 'evil.example:8484'),
      req(goodUrl(), 'localhost:9999'),
      req(goodUrl(), 'localhost'),
      req(goodUrl(), '127.0.0.1.evil.example:8484'),
      req(goodUrl(), undefined),
      req('/', HOST),
      req('/callback/extra', HOST),
      req(goodUrl(), HOST, 'POST'),
      req('http://[', HOST),
      req(undefined, HOST),
    ];
    for (const c of cases) {
      const res = fakeRes();
      handler(c, res);
      expect(res.status).toBe(404);
    }
    expect(world.servers.every((s) => s.closeCount === 0)).toBe(true);
    handler(req(goodUrl(), HOST), fakeRes());
    await expect(server.awaitCallback()).resolves.toMatchObject({ code: 'abc' });
  });

  test('after the slot is used a second callback is a 404', async () => {
    const { handler, server } = await bound();
    handler(req(goodUrl(), HOST), fakeRes());
    const res = fakeRes();
    handler(req(goodUrl(), HOST), res);
    expect(res.status).toBe(404);
    await server.awaitCallback();
  });

  test('a callback with the right state and an error rejects at once with a safe code', async () => {
    const { world, handler, server } = await bound();
    const res = fakeRes();
    handler(
      req(
        `${CALLBACK_PATH}?error=access_denied&error_description=secret+text&state=${STATE}`,
        HOST,
      ),
      res,
    );
    const failure = await server.awaitCallback().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(CallbackError);
    expect((failure as CallbackError).code).toBe('access_denied');
    expect((failure as CallbackError).message).not.toContain('secret');
    expect(res.status).toBe(400);
    expect(world.servers.every((s) => s.closeCount === 1)).toBe(true);
  });

  test('an unsafe error code is reported as unknown_error', async () => {
    const { handler, server } = await bound();
    handler(req(`${CALLBACK_PATH}?error=%3Cscript%3E&state=${STATE}`, HOST), fakeRes());
    const failure = await server.awaitCallback().catch((e: unknown) => e);
    expect((failure as CallbackError).code).toBe('unknown_error');
  });

  test('a matching state with a missing, empty or oversized code is an invalid callback', async () => {
    for (const code of ['', 'code=&', `code=${'x'.repeat(2049)}&`]) {
      const { handler, server } = await bound();
      const res = fakeRes();
      handler(req(`${CALLBACK_PATH}?${code}state=${STATE}`, HOST), res);
      const failure = await server.awaitCallback().catch((e: unknown) => e);
      expect((failure as CallbackError).code).toBe('invalid_callback');
      expect(res.status).toBe(400);
    }
  });

  test('the timeout starts at bind time, even if nobody is waiting yet', async () => {
    const { world, server } = await bound(10);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(world.servers.every((s) => s.closeCount === 1 && s.closeAllCount === 1)).toBe(true);
    await expect(server.awaitCallback()).rejects.toBeInstanceOf(SignInTimeoutError);
    server.close();
    expect(world.servers[0]?.closeCount).toBe(1);
  });

  test('an in-time callback clears the timer so no timeout error follows', async () => {
    const { handler, server } = await bound(30);
    handler(req(goodUrl(), HOST), fakeRes());
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(server.awaitCallback()).resolves.toMatchObject({ code: 'abc' });
  });

  test('close() stops the timer and is safe to repeat', async () => {
    const { world, server } = await bound(10);
    server.close();
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(world.servers[0]?.closeCount).toBe(1);
  });
});

/** A real HTTP request to 127.0.0.1:port, resolving with the status and body. */
function httpRequest(
  port: number,
  path: string,
  method = 'GET',
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = (method === 'GET' ? get : request)(
      { host: '127.0.0.1', port, path, method, agent: false, headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on('error', reject);
    r.end();
  });
}

describe('events-client, task 9.5: loopback request handling (real socket on 127.0.0.1)', () => {
  // Port 0 asks the OS for a free port, so no fixed port is needed. The second (IPv6)
  // listener is faked as unsupported so the result never depends on the machine's
  // IPv6 setup; the first listener is a real hardened HTTP server.
  function realV4Deps(): LoopbackDeps {
    let calls = 0;
    return {
      createServer: (handler) => {
        calls += 1;
        return calls === 1
          ? defaultLoopbackDeps.createServer(handler)
          : new FakeServer(
              () => 'EAFNOSUPPORT',
              () => null,
            );
      },
    };
  }

  test('a real redirect is handled once, then the listener is gone', async () => {
    const server = await bindLoopback([0], realV4Deps(), OPTIONS);
    expect(server.port).toBeGreaterThan(0);
    expect((await httpRequest(server.port, '/nope')).status).toBe(404);
    expect((await httpRequest(server.port, `/callback?code=abc&state=bad`)).status).toBe(400);
    const evil = await httpRequest(server.port, `/callback?code=abc&state=${STATE}`, 'GET', {
      host: 'evil.example',
    });
    expect(evil.status).toBe(404);
    const reply = await httpRequest(server.port, `/callback?code=abc&state=${STATE}`);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('Sign-in is complete');
    await expect(server.awaitCallback()).resolves.toEqual({
      code: 'abc',
      state: STATE,
      port: server.port,
    });
    await expect(httpRequest(server.port, '/callback?code=a&state=b')).rejects.toBeDefined();
  });

  test('a real POST to /callback is refused with 404', async () => {
    const server = await bindLoopback([0], realV4Deps(), OPTIONS);
    const reply = await httpRequest(server.port, `/callback?code=a&state=${STATE}`, 'POST');
    expect(reply.status).toBe(404);
    server.close();
  });

  test('the default factory binds a real 127.0.0.1 socket and holds [::1] when it exists', async () => {
    const server = await bindLoopback([0], defaultLoopbackDeps, OPTIONS);
    expect(server.port).toBeGreaterThan(0);
    server.close();
  });

  test('the default HTTP server carries header size and timeout limits', () => {
    const server = defaultLoopbackDeps.createServer(() => undefined) as unknown as Server;
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.requestTimeout).toBe(REQUEST_TIMEOUT_MS);
    expect(MAX_HEADER_SIZE_BYTES).toBe(8192);
    server.close();
  });

  test('a request with oversized headers is refused by the real server', async () => {
    const server = await bindLoopback([0], realV4Deps(), OPTIONS);
    const outcome = await httpRequest(server.port, '/callback', 'GET', {
      'x-big': 'a'.repeat(20_000),
    }).then(
      (r) => r.status,
      () => 'reset',
    );
    expect([431, 'reset']).toContain(outcome);
    server.close();
  });
});
