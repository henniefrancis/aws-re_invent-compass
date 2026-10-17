// Shared test harness for the simulated transport tests (events-client, S1). Holds no
// tests. The catalog is the repository's read-only synthetic catalog; the canned
// responses are supplied here in memory so these tests do not depend on fixtures/api.

import { createQuotaTracker } from '../../src/api/quota-tracker.js';
import { createRedactingLogger } from '../../src/api/redacting-logger.js';
import type { ClientContext, EventsApiCredential } from '../../src/api/transport.js';
import {
  createFsFixtureLoader,
  type FixtureFile,
  type FixtureLoader,
} from '../../src/simulated/fixtures.js';
import {
  createSimulatedTransport,
  type SimulatedConfig,
} from '../../src/simulated/simulated-transport.js';
import type { OperationName } from '../../src/api/transport.js';

export const EVENT = {
  eventId: 'reinvent2026',
  name: 'AWS re:Invent 2026',
  eventType: 'conference',
  startDate: '2026-11-30T00:00:00-08:00',
  endDate: '2026-12-04T23:59:59-08:00',
  isOnline: false,
  authenticationRequired: true,
  timezone: 'America/Los_Angeles',
};

/** The repository's synthetic catalog, loaded through the real file loader. */
const realCatalog = createFsFixtureLoader().catalog();

/** A loader with the real synthetic catalog and in-memory canned responses. */
export function testFixtures(overrides: Record<string, FixtureFile> = {}): FixtureLoader {
  return {
    catalog: () => realCatalog,
    fixture(operation, scenario) {
      const key = `${operation}/${scenario}`;
      const override = overrides[key];
      if (override !== undefined) {
        return override;
      }
      switch (key) {
        case 'ListEvents/success':
          return { status: 200, body: { items: [EVENT] } };
        case 'GetEvent/success':
          return { status: 200, body: { event: EVENT } };
        default:
          if (scenario === 'error-429') {
            return {
              status: 429,
              headers: { 'retry-after': '2' },
              body: { message: 'Too many requests' },
            };
          }
          if (scenario === 'error-401-expired-token') {
            return { status: 401, body: { message: 'The token has expired' } };
          }
          throw new Error(`no test fixture for ${key}`);
      }
    },
  };
}

/** The observable parts of a simulated client context. */
export interface SimRig {
  ctx: ClientContext;
  /** Calls to the credential, to prove none are needed. */
  credentialCalls: string[];
  refreshes: () => number;
  sleeps: number[];
}

/** A client context over the simulated transport. */
export function simRig(
  cfg: SimulatedConfig = {},
  fixtures: FixtureLoader = testFixtures(),
): SimRig {
  const credentialCalls: string[] = [];
  let refreshCount = 0;
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const accessToken: EventsApiCredential = {
    getAccessTokenForEventsApi: () => {
      credentialCalls.push('get');
      return Promise.resolve('simulated-token');
    },
    forceRefresh: () => {
      credentialCalls.push('refresh');
      refreshCount += 1;
      return Promise.resolve();
    },
  };
  const ctx: ClientContext = {
    eventId: 'reinvent2026',
    transport: createSimulatedTransport(cfg, fixtures),
    accessToken,
    quota: createQuotaTracker(),
    logger: createRedactingLogger({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }),
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
  };
  return { ctx, credentialCalls, refreshes: () => refreshCount, sleeps };
}

export type { OperationName };
