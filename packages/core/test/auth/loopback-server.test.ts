import { get, request } from 'node:http';
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  CALLBACK_PATH,
  LOOPBACK_PORTS,
  bindLoopback,
  defaultLoopbackDeps,
  type LoopbackDeps,
  type RequestHandler,
  type ResponseLike,
  type ServerLike,
} from '../../src/auth/loopback-server.js';
import { CallbackError, NoLoopbackPortError, SignInTimeoutError } from '../../src/auth/errors.js';

// Tests for the loopback server (events-client, S1, tasks 9.3 to 9.5). Port selection
// (Property 2) runs against fake server factories keyed by port, so it never depends
// on ports 8484 to 8489 being free. The request-handling tests drive the handler
// directly through a fake factory, and a small set of real-socket tests bind
// 127.0.0.1 on port 0 only.

/** What a fake bind attempt does for one host and port. */
type FakeBind = 'ok' | 'EADDRINUSE' | 'EADDRNOTAVAIL' | 'EAFNOSUPPORT' | 'EACCES' | 'nocode';

interface FakeWorld {
  deps: LoopbackDeps;
  /** Servers created for the callback (not probes), in creation order. */
  servers: FakeServer[];
  handlers: RequestHandler[];
  probes: FakeServer[];
}

class FakeServer implements ServerLike {
  closeCount = 0;
  private errorListener: ((error: { code?: string }) => void) | undefined;
  constructor(
    private readonly behave: (host: string, port: number) => FakeBind,
    private readonly addressOf: (port: number) => { port: number } | string | null,
  ) {}
  once(_event: 'error', listener: (error: { code?: string }) => void): void {
    this.errorListener = listener;
  }
  private port = 0;
  listen(port: number, host: string, listener: () => void): void {
    this.port = port;
    const outcome = this.behave(host, port);
    queueMicrotask(() => {
      if (outcome === 'ok') {
        listener();
      } else {
        this.errorListener?.(outcome === 'nocode' ? {} : { code: outcome });
      }
    });
  }
  close(): void {
    this.closeCount += 1;
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
    probes: [],
    deps: {
      createServer: (handler) => {
        const server = new FakeServer(behave, addressOf);
        world.servers.push(server);
        world.handlers.push(handler);
        return server;
      },
      createProbeServer: () => {
        const probe = new FakeServer(behave, addressOf);
        world.probes.push(probe);
        return probe;
      },
    },
  };
  return world;
}

/** A recording fake response. */
function fakeRes(): ResponseLike & { status?: number; body?: string } {
  const res: ResponseLike & { status?: number; body?: string } = {
    writeHead(status) {
      res.status = status;
    },
    end(body) {
      res.body = body;
    },
  };
  return res;
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
          await expect(bindLoopback(LOOPBACK_PORTS, world.deps)).rejects.toBeInstanceOf(
            NoLoopbackPortError,
          );
          // Nothing is left listening.
          expect(world.servers.every((s) => s.closeCount === 1 || s.closeCount === 0)).toBe(true);
        } else {
          const server = await bindLoopback(LOOPBACK_PORTS, world.deps);
          expect(server.port).toBe(usable[0]);
          // The chosen server stays up; every earlier attempt was released.
          const chosen = world.servers[world.servers.length - 1];
          expect(chosen?.closeCount).toBe(0);
          server.close();
          expect(chosen?.closeCount).toBe(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('a port whose [::1] side is taken is skipped and its server is released', async () => {
    const world = fakeWorld((host, port) => (host !== v4 && port === 8484 ? 'EADDRINUSE' : 'ok'));
    const server = await bindLoopback(LOOPBACK_PORTS, world.deps);
    expect(server.port).toBe(8485);
    expect(world.servers[0]?.closeCount).toBe(1);
  });

  test('the ports are exactly 8484 to 8489 in ascending order', () => {
    expect(LOOPBACK_PORTS).toEqual([8484, 8485, 8486, 8487, 8488, 8489]);
  });

  test('the bound port falls back to the requested port when the address is not an object', async () => {
    const asString = fakeWorld(
      () => 'ok',
      () => 'pipe',
    );
    expect((await bindLoopback([9001], asString.deps)).port).toBe(9001);
    const asNull = fakeWorld(
      () => 'ok',
      () => null,
    );
    expect((await bindLoopback([9002], asNull.deps)).port).toBe(9002);
  });

  test('an empty port list has no port available', async () => {
    await expect(bindLoopback([], fakeWorld(() => 'ok').deps)).rejects.toBeInstanceOf(
      NoLoopbackPortError,
    );
  });
});

