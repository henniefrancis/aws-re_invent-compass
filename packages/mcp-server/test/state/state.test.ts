import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSwapLedger } from '../../src/guardrail/swap-ledger.js';
import { createNodeAppFileSystem } from '../../src/adapters/node-fs-adapter.js';
import { createSessionState } from '../../src/state/session-state.js';
import { createSnapshotStore, SNAPSHOT_FILE_NAME } from '../../src/state/schedule-snapshot.js';
import type { ScheduleSnapshot } from '../../src/state/schedule-snapshot.js';
import type { FileSystem } from '@compass/core/passes';
import { fixedClock } from '../support/fake-clock.js';

const SNAPSHOT: ScheduleSnapshot = {
  version: 1,
  mode: 'live',
  fetchedAt: '2026-11-30T16:00:00.000Z',
  eventWindow: {
    start: '2026-11-29T00:00:00-08:00',
    end: '2026-12-05T00:00:00-08:00',
    timezone: 'America/Los_Angeles',
  },
  schedule: { reserved: ['a'], favorites: [], personalTime: [] },
};

describe('swap ledger', () => {
  test('proposes, looks up, marks refused, clears and clears all', () => {
    const clock = fixedClock('2026-11-30T16:00:00.000Z');
    const ledger = createSwapLedger(clock);
    expect(ledger.forOriginal('a')).toBeUndefined();
    ledger.propose({ originalId: 'a', repeatId: 'a-r', blockedId: 'b' });
    expect(ledger.forOriginal('a')).toEqual({
      originalId: 'a',
      repeatId: 'a-r',
      blockedId: 'b',
      createdAt: '2026-11-30T16:00:00.000Z',
    });
    clock.set('2026-11-30T16:03:00.000Z');
    ledger.markRefused('a');
    expect(ledger.forOriginal('a')?.refusedAt).toBe('2026-11-30T16:03:00.000Z');
    ledger.markRefused('unknown');
    const copy = ledger.forOriginal('a');
    if (copy !== undefined) copy.repeatId = 'changed';
    expect(ledger.forOriginal('a')?.repeatId).toBe('a-r');
    ledger.propose({ originalId: 'c', repeatId: 'c-r', blockedId: 'd' });
    ledger.clear('a');
    expect(ledger.forOriginal('a')).toBeUndefined();
    ledger.clearAll();
    expect(ledger.forOriginal('c')).toBeUndefined();
  });
});

describe('snapshot store with a recording fs', () => {
  function recordingFs() {
    const files = new Map<string, string>();
    const calls: string[] = [];
    const fs: FileSystem = {
      ensureDir: (path, mode) => {
        calls.push(`mkdir ${path} ${mode.toString(8)}`);
        return Promise.resolve();
      },
      writeFile: (path, data, mode) => {
        calls.push(`write ${path} ${mode.toString(8)}`);
        files.set(path, data);
        return Promise.resolve();
      },
      rename: (from, to) => {
        calls.push(`rename ${from} ${to}`);
        const data = files.get(from);
        if (data !== undefined) files.set(to, data);
        files.delete(from);
        return Promise.resolve();
      },
      readFile: (path) => Promise.resolve(files.get(path)),
      remove: (path) => {
        calls.push(`remove ${path}`);
        files.delete(path);
        return Promise.resolve();
      },
      createExclusive: () => Promise.resolve(true),
      mtimeMs: () => Promise.resolve(undefined),
    };
    return { fs, files, calls };
  }

  test('writes atomically with restrictive modes, reads back and removes', async () => {
    const { fs, files, calls } = recordingFs();
    const store = createSnapshotStore('/data', 'live', fs, 42);
    expect(await store.read()).toBeUndefined();
    await store.write(SNAPSHOT);
    const target = join('/data', SNAPSHOT_FILE_NAME);
    expect(calls).toEqual([
      'mkdir /data 700',
      `write ${target}.42.tmp 600`,
      `rename ${target}.42.tmp ${target}`,
    ]);
    expect(await store.read()).toEqual(SNAPSHOT);
    expect(files.get(target)).not.toMatch(/token|email/i);
    await store.remove();
    expect(await store.read()).toBeUndefined();
  });

  test('simulated mode uses the simulated subfolder', async () => {
    const { fs, files } = recordingFs();
    const store = createSnapshotStore('/data', 'simulated', fs);
    await store.write({ ...SNAPSHOT, mode: 'simulated' });
    expect([...files.keys()]).toEqual([join('/data', 'simulated', SNAPSHOT_FILE_NAME)]);
  });

  test('corrupt or foreign content reads as missing', async () => {
    const { fs, files } = recordingFs();
    const store = createSnapshotStore('/data', 'live', fs);
    const target = join('/data', SNAPSHOT_FILE_NAME);
    files.set(target, '{ not json');
    expect(await store.read()).toBeUndefined();
    files.set(target, JSON.stringify({ version: 2 }));
    expect(await store.read()).toBeUndefined();
  });
});

describe('snapshot store on the real file system', () => {
  let temp: string;
  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'compass-snapshot-'));
  });
  afterAll(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  test('round trips, replaces atomically and removes', async () => {
    const store = createSnapshotStore(join(temp, 'app'), 'live', createNodeAppFileSystem(), 7);
    await store.write(SNAPSHOT);
    await store.write({ ...SNAPSHOT, fetchedAt: '2026-11-30T17:00:00.000Z' });
    expect((await store.read())?.fetchedAt).toBe('2026-11-30T17:00:00.000Z');
    const file = join(temp, 'app', SNAPSHOT_FILE_NAME);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 });
    await expect(stat(`${file}.7.tmp`)).rejects.toThrow();
    await store.remove();
    await store.remove();
    expect(await store.read()).toBeUndefined();
  });

  test.skipIf(process.platform === 'win32')(
    'the file is 0o600 and the directory 0o700 on POSIX',
    async () => {
      const store = createSnapshotStore(join(temp, 'posix'), 'live', createNodeAppFileSystem());
      await store.write(SNAPSHOT);
      expect((await stat(join(temp, 'posix', SNAPSHOT_FILE_NAME))).mode & 0o777).toBe(0o600);
      expect((await stat(join(temp, 'posix'))).mode & 0o777).toBe(0o700);
      await writeFile(join(temp, 'unused'), 'x');
    },
  );
});

describe('session state', () => {
  test('starts with no scan and just the swap ledger (the plan is written to the working directory, never to a scanned folder)', () => {
    const ledger = createSwapLedger(fixedClock());
    const state = createSessionState(ledger);
    expect(state).toEqual({ swaps: ledger });
    expect(state.lastScan).toBeUndefined();
  });
});

describe('the snapshot uses the production file system adapter (security L3)', () => {
  test('a link at the snapshot file, its temporary file or any folder from the app folder down is refused', async () => {
    for (const linked of ['reinvent-compass', 'schedule-snapshot.json.7.tmp', SNAPSHOT_FILE_NAME]) {
      const fs = createNodeAppFileSystem((path) =>
        Promise.resolve({
          isSymbolicLink: () => path.endsWith(linked),
          isDirectory: () => true,
        }),
      );
      const store = createSnapshotStore(join('/data', 'reinvent-compass'), 'live', fs, 7);
      await expect(store.write(SNAPSHOT), linked).rejects.toMatchObject({ code: 'UnsafePath' });
    }
  });
});
