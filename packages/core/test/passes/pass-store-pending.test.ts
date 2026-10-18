import { describe, expect, test } from 'vitest';
import {
  createAppDataResolver,
  joinInFolder,
  RECORD_FILE_NAME,
} from '../../src/passes/app-data.js';
import { createPassStore, PENDING_VOID_FILE_NAME } from '../../src/passes/pass-store.js';
import { PassError } from '../../src/passes/redaction.js';
import { memoryFs } from './memory-fs.js';
import { fakeClock } from './support.js';

// QA N2: the pending-void list in the store folder.

const appData = createAppDataResolver({
  platform: 'linux',
  env: { XDG_DATA_HOME: '/home/ada/.local/share' },
  homeDir: '/home/ada',
});
const PENDING = joinInFolder(appData.resolve(), PENDING_VOID_FILE_NAME);
const LOCK = joinInFolder(appData.resolve(), 'issued-pass-record.json.lock');
const SERIAL_A = '00000000-0000-4000-8000-000000000001';
const SERIAL_B = '00000000-0000-4000-8000-000000000002';

function rig(initial: Record<string, string> = {}) {
  const fs = memoryFs(initial);
  return { fs, store: createPassStore({ appData, fs, clock: fakeClock() }) };
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

describe('Feature: boarding-passes, the pending-void list (QA N2)', () => {
  test('it reads as empty when absent, round trips, drops duplicates and uses mode 0600 under the lock', async () => {
    const { fs, store } = rig();
    expect(await store.readPendingVoids()).toEqual([]);
    await store.writePendingVoids([SERIAL_A, SERIAL_B, SERIAL_A]);
    expect(await store.readPendingVoids()).toEqual([SERIAL_A, SERIAL_B]);
    expect(fs.modes.get(PENDING)).toBe(0o600);
    expect(fs.ops).toContain(`createExclusive ${LOCK}`);
  });

  test('writing an empty list removes the file', async () => {
    const { fs, store } = rig();
    await store.writePendingVoids([SERIAL_A]);
    await store.writePendingVoids([]);
    expect(fs.files.has(PENDING)).toBe(false);
  });

  test('a serial that is not a UUID is refused and nothing is written', async () => {
    const { fs, store } = rig();
    expect((await failureOf(store.writePendingVoids(['../../x']))).code).toBe(
      'store.invalid_record',
    );
    expect(fs.files.size).toBe(0);
  });

  test('a corrupt file names the recovery step and no path', async () => {
    for (const content of [
      'not json',
      '{"serials":["nope"]}',
      '{"serials":[],"email":"a@b.test"}',
    ]) {
      const { store } = rig({ [PENDING]: content });
      const error = await failureOf(store.readPendingVoids());
      expect(error.code).toBe('store.corrupt_record');
      expect(error.message).toContain('forget_me');
      expect(error.message).not.toContain('/home');
    }
  });

  test('filesystem failures are fixed errors that name no path', async () => {
    const reading = rig();
    reading.fs.failing.add('readFile');
    expect((await failureOf(reading.store.readPendingVoids())).code).toBe('store.read_failed');

    for (const [operation, list] of [
      ['writeFile', [SERIAL_A]],
      ['remove', []],
    ] as const) {
      const { fs, store } = rig();
      // Take the lock first, then fail only the operation under test inside it.
      await store.withLock(async () => {
        fs.failing.add(operation);
        const error = await failureOf(store.writePendingVoids([...list]));
        expect(error.code).toBe('store.write_failed');
        expect(error.message).not.toContain('/home');
        expect(error.message).not.toContain('example.com');
        fs.failing.clear();
      });
    }
  });

  test('deleteRecord removes the pending list too', async () => {
    const { fs, store } = rig({
      [PENDING]: '{"serials":[]}',
      [joinInFolder(appData.resolve(), RECORD_FILE_NAME)]: '{"passes":[]}',
    });
    await store.deleteRecord();
    expect(fs.files.size).toBe(0);
  });
});
