// createRuntime: picks the live or the simulated composition and builds the Runtime once, at
// start-up (design, Architecture; Requirements 16.5, 22.1, 23.1 to 23.5).
//
// Both compositions share the real S2 rules, the real S4 passes and the real S1 client context.
// Simulated mode is selected only by COMPASS_MODE=simulated: S1 then serves the synthetic fixtures
// through its simulated transport, passes go to the In_Process_Pass_Service, the clock is pinned,
// and every simulated file lives in a `simulated` subfolder so it can never mix with live data.
// Live mode needs the token store and the network; the Compass API host the ID token goes to comes
// from the build-time constant (see config/runtime-config.ts). Everything that touches the machine
// (platform, folders, fetch, keychain, process launcher) arrives through `RuntimeEnvironment`, so
// no platform branch lives here and every part can be tested with fakes.

import { createClientContext, createRedactingLogger } from '@compass/core/api';
import type { FetchLike } from '@compass/core/api';
import {
  createCredentialSources,
  createIdTokenProvider,
  createTokenStore,
  defaultOAuthFetch,
  registerStoreSecrets,
  signIn,
  signOut,
} from '@compass/core/auth';
import type { LoopbackServer, OAuthFetch, TokenStore } from '@compass/core/auth';
import { realFs, resolveAppDataDir } from '@compass/core/catalog';
import { APP_FOLDER_NAME, createAppDataResolver, joinInFolder } from '@compass/core/passes';
import type { HttpTransport } from '@compass/core/passes';
import { VenueDataSchema } from '@compass/core/rules';
import { createNodeScanFs, scanInWorker } from '@compass/core/scanner';
import { createFsFixtureLoader } from '@compass/core/simulated';
import { createNodeSpecFs } from '@compass/core/spec';
import { readFile } from 'node:fs/promises';
import { createFetchTransport } from '../adapters/fetch-transport.js';
import { defaultEventsFetch } from '../adapters/default-fetch.js';
import { createEventsAdapter } from '../adapters/events-adapter.js';
import type { AuthPort } from '../adapters/events-adapter.js';
import { createNodeAppFileSystem } from '../adapters/node-fs-adapter.js';
import { createRulesAdapter } from '../adapters/rules-adapter.js';
import { EVENT_ID } from '../config/event.js';
import { readRuntimeConfig } from '../config/runtime-config.js';
import { createStderrLogger } from '../logging/stderr-logger.js';
import type { StderrSink } from '../logging/stderr-logger.js';
import type { Clock } from '../ports/clock.js';
import type { Runtime } from '../ports/runtime.js';
import { SIMULATED_HOST } from '../simulated/in-process-pass-service.js';
import { simulatedIdToken } from '../simulated/simulated-id-token.js';
import {
  createSimulatedRuntime,
  pinnedClock,
  SIMULATED_NOW,
} from '../simulated/simulated-runtime.js';
import { createSnapshotStore } from '../state/schedule-snapshot.js';
import { createBrowserOpener } from './browser-opener.js';
import { realBind } from './real-bind.js';
import { sleep } from './sleep.js';
import { expiryOf } from './token-expiry.js';
import type { ExecFileLike } from './browser-opener.js';
import { createPassesFactory } from './passes-factory.js';

/** Settings from the environment, as plain values. */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

/** Everything that touches the machine. The process values are passed in by bin.ts. */
export interface RuntimeEnvironment {
  homeDir: string;
  platform: string;
  cwd: string;
  version: string;
  stderr: StderrSink;
  execFile: ExecFileLike;
  /** The venue list file (data/venues.json). */
  venuesPath: string;
  /** The bundled scan worker. When it is left out the scan runs in the server's own thread. */
  scanWorkerPath?: string;
  /** The folder with the simulated fixtures (`api` and `synthetic`). Left out, S1 uses the repository's. */
  fixturesRoot?: string;
  /** Test seams. Production leaves them out and the real ones are used. */
  store?: TokenStore;
  fetch?: FetchLike;
  oauthFetch?: OAuthFetch;
  compassTransport?: HttpTransport;
  bind?: (expectedState: string, timeoutMs: number) => Promise<LoopbackServer>;
}

/** Options a command can set for one run. */
export interface RuntimeOptions {
  /** The workspace the tools read and write; the demo points it at a temporary copy. */
  cwd?: string;
}

const SIGN_OUT_FALLBACK = 'https://idp.awsevents.com/oidc/logout';

/** Reads and validates the venue list. Returns the S2 data and the list S1 wants. */
export async function readVenues(path: string) {
  const data = VenueDataSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  return { data, list: data.venues.map((entry) => entry.venue) };
}

function simulatedAuth(): AuthPort {
  return {
    isSignedIn: () => true,
    expiresAt: () => undefined,
    signIn: () => Promise.resolve({}),
    signOut: () => Promise.resolve({ signOutUrl: SIGN_OUT_FALLBACK }),
  };
}

