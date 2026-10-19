import type { ScanFs, SpecFs } from '../../src/ports/fs-ports.js';
import type { CatalogView } from '../../src/ports/events-port.js';
import type { Runtime } from '../../src/ports/runtime.js';
import type { ScheduleSnapshot, SnapshotStore } from '../../src/state/schedule-snapshot.js';
import { createStderrLogger } from '../../src/logging/stderr-logger.js';
import { fixedClock } from './fake-clock.js';
import type { FixedClock } from './fake-clock.js';
import { FakeEvents } from './fake-events.js';
import { FakePasses } from './fake-passes.js';
import { FakeRules } from './fake-rules.js';

/** An in-memory snapshot store that records every write. */
export class MemorySnapshotStore implements SnapshotStore {
  readonly writes: ScheduleSnapshot[] = [];
  current: ScheduleSnapshot | undefined;
  removed = 0;

  write(snapshot: ScheduleSnapshot): Promise<void> {
    this.writes.push(snapshot);
    this.current = snapshot;
    return Promise.resolve();
  }

  read(): Promise<ScheduleSnapshot | undefined> {
    return Promise.resolve(this.current);
  }

  remove(): Promise<void> {
    this.current = undefined;
    this.removed += 1;
    return Promise.resolve();
  }
}

const unusedScanFs: ScanFs = {
  realpath: () => Promise.reject(new Error('scanFs not provided')),
  lstat: () => Promise.reject(new Error('scanFs not provided')),
  readdir: () => Promise.reject(new Error('scanFs not provided')),
  readFile: () => Promise.reject(new Error('scanFs not provided')),
};

const unusedSpecFs: SpecFs = {
  exists: () => Promise.reject(new Error('specFs not provided')),
  isDirectory: () => Promise.reject(new Error('specFs not provided')),
  readText: () => Promise.reject(new Error('specFs not provided')),
  writeText: () => Promise.reject(new Error('specFs not provided')),
  mkdirp: () => Promise.reject(new Error('specFs not provided')),
};

/** Everything a test needs to drive and inspect a server. */
export interface FakeRuntime {
  runtime: Runtime;
  events: FakeEvents;
  rules: FakeRules;
  passes: FakePasses;
  snapshot: MemorySnapshotStore;
  clock: FixedClock;
  /** Everything the logger wrote to its stderr stream. */
  stderr: string[];
}

/** Options for createFakeRuntime. */
export interface FakeRuntimeOptions {
  catalog?: CatalogView;
  scanFs?: ScanFs;
  specFs?: SpecFs;
  cwd?: string;
  mode?: 'live' | 'simulated';
  /** Read-only live mode (compass-power task 37). */
  readOnly?: boolean;
}

/** Builds a Runtime made only of recording fakes. */
export function createFakeRuntime(options: FakeRuntimeOptions = {}): FakeRuntime {
  const events = new FakeEvents(options.catalog);
  const rules = new FakeRules();
  const passes = new FakePasses();
  const snapshot = new MemorySnapshotStore();
  const clock = fixedClock();
  const stderr: string[] = [];
  const runtime: Runtime = {
    mode: options.mode ?? 'simulated',
    ...(options.readOnly === true ? { readOnly: true } : {}),
    version: '0.0.0',
    events,
    rules,
    passes,
    snapshot,
    scanFs: options.scanFs ?? unusedScanFs,
    specFs: options.specFs ?? unusedSpecFs,
    clock,
    logger: createStderrLogger({
      write: (chunk) => {
        stderr.push(chunk);
      },
    }),
    cwd: options.cwd ?? '/workspace',
  };
  return { runtime, events, rules, passes, snapshot, clock, stderr };
}
