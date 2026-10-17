import { describe, expect, test } from 'vitest';
import {
  createAppDataResolver,
  joinInFolder,
  RECORD_FILE_NAME,
} from '../../src/passes/app-data.js';
import type { Clock } from '../../src/passes/interfaces.js';
import type { IssuedPass, IssuedPassRecord } from '../../src/passes/models.js';
import {
  BACKUP_FILE_NAME,
  createPassStore,
  LOCK_FILE_NAME,
  STALE_LOCK_MS,
  TEMP_FILE_NAME,
} from '../../src/passes/pass-store.js';
import { PassError } from '../../src/passes/redaction.js';
import { memoryFs, type FsOperation, type MemoryFs } from './memory-fs.js';

// Review round 1: atomic writes, one backup, duplicate handling, the in-process mutex and the
// cross-process lock file (QA M3, M4, M5 and security L1).

const appData = createAppDataResolver({
  platform: 'linux',
  env: { XDG_DATA_HOME: '/home/ada/.local/share' },
  homeDir: '/home/ada',
});
const ROOT = appData.resolve();
const RECORD = joinInFolder(ROOT, RECORD_FILE_NAME);
const BACKUP = joinInFolder(ROOT, BACKUP_FILE_NAME);
const TEMP = joinInFolder(ROOT, TEMP_FILE_NAME);
const LOCK = joinInFolder(ROOT, LOCK_FILE_NAME);
/** A lock held by another live process, last refreshed at the stepped clock's start. */
const OTHER_LOCK = 'other-owner-token 1000000';

function pass(code: string, serialSuffix: number, hash = 'a'): IssuedPass {
  return {
    serialNumber: `00000000-0000-4000-8000-${String(serialSuffix).padStart(12, '0')}`,
    sessionCode: code,
    fieldsHash: hash.repeat(64),
    platforms: ['apple'],
  };
}

/** A clock whose time moves only when something sleeps, with a hook per sleep. */
function steppedClock(startMs: number, onSleep: (count: number) => void = () => undefined) {
  const state = { now: startMs, sleeps: [] as number[] };
  const clock: Clock = {
    now: () => new Date(state.now),
    sleep(ms: number) {
      state.sleeps.push(ms);
      state.now += ms;
      onSleep(state.sleeps.length);
      return Promise.resolve();
    },
  };
  return { clock, state };
}

function storeOn(fs: MemoryFs, clock: Clock = steppedClock(1_000_000).clock) {
  return createPassStore({ appData, fs, clock });
}

async function failureOf(promise: Promise<unknown>): Promise<PassError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PassError);
    return error as PassError;
  }
  throw new Error('expected the call to fail');
}

