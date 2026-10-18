// The simulated runtime factory (task 12.3; Requirements 16.5, 22.1, 23.1; CTO review M7).
//
// It composes a Runtime from injected port implementations, the In_Process_Pass_Service and
// the `simulated` app-data subfolder. The real S1, S2 and S4 adapters are plugged in by the
// caller (task 26). The clock is pinned at 2026-11-29T18:00:00-08:00 so the demo, the hand-off
// expiry and the snapshot age are the same on every run. Nothing here opens a socket.

import { randomBytes, randomUUID } from 'node:crypto';
import type { Clock } from '../ports/clock.js';
import type { EventsPort } from '../ports/events-port.js';
import type { ScanFs, SpecFs } from '../ports/fs-ports.js';
import type { FileSystem } from '@compass/core/passes';
import type { HttpTransport } from '../ports/http-transport.js';
import type { Logger } from '../ports/logger.js';
import type { PassesPort } from '../ports/passes-port.js';
import type { Runtime } from '../ports/runtime.js';
import type { RulesPort } from '../ports/rules-port.js';
import { createSnapshotStore } from '../state/schedule-snapshot.js';
import { createInProcessPassService, SIMULATED_HOST } from './in-process-pass-service.js';
import type { InProcessPassService } from './in-process-pass-service.js';

/** The pinned demo instant. */
export const SIMULATED_NOW = '2026-11-29T18:00:00-08:00';

/** The base URL given to the pass client in simulated mode. It can never resolve. */
export const SIMULATED_BASE_URL = `https://${SIMULATED_HOST}`;

/** What the simulated runtime is built from. */
export interface SimulatedRuntimeDeps {
  version: string;
  cwd: string;
  logger: Logger;
  events: EventsPort;
  rules: RulesPort;
  /** Builds the S4 passes port over the given transport and base URL. */
  createPasses(transport: HttpTransport, baseUrl: string): PassesPort;
  scanFs: ScanFs;
  specFs: SpecFs;
  appDataDir: string;
  /** The file system the schedule snapshot is written through. */
  fs: FileSystem;
  scanRunner?: Runtime['scanRunner'];
  random?: (bytes: number) => Uint8Array;
  uuid?: () => string;
}

/** The runtime and the pass service behind it (tests read its state). */
export interface SimulatedRuntime {
  runtime: Runtime;
  passService: InProcessPassService;
}

/** The pinned clock. */
export function pinnedClock(): Clock {
  return { now: () => new Date(SIMULATED_NOW) };
}

/** Composes the simulated runtime. */
export async function createSimulatedRuntime(
  deps: SimulatedRuntimeDeps,
): Promise<SimulatedRuntime> {
  const clock = pinnedClock();
  const passService = createInProcessPassService({
    clock,
    eventWindow: await deps.events.eventWindow(),
    random: deps.random ?? ((bytes) => randomBytes(bytes)),
    uuid: deps.uuid ?? (() => randomUUID()),
  });
  return {
    passService,
    runtime: {
      mode: 'simulated',
      version: deps.version,
      events: deps.events,
      rules: deps.rules,
      passes: deps.createPasses(passService.transport, SIMULATED_BASE_URL),
      snapshot: createSnapshotStore(deps.appDataDir, 'simulated', deps.fs),
      scanFs: deps.scanFs,
      specFs: deps.specFs,
      clock,
      logger: deps.logger,
      cwd: deps.cwd,
      ...(deps.scanRunner === undefined ? {} : { scanRunner: deps.scanRunner }),
    },
  };
}
