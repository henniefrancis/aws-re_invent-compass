// The composition root for a client context (events-client, S1, QA M4 and security N2).
//
// createClientContext(env, deps) is the one place that decides between the live and
// the simulated client and builds a ClientContext for it.
//
//   - COMPASS_MODE=simulated selects the simulated transport and the simulated
//     credential (no sign-in, no OAuth, no network). Anything else is live and needs
//     the token store and fetch in deps.
//   - Simulated mode must be unmistakable: the transport is marked `simulated: true`,
//     one "SIMULATED MODE: no real data" warning is logged here, and every object
//     result is tagged `simulated: true` by the operation path.
//   - Simulated mode is refused when NODE_ENV is production (in any letter case) unless
//     COMPASS_ALLOW_SIMULATED is exactly 1.
//   - It fails closed: if the simulated fixtures cannot be loaded (a bundled build that
//     does not ship them, a moved directory) createClientContext throws
//     SimulatedFixturesMissingError. It never falls back to the live API.

import { createEventsApiCredential } from '../auth/credential-provider.js';
import { createCredentialSources, type RefreshDeps } from '../auth/refresh.js';
import type { TokenStore } from '../auth/token-store.js';
import { createFsFixtureLoader, type FixtureLoader } from '../simulated/fixtures.js';
import { createSimulatedCredential } from '../simulated/simulated-credential.js';
import {
  createSimulatedTransport,
  SimulatedScenarioError,
  type SimulatedConfig,
} from '../simulated/simulated-transport.js';
import { createHttpTransport, type FetchLike } from './http-transport.js';
import { createQuotaTracker } from './quota-tracker.js';
import type { RedactingLogger } from './redacting-logger.js';
import {
  selectTransport,
  SIMULATED_MODE,
  type ClientContext,
  type EnvLike,
  type EventsApiCredential,
} from './transport.js';

/** The fixed warning logged once when simulated mode is used. */
export const SIMULATED_MODE_WARNING = 'SIMULATED MODE: no real data';

/** A configuration problem found while building a client context. */
export class ClientConfigError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** Simulated mode was requested where it is not allowed. */
export class SimulatedModeRefusedError extends ClientConfigError {
  constructor() {
    super(
      'SimulatedModeRefusedError',
      'Simulated mode is refused in production. Set COMPASS_ALLOW_SIMULATED=1 to allow it on purpose',
    );
  }
}

/** The simulated fixtures could not be loaded, so nothing is served. */
export class SimulatedFixturesMissingError extends ClientConfigError {
  constructor() {
    super(
      'SimulatedFixturesMissingError',
      'Simulated mode could not load its fixtures, so it will not start (it never falls back to the live API)',
    );
  }
}

/** The live client was requested without the pieces it needs. */
export class LiveClientNotConfiguredError extends ClientConfigError {
  constructor() {
    super(
      'LiveClientNotConfiguredError',
      'The live client needs a token store and a fetch function',
    );
  }
}

/** What createClientContext needs. Live pieces are only used in live mode. */
export interface ClientContextDeps {
  /** The event every event-scoped call targets, for example reinvent2026. */
  eventId: string;
  logger: RedactingLogger;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Live mode: the (secret-registering) token store. */
  store?: TokenStore;
  /** Live mode: the fetch for the Events API, and for the OAuth calls via oauthFetch. */
  fetch?: FetchLike;
  /** Live mode: the OAuth fetch used by token refresh. */
  oauthFetch?: RefreshDeps['fetch'];
  /** Simulated mode: scenarios and sizes. */
  simulated?: SimulatedConfig;
  /** Simulated mode: where the fixtures come from. Defaults to the repository's fixtures. */
  fixtures?: FixtureLoader;
}

/** Build the client context for the mode the environment selects. */
export function createClientContext(env: EnvLike, deps: ClientContextDeps): ClientContext {
  const simulated = env.COMPASS_MODE === SIMULATED_MODE;
  if (simulated) {
    if (
      env.NODE_ENV?.trim().toLowerCase() === 'production' &&
      env.COMPASS_ALLOW_SIMULATED !== '1'
    ) {
      throw new SimulatedModeRefusedError();
    }
    deps.logger.warn(SIMULATED_MODE_WARNING);
  }

  // The credential defaults to the simulated one; only the live branch replaces it.
  let accessToken: EventsApiCredential = createSimulatedCredential();
  const transport = selectTransport(env, {
    createHttpTransport: () => {
      const { store, fetch, oauthFetch } = deps;
      if (store === undefined || fetch === undefined || oauthFetch === undefined) {
        throw new LiveClientNotConfiguredError();
      }
      accessToken = createEventsApiCredential(
        createCredentialSources(store, { fetch: oauthFetch, logger: deps.logger, now: deps.now }),
      );
      return createHttpTransport({ credential: accessToken, fetch });
    },
    createSimulatedTransport: () => {
      try {
        return createSimulatedTransport(
          deps.simulated ?? {},
          deps.fixtures ?? createFsFixtureLoader(),
        );
      } catch (error) {
        if (error instanceof SimulatedScenarioError) {
          throw error;
        }
        throw new SimulatedFixturesMissingError();
      }
    },
  });

  return {
    eventId: deps.eventId,
    transport,
    accessToken,
    quota: createQuotaTracker(),
    logger: deps.logger,
    now: deps.now,
    sleep: deps.sleep,
  };
}