describe('Feature: boarding-passes, atomic record writes with one backup (QA M3)', () => {
  test('a write goes to a temporary file, keeps the previous record as the only .bak, then renames', async () => {
    const fs = memoryFs();
    const store = storeOn(fs);
    await store.write({ passes: [pass('AAA1', 1)] });
    expect(fs.files.has(BACKUP)).toBe(false);

    fs.ops.length = 0;
    await store.write({ passes: [pass('AAA1', 1), pass('BBB2', 2)] });
    const writes = fs.ops.filter((op) => /^(writeFile|rename|readFile) /.test(op));
    expect(writes).toEqual([
      `writeFile ${TEMP}`,
      `readFile ${RECORD}`,
      `writeFile ${BACKUP}`,
      `rename ${TEMP} ${RECORD}`,
      `readFile ${LOCK}`, // the release checks the lock is still ours
    ]);
    expect(fs.files.has(TEMP)).toBe(false);
    expect(JSON.parse(fs.files.get(BACKUP) ?? '{}')).toEqual({ passes: [pass('AAA1', 1)] });
    expect(fs.modes.get(BACKUP)).toBe(0o600);

    await store.write({ passes: [] });
    expect(JSON.parse(fs.files.get(BACKUP) ?? '{}')).toEqual({
      passes: [pass('AAA1', 1), pass('BBB2', 2)],
    });
    expect([...fs.files.keys()].sort()).toEqual([BACKUP, RECORD].sort());
  });

  test('the folder is created with mode 0700 and the files with mode 0600', async () => {
    const fs = memoryFs();
    await storeOn(fs).write({ passes: [pass('AAA1', 1)] });
    expect(fs.dirModes.get(ROOT)).toBe(0o700);
    expect(fs.modes.get(RECORD)).toBe(0o600);
  });

  test('a failed write leaves the previous record intact and removes the temporary file', async () => {
    for (const operation of ['writeFile', 'rename'] as const) {
      const fs = memoryFs();
      const store = storeOn(fs);
      await store.write({ passes: [pass('AAA1', 1)] });
      const before = fs.files.get(RECORD);
      fs.failing.add(operation);
      const error = await failureOf(store.write({ passes: [pass('BBB2', 2)] }));
      expect(error.code).toBe('store.write_failed');
      expect(error.message).not.toContain('example.com');
      fs.failing.delete(operation);
      expect(fs.files.get(RECORD)).toBe(before);
      expect(fs.files.has(TEMP)).toBe(false);
      expect(fs.files.has(LOCK)).toBe(false);
    }
  });

  test('a failure that also stops the cleanup and the lock release is still the fixed write error', async () => {
    const fs = memoryFs();
    const store = storeOn(fs);
    await store.write({ passes: [] });
    // Let the lock be taken, then make every removal and the rename fail.
    fs.failing.add('rename');
    fs.failing.add('remove');
    const error = await failureOf(store.write({ passes: [pass('AAA1', 1)] }));
    expect(error.code).toBe('store.write_failed');
  });

  test('deleteRecord removes the record, the backup and any temporary file', async () => {
    const fs = memoryFs({ [TEMP]: 'x' });
    const store = storeOn(fs);
    await store.write({ passes: [pass('AAA1', 1)] });
    await store.write({ passes: [pass('AAA1', 1)] });
    expect(fs.files.has(BACKUP)).toBe(true);
    await store.deleteRecord();
    expect([...fs.files.keys()]).toEqual([]);
  });

  test('the corrupt-record error names the recovery step and no path', async () => {
    const fs = memoryFs({ [RECORD]: '{broken' });
    const error = await failureOf(storeOn(fs).read());
    expect(error.code).toBe('store.corrupt_record');
    expect(error.message).toContain('forget_me');
    expect(error.message).toContain('issued-pass-record.json.bak');
    expect(error.message).not.toContain('/home');
  });
});

describe('Feature: boarding-passes, one entry per session code on read (QA M5)', () => {
  test('duplicates are dropped keeping the newest, and the older ones are reported', async () => {
    const older = pass('AAA1', 1, 'a');
    const newer = pass('AAA1', 2, 'b');
    const other = pass('BBB2', 3);
    const fs = memoryFs({ [RECORD]: JSON.stringify({ passes: [older, other, newer] }) });
    const store = storeOn(fs);
    expect(await store.read()).toEqual({ passes: [newer, other] });
    expect(await store.readWithSuperseded()).toEqual({
      record: { passes: [newer, other] },
      superseded: [older],
    });
  });

  test('a record without duplicates reports nothing superseded', async () => {
    const fs = memoryFs({ [RECORD]: JSON.stringify({ passes: [pass('AAA1', 1)] }) });
    expect((await storeOn(fs).readWithSuperseded()).superseded).toEqual([]);
  });
});

