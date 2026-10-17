import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeScanFs } from '@compass/core/scanner';
import { VenueDataSchema } from '@compass/core/rules';
import { createNodeSpecFs } from '@compass/core/spec';
import { createNodeAppFileSystem } from '../../src/adapters/node-fs-adapter.js';
import { createRulesAdapter } from '../../src/adapters/rules-adapter.js';
import { createStderrLogger } from '../../src/logging/stderr-logger.js';
import { createPassesFactory } from '../../src/runtime/passes-factory.js';
import type { Runtime } from '../../src/ports/runtime.js';
import type { InProcessPassService } from '../../src/simulated/in-process-pass-service.js';
import { createSimulatedRuntime, pinnedClock } from '../../src/simulated/simulated-runtime.js';
import { createNodeFsLike } from '../../src/state/node-fs-like.js';
import { FakeEvents } from './fake-events.js';
import { repoRoot, syntheticCatalogView } from './fake-catalog.js';

/** A jwt-shaped ID token with token_use id, the shape S4's client insists on. */
export function fakeIdToken(): string {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ token_use: 'id', sub: 'test' })}.c2ln`;
}

/** The simulated composition with the real S2 rules and the real S4 passes. S1 is a fake until it merges. */
export interface SimulatedStack {
  runtime: Runtime;
  events: FakeEvents;
  passService: InProcessPassService;
  stderr: string[];
  /** A temporary workspace holding a copy of the sample repo. */
  workspace: string;
  appDataDir: string;
  cleanup(): Promise<void>;
}

/** Builds the stack in a temporary folder. */
export async function buildSimulatedStack(): Promise<SimulatedStack> {
  const temp = await mkdtemp(join(tmpdir(), 'compass-stack-'));
  const workspace = join(temp, 'workspace');
  await mkdir(workspace, { recursive: true });
  await cp(join(repoRoot(), 'fixtures', 'sample-repo'), workspace, { recursive: true });
  const appDataDir = join(temp, 'reinvent-compass');
  const events = new FakeEvents(syntheticCatalogView());
  const venueData = VenueDataSchema.parse(
    JSON.parse(await readFile(join(repoRoot(), 'data', 'venues.json'), 'utf8')),
  );
  const clock = pinnedClock();
  const rules = createRulesAdapter({
    clock,
    venueData,
    eventWindow: () => Promise.resolve(events.window),
  });
  const stderr: string[] = [];
  const { runtime, passService } = await createSimulatedRuntime({
    version: '0.0.0',
    cwd: workspace,
    logger: createStderrLogger({
      write: (chunk) => {
        stderr.push(chunk);
      },
    }),
    events,
    rules,
    createPasses: createPassesFactory({
      idToken: { getIdToken: () => Promise.resolve(fakeIdToken()) },
      fs: createNodeAppFileSystem(),
      appData: { resolve: () => appDataDir },
      clock: { now: () => clock.now(), sleep: () => Promise.resolve() },
      connections: { walkMinutes: (from, to) => rules.walkMinutes(from, to) },
      eventWindow: () => Promise.resolve(events.window),
      allowedHosts: ['compass.invalid'],
      simulated: true,
    }),
    scanFs: createNodeScanFs(),
    specFs: createNodeSpecFs(),
    appDataDir,
    fsLike: createNodeFsLike(),
  });
  return {
    runtime,
    events,
    passService,
    stderr,
    workspace,
    appDataDir,
    cleanup: () => rm(temp, { recursive: true, force: true }),
  };
}
