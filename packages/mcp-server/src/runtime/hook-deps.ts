// The dependencies of the hooks (Requirements 18.4, 19.1 to 19.4). A hook never touches the
// network and never writes: it reads the Schedule_Snapshot and the cached catalog from the
// app-data folders, and runs the same S2 rules as the server. The event window comes from the
// snapshot, so there is no Events API call. Nothing here opens a socket or starts a process.

import { realFs, resolveAppDataDir } from '@compass/core/catalog';
import { createAppDataResolver, joinInFolder } from '@compass/core/passes';
import { readCachedCatalog } from '../adapters/events-adapter.js';
import { createRulesAdapter } from '../adapters/rules-adapter.js';
import { EVENT_ID } from '../config/event.js';
import { readRuntimeConfig } from '../config/runtime-config.js';
import type { HookDeps } from '../hooks/pre-write-guardrail.js';
import { CompassError } from '../ports/errors.js';
import type { Clock } from '../ports/clock.js';
import { pinnedClock } from '../simulated/simulated-runtime.js';
import { createSnapshotStore } from '../state/schedule-snapshot.js';
import { createNodeFsLike } from '../state/node-fs-like.js';
import { readVenues } from './create-runtime.js';
import type { EnvRecord, RuntimeEnvironment } from './create-runtime.js';

/** Builds the hook dependencies from the same folders the server uses. */
export async function createHookDeps(
  environment: Pick<RuntimeEnvironment, 'homeDir' | 'platform' | 'venuesPath'>,
  env: EnvRecord,
): Promise<HookDeps> {
  const config = readRuntimeConfig(env);
  const simulated = config.mode === 'simulated';
  const clock: Clock = simulated ? pinnedClock() : { now: () => new Date() };
  const root = createAppDataResolver({
    platform: environment.platform,
    env: { ...env },
    homeDir: environment.homeDir,
  }).resolve();
  const catalogRoot = resolveAppDataDir(env, environment.homeDir, environment.platform);
  const catalogDir = simulated ? joinInFolder(catalogRoot, 'simulated') : catalogRoot;
  const snapshot = createSnapshotStore(root, config.mode, createNodeFsLike());
  const venues = await readVenues(environment.venuesPath);
  const rules = createRulesAdapter({
    clock,
    venueData: venues.data,
    eventWindow: async () => {
      const known = await snapshot.read();
      if (known === undefined) {
        throw new CompassError('EventWindow');
      }
      return known.eventWindow;
    },
  });
  return {
    rules,
    snapshot,
    clock,
    catalog: () => readCachedCatalog(catalogDir, EVENT_ID, realFs),
  };
}