describe('Feature: boarding-passes, in-process mutex (QA M4)', () => {
  test('overlapping locked runs on two store instances never interleave', async () => {
    const fs = memoryFs();
    const first = storeOn(fs);
    const second = storeOn(fs);
    const events: string[] = [];
    const run = (name: string, store: typeof first) =>
      store.withLock(async () => {
        events.push(`${name} start`);
        await Promise.resolve();
        await Promise.resolve();
        events.push(`${name} end`);
      });
    await Promise.all([run('a', first), run('b', second), run('c', first)]);
    expect(events).toEqual(['a start', 'a end', 'b start', 'b end', 'c start', 'c end']);
  });

  test('a run that throws releases the lock for the next one', async () => {
    const fs = memoryFs();
    const store = storeOn(fs);
    await expect(store.withLock(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(fs.files.has(LOCK)).toBe(false);
    await expect(store.withLock(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  test('code inside withLock can read and write without deadlocking on its own lock', async () => {
    const fs = memoryFs();
    const store = storeOn(fs);
    await store.withLock(async () => {
      expect(fs.files.has(LOCK)).toBe(true);
      await store.write({ passes: [pass('AAA1', 1)] });
      await store.deleteRecord();
      expect(await store.read()).toEqual({ passes: [] });
    });
    expect(fs.files.has(LOCK)).toBe(false);
    expect(fs.modes.has(LOCK)).toBe(true);
  });
});

describe('Feature: boarding-passes, cross-process lock file with a stale timeout (QA M4)', () => {
  test('a held lock is waited for and taken once the other process lets go', async () => {
    const fs = memoryFs({ [LOCK]: OTHER_LOCK });
    const { clock, state } = steppedClock(1_000_000, (count) => {
      if (count === 3) fs.files.delete(LOCK);
    });
    let ran = false;
    await storeOn(fs, clock).withLock(() => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(true);
    expect(state.sleeps).toEqual([100, 100, 100]);
    expect(fs.files.has(LOCK)).toBe(false);
  });

  test('a lock older than two minutes, or with unreadable content, is taken over', async () => {
    for (const content of [
      `other-owner-token ${String(1_000_000 - STALE_LOCK_MS - 1)}`,
      'garbage',
      '',
    ]) {
      const fs = memoryFs({ [LOCK]: content });
      const { clock, state } = steppedClock(1_000_000);
      await storeOn(fs, clock).withLock(() => Promise.resolve());
      expect(state.sleeps).toEqual([]);
      expect(fs.ops).toContain(`remove ${LOCK}`);
    }
  });

  test('a lock exactly at the timeout is still held', async () => {
    const fs = memoryFs({ [LOCK]: `other-owner-token ${String(1_000_000 - STALE_LOCK_MS)}` });
    const { clock, state } = steppedClock(1_000_000, (count) => {
      if (count === 1) fs.files.delete(LOCK);
    });
    await storeOn(fs, clock).withLock(() => Promise.resolve());
    expect(state.sleeps).toEqual([100]);
  });

  test('a lock that never frees up ends in store.locked after a bounded wait', async () => {
    const fs = memoryFs({ [LOCK]: OTHER_LOCK });
    // Time barely moves, so the lock never goes stale during the wait.
    const sleeps: number[] = [];
    const clock: Clock = {
      now: () => new Date(1_000_000),
      sleep(ms) {
        sleeps.push(ms);
        return Promise.resolve();
      },
    };
    const error = await failureOf(storeOn(fs, clock).withLock(() => Promise.resolve()));
    expect(error.code).toBe('store.locked');
    expect(sleeps).toHaveLength(100);
  });

  test('a lock released between the create attempt and the read is retried at once', async () => {
    const fs = memoryFs();
    const real = fs.createExclusive.bind(fs);
    let first = true;
    fs.createExclusive = (path, data, mode) => {
      if (first) {
        first = false;
        return Promise.resolve(false); // somebody held it, but it is gone when we look
      }
      return real(path, data, mode);
    };
    const { clock, state } = steppedClock(1_000_000);
    await storeOn(fs, clock).withLock(() => Promise.resolve());
    expect(state.sleeps).toEqual([]);
  });

  test('filesystem failures while locking are fixed lock errors that name no path', async () => {
    const cases: [FsOperation[], MemoryFs][] = [
      [['ensureDir'], memoryFs()],
      [['createExclusive'], memoryFs()],
      [['readFile'], memoryFs({ [LOCK]: OTHER_LOCK })],
      [['remove'], memoryFs({ [LOCK]: 'garbage' })],
    ];
    for (const [failing, fs] of cases) {
      for (const operation of failing) fs.failing.add(operation);
      const error = await failureOf(storeOn(fs).withLock(() => Promise.resolve()));
      expect(error.code).toBe('store.lock_failed');
      expect(error.message).not.toContain('/home');
      expect(error.message).not.toContain('example.com');
    }
  });

  test('a failure to release the lock does not hide the result of the run', async () => {
    const fs = memoryFs();
    const store = storeOn(fs);
    const result = await store.withLock(() => {
      fs.failing.add('remove');
      return Promise.resolve('done');
    });
    expect(result).toBe('done');
    expect(fs.files.has(LOCK)).toBe(true); // left behind, and stale after two minutes
  });
});

describe('Feature: boarding-passes, Windows app-data folder (security L1)', () => {
  test('LOCALAPPDATA is preferred, then an absolute APPDATA, then the home AppData Local', () => {
    const resolve = (env: Record<string, string | undefined>) =>
      createAppDataResolver({ platform: 'win32', env, homeDir: 'C:\\Users\\Ada' }).resolve();
    expect(resolve({ LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\R' })).toBe('C:\\L\\reinvent-compass');
    expect(resolve({ APPDATA: 'C:\\R' })).toBe('C:\\R\\reinvent-compass');
    expect(resolve({ LOCALAPPDATA: 'relative\\dir', APPDATA: 'C:\\R' })).toBe(
      'C:\\R\\reinvent-compass',
    );
    expect(resolve({ APPDATA: 'roaming-relative' })).toBe(
      'C:\\Users\\Ada\\AppData\\Local\\reinvent-compass',
    );
    expect(resolve({ LOCALAPPDATA: '', APPDATA: '' })).toBe(
      'C:\\Users\\Ada\\AppData\\Local\\reinvent-compass',
    );
  });
});

describe('Feature: boarding-passes, store sanity with a record type', () => {
  test('a written record reads back unchanged', async () => {
    const record: IssuedPassRecord = { passes: [pass('AAA1', 1), pass('BBB2', 2)] };
    const store = storeOn(memoryFs());
    await store.write(record);
    expect(await store.read()).toEqual(record);
  });
});

describe('Feature: boarding-passes, lock ownership, heartbeat and takeover (QA N1, security N4)', () => {
  const TOKEN_A = 'owner-token-aaaa';

  function owned(fs: MemoryFs, clock: Clock = steppedClock(1_000_000).clock, token = TOKEN_A) {
    return createPassStore({ appData, fs, clock, newToken: () => token });
  }

  test('the lock file holds a random owner token and the time, and the default token is a UUID', async () => {
    const fs = memoryFs();
    const seen: string[] = [];
    await owned(fs).withLock(() => {
      seen.push(fs.files.get(LOCK) ?? '');
      return Promise.resolve();
    });
    expect(seen).toEqual([`${TOKEN_A} 1000000`]);
    const fresh = memoryFs();
    await createPassStore({ appData, fs: fresh, clock: steppedClock(1_000_000).clock }).withLock(
      () => {
        expect(fresh.files.get(LOCK)).toMatch(/^[0-9a-f-]{36} 1000000$/);
        return Promise.resolve();
      },
    );
  });

  test('release removes the lock only if it still holds our token', async () => {
    const fs = memoryFs();
    await owned(fs).withLock(() => {
      // Another process took the lock over while this run was stalled.
      fs.files.set(LOCK, 'taker-token-bbbb 1000050');
      return Promise.resolve();
    });
    expect(fs.files.get(LOCK)).toBe('taker-token-bbbb 1000050');
    expect(fs.ops.filter((op) => op === `remove ${LOCK}`)).toEqual([]);
  });

  test('a lock that vanished before release is fine', async () => {
    const fs = memoryFs();
    await owned(fs).withLock(() => {
      fs.files.delete(LOCK);
      return Promise.resolve();
    });
    expect(fs.files.has(LOCK)).toBe(false);
  });

  test('the heartbeat refreshes the timestamp inside the lock and does nothing outside it', async () => {
    const fs = memoryFs();
    const { clock, state } = steppedClock(1_000_000);
    const store = owned(fs, clock);
    fs.ops.length = 0;
    await store.heartbeat();
    expect(fs.ops).toEqual([]);
    await store.withLock(async () => {
      state.now += 240_000;
      await store.heartbeat();
      expect(fs.files.get(LOCK)).toBe(`${TOKEN_A} 1240000`);
      expect(fs.modes.get(LOCK)).toBe(0o600);
    });
  });

  test('a heartbeat after a takeover says the lock was lost and changes nothing', async () => {
    const fs = memoryFs();
    const store = owned(fs);
    await store.withLock(async () => {
      fs.files.set(LOCK, 'taker-token-bbbb 1000050');
      const error = await failureOf(store.heartbeat());
      expect(error.code).toBe('store.lock_lost');
      expect(fs.files.get(LOCK)).toBe('taker-token-bbbb 1000050');
      fs.files.delete(LOCK);
      expect((await failureOf(store.heartbeat())).code).toBe('store.lock_lost');
    });
  });

  test('a heartbeat whose read or write fails is a fixed lock error', async () => {
    for (const operation of ['readFile', 'writeFile'] as const) {
      const fs = memoryFs();
      const store = owned(fs);
      await store.withLock(async () => {
        fs.failing.add(operation);
        const error = await failureOf(store.heartbeat());
        expect(error.code).toBe('store.lock_failed');
        expect(error.message).not.toContain('example.com');
        fs.failing.clear();
      });
    }
  });

  test('a refreshed lock is live where the same lock unrefreshed would be stale', async () => {
    // Eleven minutes after the lock was taken, but only two after its last heartbeat.
    const refreshed = memoryFs({ [LOCK]: 'holder-token-aaaa 1540000' });
    const waiting = steppedClock(1_660_000, (count) => {
      if (count === 2) refreshed.files.delete(LOCK);
    });
    await owned(refreshed, waiting.clock).withLock(() => Promise.resolve());
    expect(waiting.state.sleeps).toEqual([100, 100]);

    const unrefreshed = memoryFs({ [LOCK]: 'holder-token-aaaa 1000000' });
    const taking = steppedClock(1_660_000);
    await owned(unrefreshed, taking.clock).withLock(() => Promise.resolve());
    expect(taking.state.sleeps).toEqual([]);
  });

  test('a takeover re-reads and compares the lock, and leaves it alone if it changed meanwhile', async () => {
    const fs = memoryFs({ [LOCK]: 'old-owner-token 0' });
    const realRead = fs.readFile.bind(fs);
    let reads = 0;
    fs.readFile = async (path) => {
      if (path === LOCK) {
        reads += 1;
        if (reads === 2) {
          // Between our two looks, the owner refreshed (or another process took over).
          fs.files.set(LOCK, 'new-owner-token 1000000');
          return realRead(path).then(() => 'new-owner-token 1000000');
        }
      }
      return realRead(path);
    };
    const { clock, state } = steppedClock(1_000_000, (count) => {
      if (count === 1) fs.files.delete(LOCK);
    });
    await owned(fs, clock).withLock(() => Promise.resolve());
    // The only removal is our own release at the end; the takeover never removed the new lock.
    expect(fs.ops.filter((op) => op === `remove ${LOCK}`)).toEqual([`remove ${LOCK}`]);
    expect(state.sleeps).toEqual([100]);
  });

  test('a lock with garbage content and a recent file time is not stale; an old one is', async () => {
    const fresh = memoryFs({ [LOCK]: 'garbage' });
    fresh.mtimes.set(LOCK, 1_000_000 - 1_000);
    const first = steppedClock(1_000_000, (count) => {
      if (count === 2) fresh.files.delete(LOCK);
    });
    await owned(fresh, first.clock).withLock(() => Promise.resolve());
    expect(first.state.sleeps).toEqual([100, 100]);

    const old = memoryFs({ [LOCK]: '' });
    old.mtimes.set(LOCK, 1_000_000 - STALE_LOCK_MS - 1);
    const second = steppedClock(1_000_000);
    await owned(old, second.clock).withLock(() => Promise.resolve());
    expect(second.state.sleeps).toEqual([]);
    expect(old.ops).toContain(`remove ${LOCK}`);
  });

  test('a lock whose file vanished while its time was read is retried at once', async () => {
    const fs = memoryFs({ [LOCK]: 'garbage' });
    fs.mtimeMs = () => {
      fs.files.delete(LOCK);
      return Promise.resolve(undefined);
    };
    const { clock, state } = steppedClock(1_000_000);
    await owned(fs, clock).withLock(() => Promise.resolve());
    expect(state.sleeps).toEqual([]);
  });

  test('a failure reading the file time is a fixed lock error', async () => {
    const fs = memoryFs({ [LOCK]: 'garbage' });
    fs.failing.add('mtimeMs');
    expect((await failureOf(owned(fs).withLock(() => Promise.resolve()))).code).toBe(
      'store.lock_failed',
    );
  });
});