describe('events-client, task 9.5: loopback request handling (fake server)', () => {
  async function bound(): Promise<{ world: FakeWorld; handler: RequestHandler }> {
    const world = fakeWorld(() => 'ok');
    await bindLoopback([8484], world.deps);
    const handler = world.handlers[0];
    if (handler === undefined) {
      throw new Error('no handler');
    }
    return { world, handler };
  }

  test('a valid /callback request resolves once, answers 200 and shuts down', async () => {
    const world = fakeWorld(() => 'ok');
    const server = await bindLoopback([8484], world.deps);
    const res = fakeRes();
    world.handlers[0]?.({ url: `${CALLBACK_PATH}?code=abc&state=xyz`, method: 'GET' }, res);
    await expect(server.awaitCallback(1000)).resolves.toEqual({
      code: 'abc',
      state: 'xyz',
      port: 8484,
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Sign-in is complete');
    expect(world.servers[0]?.closeCount).toBe(1);
  });

  test('the callback may arrive before awaitCallback is called', async () => {
    const world = fakeWorld(() => 'ok');
    const server = await bindLoopback([8484], world.deps);
    world.handlers[0]?.({ url: '/callback?code=c&state=s', method: 'GET' }, fakeRes());
    await expect(server.awaitCallback(1000)).resolves.toMatchObject({ code: 'c', state: 's' });
  });

  test('other paths, other methods, bad targets and a second callback get 404 and do not shut down', async () => {
    const { world, handler } = await bound();
    for (const req of [
      { url: '/', method: 'GET' },
      { url: '/callback/extra', method: 'GET' },
      { url: '/callback?code=a&state=b', method: 'POST' },
      { url: 'http://[', method: 'GET' },
      { method: 'GET' },
    ]) {
      const res = fakeRes();
      handler(req, res);
      expect(res.status).toBe(404);
    }
    expect(world.servers[0]?.closeCount).toBe(0);
  });

  test('after the first callback a second /callback request is a 404', async () => {
    const { handler } = await bound();
    handler({ url: '/callback?code=a&state=b', method: 'GET' }, fakeRes());
    const res = fakeRes();
    handler({ url: '/callback?code=other&state=other', method: 'GET' }, res);
    expect(res.status).toBe(404);
  });

  test('/callback?error= rejects at once with a safe code and a failure page', async () => {
    const world = fakeWorld(() => 'ok');
    const server = await bindLoopback([8484], world.deps);
    const res = fakeRes();
    world.handlers[0]?.(
      { url: '/callback?error=access_denied&error_description=secret+text', method: 'GET' },
      res,
    );
    const failure = await server.awaitCallback(1000).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(CallbackError);
    expect((failure as CallbackError).code).toBe('access_denied');
    expect((failure as CallbackError).message).not.toContain('secret');
    expect(res.status).toBe(400);
    expect(world.servers[0]?.closeCount).toBe(1);
  });

  test('an unsafe error code is reported as unknown_error', async () => {
    const world = fakeWorld(() => 'ok');
    const server = await bindLoopback([8484], world.deps);
    world.handlers[0]?.({ url: '/callback?error=%3Cscript%3E', method: 'GET' }, fakeRes());
    const failure = await server.awaitCallback(1000).catch((e: unknown) => e);
    expect((failure as CallbackError).code).toBe('unknown_error');
  });

  test('a callback missing code or state, or with an oversized value, is invalid', async () => {
    for (const query of [
      '?state=s',
      '?code=c',
      '?code=&state=s',
      `?code=c&state=${'x'.repeat(2049)}`,
      '',
    ]) {
      const world = fakeWorld(() => 'ok');
      const server = await bindLoopback([8484], world.deps);
      const res = fakeRes();
      world.handlers[0]?.({ url: `/callback${query}`, method: 'GET' }, res);
      const failure = await server.awaitCallback(1000).catch((e: unknown) => e);
      expect((failure as CallbackError).code).toBe('invalid_callback');
      expect(res.status).toBe(400);
    }
  });

  test('with no callback the sign-in times out and the server shuts down', async () => {
    const world = fakeWorld(() => 'ok');
    const server = await bindLoopback([8484], world.deps);
    await expect(server.awaitCallback(10)).rejects.toBeInstanceOf(SignInTimeoutError);
    expect(world.servers[0]?.closeCount).toBe(1);
    server.close();
    expect(world.servers[0]?.closeCount).toBe(1);
  });
});

/** A real HTTP GET to 127.0.0.1:port, resolving with the status and body. */
function httpRequest(
  port: number,
  path: string,
  method = 'GET',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = (method === 'GET' ? get : request)(
      { host: '127.0.0.1', port, path, method, agent: false },
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
    req.on('error', reject);
    req.end();
  });
}

describe('events-client, task 9.5: loopback request handling (real socket on 127.0.0.1)', () => {
  // Port 0 asks the OS for a free port, so no fixed port is needed. The ::1 probe is
  // faked as unsupported so the result never depends on the machine's IPv6 setup.
  const deps: LoopbackDeps = {
    createServer: defaultLoopbackDeps.createServer,
    createProbeServer: () =>
      new FakeServer(
        () => 'EAFNOSUPPORT',
        () => null,
      ),
  };

  test('a real redirect is handled once, then the listener is gone', async () => {
    const server = await bindLoopback([0], deps);
    expect(server.port).toBeGreaterThan(0);
    const missing = await httpRequest(server.port, '/nope');
    expect(missing.status).toBe(404);
    const pending = server.awaitCallback(5000);
    const reply = await httpRequest(server.port, '/callback?code=abc&state=xyz');
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('Sign-in is complete');
    await expect(pending).resolves.toEqual({ code: 'abc', state: 'xyz', port: server.port });
    await expect(httpRequest(server.port, '/callback?code=a&state=b')).rejects.toBeDefined();
  });

  test('a real POST to /callback is refused with 404', async () => {
    const server = await bindLoopback([0], deps);
    const reply = await httpRequest(server.port, '/callback?code=a&state=b', 'POST');
    expect(reply.status).toBe(404);
    server.close();
  });

  test('the default factories bind a real 127.0.0.1 socket and probe [::1]', async () => {
    const server = await bindLoopback([0]);
    expect(server.port).toBeGreaterThan(0);
    server.close();
  });
});