/** Builds the Runtime for `env`. */
export async function createRuntime(
  environment: RuntimeEnvironment,
  env: EnvRecord,
  options: RuntimeOptions = {},
): Promise<Runtime> {
  const config = readRuntimeConfig(env);
  const simulated = config.mode === 'simulated';
  const logger = createStderrLogger(environment.stderr);
  if (config.warning !== undefined) {
    logger.warn(config.warning);
  }
  const cwd = options.cwd ?? environment.cwd;
  const systemClock: Clock = { now: () => new Date() };
  const clock: Clock = simulated ? pinnedClock() : systemClock;
  const nowMs = (): number => clock.now().getTime();
  const { scanWorkerPath } = environment;
  const scanRunner =
    scanWorkerPath === undefined
      ? {}
      : { scanRunner: (root: string) => scanInWorker(root, { workerPath: scanWorkerPath }) };
  const venues = await readVenues(environment.venuesPath);

  const root = createAppDataResolver({
    platform: environment.platform,
    env: { ...env },
    homeDir: environment.homeDir,
  }).resolve();
  // S4 insists that its folder ends in the app folder name, so the simulated copy is nested under it.
  const dataRoot = simulated ? joinInFolder(root, 'simulated', APP_FOLDER_NAME) : root;
  const catalogRoot = resolveAppDataDir(env, environment.homeDir, environment.platform);
  const catalogDir = simulated ? joinInFolder(catalogRoot, 'simulated') : catalogRoot;

  const writeLine = (line: string): void => {
    environment.stderr.write(`${line}\n`);
  };
  const redacting = createRedactingLogger({ info: writeLine, warn: writeLine, error: writeLine });
  const store = registerStoreSecrets(environment.store ?? createTokenStore(), redacting);
  const bind = environment.bind ?? realBind;
  const oauthFetch = environment.oauthFetch ?? defaultOAuthFetch;
  const eventsFetch = environment.fetch ?? defaultEventsFetch;

  const ctx = createClientContext(
    { ...env, COMPASS_MODE: simulated ? 'simulated' : 'live' },
    {
      eventId: EVENT_ID,
      logger: redacting,
      now: nowMs,
      sleep,
      ...(simulated
        ? {
            simulated: { now: () => Date.parse(SIMULATED_NOW) },
            ...(environment.fixturesRoot === undefined
              ? {}
              : { fixtures: createFsFixtureLoader(environment.fixturesRoot) }),
          }
        : { store, fetch: eventsFetch, oauthFetch }),
    },
  );

  const sources = createCredentialSources(store, {
    fetch: oauthFetch,
    logger: redacting,
    now: nowMs,
  });
  const idProvider = createIdTokenProvider(sources);
  const live: AuthPort = {
    isSignedIn: () => store.load() !== undefined,
    expiresAt: () => expiryOf(store),
    signIn: () =>
      signIn({
        store,
        logger: redacting,
        fetch: oauthFetch,
        now: nowMs,
        bind,
        openBrowser: createBrowserOpener({
          platform: environment.platform,
          execFile: environment.execFile,
          notify: writeLine,
        }),
      }),
    signOut: () => signOut(store, { fetch: oauthFetch, logger: redacting }),
  };

  const events = createEventsAdapter({
    ctx,
    auth: simulated ? simulatedAuth() : live,
    catalogDir,
    catalogFs: realFs,
    venues: venues.list,
    now: nowMs,
  });
  const rules = createRulesAdapter({
    clock,
    venueData: venues.data,
    eventWindow: () => events.eventWindow(),
  });
  const passesFactory = createPassesFactory({
    idToken: {
      getIdToken: simulated
        ? () => Promise.resolve(simulatedIdToken())
        : () => idProvider.getIdTokenForCompassApi(),
    },
    fs: createNodeAppFileSystem(),
    appData: { resolve: () => dataRoot },
    clock: { now: () => clock.now(), sleep },
    connections: { walkMinutes: (from, to) => rules.walkMinutes(from, to) },
    eventWindow: () => events.eventWindow(),
    allowedHosts: simulated ? [SIMULATED_HOST] : config.allowedHosts,
    simulated,
  });

  if (simulated) {
    return (
      await createSimulatedRuntime({
        version: environment.version,
        cwd,
        logger,
        events,
        rules,
        createPasses: passesFactory,
        scanFs: createNodeScanFs(),
        specFs: createNodeSpecFs(),
        appDataDir: root,
        fs: createNodeAppFileSystem(),
        ...scanRunner,
      })
    ).runtime;
  }
  return {
    mode: 'live',
    version: environment.version,
    events,
    rules,
    passes: passesFactory(
      environment.compassTransport ?? createFetchTransport(),
      config.compassApiUrl,
    ),
    snapshot: createSnapshotStore(root, 'live', createNodeAppFileSystem()),
    scanFs: createNodeScanFs(),
    specFs: createNodeSpecFs(),
    clock,
    logger,
    cwd,
    ...scanRunner,
  };
}
