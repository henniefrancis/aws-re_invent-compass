import { describe, expect, test } from 'vitest';
import { join } from 'node:path';
import type { FileSystem } from '@compass/core/passes';
import type { HttpTransport } from '../../src/ports/http-transport.js';
import {
  createSimulatedRuntime,
  pinnedClock,
  SIMULATED_BASE_URL,
  SIMULATED_NOW,
} from '../../src/simulated/simulated-runtime.js';
import { createStderrLogger } from '../../src/logging/stderr-logger.js';
import { installNetworkGuard } from '../support/network-guard.js';
import { FakeEvents } from '../support/fake-events.js';
import { FakePasses } from '../support/fake-passes.js';
import { FakeRules } from '../support/fake-rules.js';

function recordingFs() {
  const files = new Map<string, string>();
  const fs: FileSystem = {
    ensureDir: () => Promise.resolve(),
    writeFile: (path, data) => {
      files.set(path, data);
      return Promise.resolve();
    },
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
      return Promise.resolve();
    },
    readFile: (path) => Promise.resolve(files.get(path)),
    remove: () => Promise.resolve(),
    createExclusive: () => Promise.resolve(true),
    mtimeMs: () => Promise.resolve(undefined),
  };
  return { fs, files };
}

const AUTH = { Authorization: 'Bearer x' };

describe('createSimulatedRuntime', () => {
  test('composes a simulated runtime with a pinned clock and the in-process transport', async () => {
    const guard = installNetworkGuard();
    try {
      const { fs, files } = recordingFs();
      let seen: { transport: HttpTransport; baseUrl: string } | undefined;
      const { runtime, passService } = await createSimulatedRuntime({
        version: '1.2.3',
        cwd: '/work',
        logger: createStderrLogger({ write: () => undefined }),
        events: new FakeEvents(),
        rules: new FakeRules(),
        createPasses: (transport, baseUrl) => {
          seen = { transport, baseUrl };
          return new FakePasses();
        },
        scanFs: createUnused(),
        specFs: createUnusedSpec(),
        appDataDir: '/app',
        fs,
        random: (n) => new Uint8Array(n).fill(7),
        uuid: () => '00000000-0000-4000-8000-000000000001',
      });
      expect(runtime.mode).toBe('simulated');
      expect(runtime.version).toBe('1.2.3');
      expect(runtime.cwd).toBe('/work');
      expect(runtime.clock.now().toISOString()).toBe(new Date(SIMULATED_NOW).toISOString());
      expect(pinnedClock().now().getTime()).toBe(Date.parse('2026-11-29T18:00:00-08:00'));
      expect(seen?.baseUrl).toBe(SIMULATED_BASE_URL);
      expect(seen?.transport).toBe(passService.transport);

      await runtime.snapshot.write({
        version: 1,
        mode: 'simulated',
        fetchedAt: SIMULATED_NOW,
        eventWindow: { start: 'a', end: 'b', timezone: 'c' },
        schedule: { reserved: [], favorites: [], personalTime: [] },
      });
      expect([...files.keys()]).toEqual(
        [join('/app', 'simulated', 'schedule-snapshot.json.0.tmp')].map(() =>
          join('/app', 'simulated', 'schedule-snapshot.json'),
        ),
      );

      const issued = await passService.transport.request({
        method: 'POST',
        url: `${SIMULATED_BASE_URL}/api/v1/passes`,
        headers: AUTH,
        body: JSON.stringify({
          platforms: ['apple'],
          passes: [
            {
              sessionCode: 'ANT163',
              title: 'Identity',
              venue: 'Encore',
              room: 'R1',
              startsAt: '2026-12-01T10:00:00-08:00',
              endsAt: '2026-12-01T11:00:00-08:00',
            },
          ],
        }),
      });
      expect(issued.body).toContain('00000000-0000-4000-8000-000000000001');
      expect(guard.attempts).toEqual([]);
    } finally {
      guard.restore();
    }
  });

  test('uses real randomness when none is injected', async () => {
    const { fs } = recordingFs();
    const { passService } = await createSimulatedRuntime({
      version: '0',
      cwd: '/',
      logger: createStderrLogger({ write: () => undefined }),
      events: new FakeEvents(),
      rules: new FakeRules(),
      createPasses: () => new FakePasses(),
      scanFs: createUnused(),
      specFs: createUnusedSpec(),
      appDataDir: '/app',
      fs,
    });
    const issue = {
      method: 'POST',
      url: `${SIMULATED_BASE_URL}/api/v1/passes`,
      headers: AUTH,
      body: JSON.stringify({
        platforms: ['apple'],
        passes: [
          {
            sessionCode: 'A1',
            title: 'T',
            venue: '',
            room: '',
            startsAt: '2026-12-01T10:00:00-08:00',
            endsAt: '2026-12-01T11:00:00-08:00',
          },
        ],
      }),
    };
    const first = JSON.parse((await passService.transport.request(issue)).body) as {
      passes: { serialNumber: string }[];
    };
    const serial = String(first.passes[0]?.serialNumber);
    const handoff = await passService.transport.request({
      method: 'POST',
      url: `${SIMULATED_BASE_URL}/api/v1/handoffs`,
      headers: AUTH,
      body: JSON.stringify({
        serialNumbers: [serial],
        include: { apple: true, google: false, calendar: false },
      }),
    });
    const id = (JSON.parse(handoff.body) as { handoffId: string }).handoffId;
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

function createUnused() {
  const reject = (): Promise<never> => Promise.reject(new Error('unused'));
  return { realpath: reject, lstat: reject, readdir: reject, readFile: reject };
}

function createUnusedSpec() {
  const reject = (): Promise<never> => Promise.reject(new Error('unused'));
  return {
    exists: reject,
    isDirectory: reject,
    isSymlink: reject,
    readText: reject,
    createExclusive: reject,
    appendText: reject,
    mkdirp: reject,
  };
}
