// The Runtime: everything a handler may touch, built once at start-up (design,
// Architecture, Runtime and ports). createRuntime(env) picks live or simulated; tests
// pass fakes. Nothing in a handler imports another stream directly.

import type { Clock } from './clock.js';
import type { EventsPort } from './events-port.js';
import type { ScanFs, SpecFs } from './fs-ports.js';
import type { Logger } from './logger.js';
import type { PassesPort } from './passes-port.js';
import type { RulesPort } from './rules-port.js';
import type { SnapshotStore } from '../state/schedule-snapshot.js';

/** The ports and settings behind every tool handler. */
export interface Runtime {
  mode: 'live' | 'simulated';
  version: string;
  events: EventsPort;
  rules: RulesPort;
  passes: PassesPort;
  snapshot: SnapshotStore;
  scanFs: ScanFs;
  specFs: SpecFs;
  clock: Clock;
  logger: Logger;
  cwd: string;
}
