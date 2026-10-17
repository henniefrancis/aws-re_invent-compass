import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeAppFileSystem } from '../../src/adapters/node-fs-adapter.js';
import { createPassesFactory } from '../../src/runtime/passes-factory.js';
import { createInProcessPassService } from '../../src/simulated/in-process-pass-service.js';
import { fixedClock } from '../support/fake-clock.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { fakeIdToken } from '../support/simulated-stack.js';
import { TRIPLE } from '../support/triple.js';

const WINDOW = {
  start: '2026-11-29T00:00:00-08:00',
  end: '2026-12-05T23:59:00-08:00',
  timezone: 'America/Los_Angeles',
};

describe('createPassesFactory', () => {
  let temp: string;
  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), 'compass-factory-'));
  });
  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  const deps = (
    overrides: { allowedHosts?: string[]; simulated?: boolean; attendeeName?: string } = {},
  ) => ({
    idToken: { getIdToken: () => Promise.resolve(fakeIdToken()) },
    fs: createNodeAppFileSystem(),
    appData: { resolve: () => join(temp, 'reinvent-compass') },
    clock: { now: () => new Date('2026-11-29T18:00:00-08:00'), sleep: () => Promise.resolve() },
    connections: { walkMinutes: () => 5 },
    eventWindow: () => Promise.resolve(WINDOW),
    allowedHosts: overrides.allowedHosts ?? ['compass.invalid'],
    simulated: overrides.simulated ?? true,
    ...(overrides.attendeeName === undefined ? {} : { attendeeName: overrides.attendeeName }),
  });

  test('builds a working passes port, with or without an attendee name', async () => {
    const service = createInProcessPassService({
      clock: fixedClock('2026-11-29T18:00:00-08:00'),
      eventWindow: WINDOW,
      random: (n) => randomBytes(n),
      uuid: () => randomUUID(),
    });
    const session = syntheticCatalogView().byId.get(TRIPLE.a)?.session;
    if (session === undefined) throw new Error('missing session');
    for (const attendeeName of [undefined, 'Alex Gupta']) {
      const passes = createPassesFactory(deps(attendeeName === undefined ? {} : { attendeeName }))(
        service.transport,
        'https://compass.invalid',
      );
      const issued = await passes.issue([session], { sessions: [session], personalTime: [] });
      expect(issued).toHaveLength(1);
    }
  });

  test('the ID token can only go to an allowed host: a base URL outside the list is refused', () => {
    const service = createInProcessPassService({
      clock: fixedClock('2026-11-29T18:00:00-08:00'),
      eventWindow: WINDOW,
      random: (n) => randomBytes(n),
      uuid: () => randomUUID(),
    });
    expect(() =>
      createPassesFactory(deps({ allowedHosts: ['other.example'], simulated: false }))(
        service.transport,
        'https://compass.invalid',
      ),
    ).toThrow();
  });
});
