import { describe, expect, test, vi } from 'vitest';
import {
  ClientConfigError,
  LiveClientNotConfiguredError,
  SIMULATED_MODE_WARNING,
  SimulatedFixturesMissingError,
  SimulatedModeRefusedError,
  createClientContext,
  type ClientContextDeps,
} from '../../src/api/client-context.js';
import { isSimulatedResult } from '../../src/api/execute-operation.js';
import { listEvents } from '../../src/api/list-events.js';
import { getSchedule } from '../../src/api/get-schedule.js';
import { cancelReservation } from '../../src/api/cancel-reservation.js';
import { reserveSessions } from '../../src/api/reserve-sessions.js';
import { createRedactingLogger } from '../../src/api/redacting-logger.js';
import { createFsFixtureLoader } from '../../src/simulated/fixtures.js';
import {
  SIMULATED_ACCESS_TOKEN,
  createSimulatedCredential,
} from '../../src/simulated/simulated-credential.js';
import { SimulatedScenarioError } from '../../src/simulated/simulated-transport.js';
import { fakeOAuth, fakeStore, heldTokens } from '../auth/auth-harness.js';
import { fetchAllSessions } from '../../src/catalog/paginate.js';
import { readCatalog } from '../../src/catalog/cache.js';
import { fakeFs } from '../catalog/arbitraries.js';
import type { FetchResponseLike } from '../../src/api/http-transport.js';

// Tests for the composition root and the simulated-mode markers (events-client, S1,
// QA M4 and security N2). Nothing here reaches the network: fetch is a spy that fails
// the test if it is ever called in simulated mode.

function logs(): { logger: ReturnType<typeof createRedactingLogger>; warns: string[] } {
  const warns: string[] = [];
  const logger = createRedactingLogger({
    info: () => undefined,
    warn: (line) => warns.push(line),
    error: () => undefined,
  });
  return { logger, warns };
}

function baseDeps(overrides: Partial<ClientContextDeps> = {}): {
  deps: ClientContextDeps;
  warns: string[];
} {
  const { logger, warns } = logs();
  return {
    warns,
    deps: {
      eventId: 'reinvent2026',
      logger,
      now: () => 1_000_000,
      sleep: () => Promise.resolve(),
      ...overrides,
    },
  };
}

describe('events-client, QA M4 and N2: simulated mode', () => {
  test('COMPASS_MODE=simulated gives a simulated context, with no credential, OAuth or fetch call', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('live fetch attempted')));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const { deps, warns } = baseDeps();
      const ctx = createClientContext({ COMPASS_MODE: 'simulated' }, deps);
      expect(ctx.transport.simulated).toBe(true);
      expect(ctx.eventId).toBe('reinvent2026');
      await expect(ctx.accessToken.getAccessTokenForEventsApi()).resolves.toBe(
        SIMULATED_ACCESS_TOKEN,
      );
      await expect(ctx.accessToken.forceRefresh()).resolves.toBeUndefined();
      expect(warns).toEqual([SIMULATED_MODE_WARNING]);
      expect(SIMULATED_MODE_WARNING).toBe('SIMULATED MODE: no real data');

      const events = await listEvents(ctx);
      expect(isSimulatedResult(events)).toBe(true);
      expect(events.items[0]?.eventId).toBe('reinvent2026');
      expect(isSimulatedResult(await getSchedule(ctx))).toBe(true);
      expect(isSimulatedResult(await reserveSessions(ctx, ['syn-001']))).toBe(true);
      // A 204 result has no body to carry the tag; the transport carries it instead.
      const cancelled = await cancelReservation(ctx, 'syn-001');
      expect(cancelled).toBeUndefined();
      expect(isSimulatedResult(cancelled)).toBe(false);
      expect(ctx.transport.simulated).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('the catalog read says it is simulated', async () => {
    const { deps } = baseDeps();
    const ctx = createClientContext({ COMPASS_MODE: 'simulated' }, deps);
    const wires = await fetchAllSessions(ctx, { includeAbstracts: false });
    expect(wires.length).toBe(120);
    const read = await readCatalog({
      ctx,
      dir: '/cache',
      fs: fakeFs(),
      eventTimezone: 'America/Los_Angeles',
      now: () => 1_000_000,
    });
    expect(read.simulated).toBe(true);
  });

  test('simulated mode is refused in production unless COMPASS_ALLOW_SIMULATED is exactly 1', () => {
    for (const allow of [undefined, '', '0', 'true', 'yes']) {
      const { deps, warns } = baseDeps();
      const env = {
        COMPASS_MODE: 'simulated',
        NODE_ENV: 'production',
        COMPASS_ALLOW_SIMULATED: allow,
      };
      expect(() => createClientContext(env, deps)).toThrow(SimulatedModeRefusedError);
      expect(warns).toEqual([]);
    }
    const { deps, warns } = baseDeps();
    const ctx = createClientContext(
      { COMPASS_MODE: 'simulated', NODE_ENV: 'production', COMPASS_ALLOW_SIMULATED: '1' },
      deps,
    );
    expect(ctx.transport.simulated).toBe(true);
    expect(warns).toEqual([SIMULATED_MODE_WARNING]);
    for (const nodeEnv of [undefined, 'development', 'test']) {
      expect(
        createClientContext({ COMPASS_MODE: 'simulated', NODE_ENV: nodeEnv }, baseDeps().deps)
          .transport.simulated,
      ).toBe(true);
    }
  });

  test('a bundled build that lacks the fixtures fails closed and never falls back to live', () => {
    const fetchSpy = vi.fn();
    const store = fakeStore(heldTokens());
    const oauth = fakeOAuth([{ status: 200 }]);
    const { deps } = baseDeps({
      fixtures: createFsFixtureLoader('/definitely/not/a/fixtures/root'),
      store,
      fetch: fetchSpy,
      oauthFetch: oauth.fetch,
    });
    const failure = ((): unknown => {
      try {
        createClientContext({ COMPASS_MODE: 'simulated' }, deps);
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(failure).toBeInstanceOf(SimulatedFixturesMissingError);
    expect(failure).toBeInstanceOf(ClientConfigError);
    expect((failure as Error).message).not.toContain('/definitely');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(oauth.calls).toHaveLength(0);
  });

  test('the default fixture loader, bundled away from the repository, also fails closed', () => {
    const { deps } = baseDeps({
      fixtures: createFsFixtureLoader('/nonexistent-bundle-dir', () => {
        throw new Error('ENOENT');
      }),
    });
    expect(() => createClientContext({ COMPASS_MODE: 'simulated' }, deps)).toThrow(
      SimulatedFixturesMissingError,
    );
  });

  test('a scenario that cannot be served is reported as is, not as missing fixtures', () => {
    const { deps } = baseDeps({ simulated: { throttleOps: ['ListEvents'] } });
    expect(() => createClientContext({ COMPASS_MODE: 'simulated' }, deps)).toThrow(
      SimulatedScenarioError,
    );
  });

  test('createSimulatedCredential makes no call and hands out only the fixed label', async () => {
    const credential = createSimulatedCredential();
    expect(await credential.getAccessTokenForEventsApi()).toBe('simulated-access-token');
    expect(Object.keys(credential).sort()).toEqual(['forceRefresh', 'getAccessTokenForEventsApi']);
  });
});

describe('events-client, QA M4: live mode', () => {
  const reply = (status: number, body: unknown): FetchResponseLike => ({
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  });

  test('anything other than COMPASS_MODE=simulated is live and needs its pieces', () => {
    for (const mode of [undefined, '', 'live', 'Simulated', 'SIMULATED']) {
      const { deps, warns } = baseDeps();
      expect(() => createClientContext({ COMPASS_MODE: mode }, deps)).toThrow(
        LiveClientNotConfiguredError,
      );
      expect(warns).toEqual([]);
    }
    const store = fakeStore();
    const oauthFetch = fakeOAuth([{ status: 200 }]).fetch;
    const fetch = () => Promise.resolve(reply(200, {}));
    for (const missing of ['store', 'fetch', 'oauthFetch'] as const) {
      const pieces = { store, fetch, oauthFetch };
      delete pieces[missing];
      expect(() => createClientContext({}, baseDeps(pieces).deps)).toThrow(
        LiveClientNotConfiguredError,
      );
    }
  });

  test('live mode uses the store credential and the Events API fetch, untagged and unwarned', async () => {
    const store = fakeStore(heldTokens({ accessTokenExpiresAt: 1_000_000 + 3_600_000 }));
    const seen: { url: string; authorization: string | undefined }[] = [];
    const { deps, warns } = baseDeps({
      store,
      oauthFetch: fakeOAuth([{ status: 200 }]).fetch,
      fetch: (url, init) => {
        seen.push({ url, authorization: init.headers.authorization });
        return Promise.resolve(
          reply(200, { schedule: { reserved: [], favorites: [], personalTime: [] } }),
        );
      },
    });
    const ctx = createClientContext({ COMPASS_MODE: 'live', NODE_ENV: 'production' }, deps);
    expect(ctx.transport.simulated).toBeUndefined();
    await expect(ctx.accessToken.getAccessTokenForEventsApi()).resolves.toBe(
      'held-access-token-value',
    );
    const schedule = await getSchedule(ctx);
    expect(isSimulatedResult(schedule)).toBe(false);
    expect(seen).toEqual([
      {
        url: 'https://api.awsevents.com/v1/events/reinvent2026/schedule',
        authorization: 'Bearer held-access-token-value',
      },
    ]);
    expect(warns).toEqual([]);
  });
});
