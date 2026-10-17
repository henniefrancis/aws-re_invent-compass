import { describe, expect, test } from 'vitest';
import { createAppDataResolver, RECORD_FILE_NAME } from '../../src/passes/app-data.js';
import type { IssuedPassRecord } from '../../src/passes/models.js';
import { createPassStore, RECORD_FILE_MODE } from '../../src/passes/pass-store.js';
import { PassError } from '../../src/passes/redaction.js';
import { memoryFs, type FsOperation, type MemoryFs } from './memory-fs.js';

// Tests for Pass_Store (boarding-passes, S4, Requirement 3). The store runs over an
// in-memory FileSystem, so the file mode is asserted at the seam where the contract lives.

const WINDOWS_ROOT = 'C:\\Users\\Ada\\AppData\\Roaming\\reinvent-compass';
const LINUX_ROOT = '/home/ada/.local/share/reinvent-compass';

const SENTINEL_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRlbmRlZSJ9.c2lnbmF0dXJlX3ZhbHVl';
const SENTINEL_EMAIL = 'first.timer@example.com';

const FIRST_PASS = {
  serialNumber: '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b',
  sessionCode: 'DVT301',
  fieldsHash: 'a'.repeat(64),
  platforms: ['apple', 'google'] as ('apple' | 'google')[],
};

const RECORD: IssuedPassRecord = {
  passes: [
    FIRST_PASS,
    {
      serialNumber: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      sessionCode: 'NET204-R',
      fieldsHash: '0123456789abcdef'.repeat(4),
      platforms: ['google'],
    },
  ],
};

function storeFor(platform: 'win32' | 'linux', fs: MemoryFs = memoryFs()) {
  const appData = createAppDataResolver(
    platform === 'win32'
      ? {
          platform,
          env: { APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' },
          homeDir: 'C:\\Users\\Ada',
        }
      : { platform, env: { XDG_DATA_HOME: '/home/ada/.local/share' }, homeDir: '/home/ada' },
  );
  return { fs, store: createPassStore({ appData, fs }) };
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

describe('Feature: boarding-passes, Pass_Store write path and mode', () => {
  test('the record is written inside the resolved folder with mode 0600 passed to the seam', async () => {
    for (const [platform, root, file] of [
      ['win32', WINDOWS_ROOT, `${WINDOWS_ROOT}\\${RECORD_FILE_NAME}`],
      ['linux', LINUX_ROOT, `${LINUX_ROOT}/${RECORD_FILE_NAME}`],
    ] as const) {
      const { fs, store } = storeFor(platform);
      await store.write(RECORD);
      expect(fs.dirs).toEqual([root]);
      expect([...fs.files.keys()]).toEqual([file]);
      expect(fs.modes.get(file)).toBe(0o600);
      expect(RECORD_FILE_MODE).toBe(0o600);
    }
  });
});

describe('Feature: boarding-passes, Pass_Store round trip', () => {
  test('write then read yields an equal record, with no token or email in the file', async () => {
    const { fs, store } = storeFor('linux');
    await store.write(RECORD);
    expect(await store.read()).toEqual(RECORD);
    const text = [...fs.files.values()].join('');
    expect(text).not.toContain(SENTINEL_TOKEN);
    expect(text).not.toContain(SENTINEL_EMAIL);
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['passes']);
    expect(text.endsWith('\n')).toBe(true);
  });

  test('an empty record round trips', async () => {
    const { store } = storeFor('linux');
    await store.write({ passes: [] });
    expect(await store.read()).toEqual({ passes: [] });
  });

  test('a record carrying a token or an email field is refused on write and never stored', async () => {
    const { fs, store } = storeFor('linux');
    const tainted = {
      passes: [{ ...FIRST_PASS, idToken: SENTINEL_TOKEN, email: SENTINEL_EMAIL }],
    } as unknown as IssuedPassRecord;
    const error = await failureOf(store.write(tainted));
    expect(error.code).toBe('store.invalid_record');
    expect(error.message).not.toContain(SENTINEL_EMAIL);
    expect(error.message).not.toContain(SENTINEL_TOKEN);
    expect(fs.files.size).toBe(0);
    expect(fs.ops).toEqual([]);
  });

  test('a malformed record is refused on write', async () => {
    const { store } = storeFor('linux');
    for (const bad of [
      { passes: [{ ...FIRST_PASS, serialNumber: 'not-a-uuid' }] },
      { passes: [{ ...FIRST_PASS, fieldsHash: 'short' }] },
      { passes: [{ ...FIRST_PASS, platforms: ['windows'] }] },
      { passes: 'none' },
      {},
    ]) {
      expect((await failureOf(store.write(bad as unknown as IssuedPassRecord))).code).toBe(
        'store.invalid_record',
      );
    }
  });
});

describe('Feature: boarding-passes, Pass_Store read', () => {
  test('an absent record reads as an empty record', async () => {
    const { store } = storeFor('win32');
    expect(await store.read()).toEqual({ passes: [] });
  });

  test('a stored file that is not valid is refused without echoing its content', async () => {
    for (const content of [
      'not json',
      '[]',
      JSON.stringify({ passes: [], email: SENTINEL_EMAIL }),
      JSON.stringify({ passes: [{ serialNumber: 'x' }] }),
    ]) {
      const { store } = storeFor(
        'linux',
        memoryFs({ [`${LINUX_ROOT}/${RECORD_FILE_NAME}`]: content }),
      );
      const error = await failureOf(store.read());
      expect(error.code).toBe('store.corrupt_record');
      expect(error.message).toBe('The issued-pass record is not valid.');
    }
  });
});

describe('Feature: boarding-passes, Pass_Store delete and failures', () => {
  test('deleteRecord removes the record file', async () => {
    const { fs, store } = storeFor('linux');
    await store.write(RECORD);
    await store.deleteRecord();
    expect(fs.files.size).toBe(0);
    expect(await store.read()).toEqual({ passes: [] });
  });

  test('filesystem failures become fixed PassErrors that name no path', async () => {
    type Store = ReturnType<typeof storeFor>['store'];
    const cases: [FsOperation, (store: Store) => Promise<unknown>, string][] = [
      ['readFile', (store) => store.read(), 'store.read_failed'],
      ['ensureDir', (store) => store.write(RECORD), 'store.write_failed'],
      ['writeFile', (store) => store.write(RECORD), 'store.write_failed'],
      ['remove', (store) => store.deleteRecord(), 'store.delete_failed'],
    ];
    for (const [operation, run, code] of cases) {
      const { fs, store } = storeFor('win32');
      fs.failing.add(operation);
      const error = await failureOf(run(store));
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('Users');
      expect(error.message).not.toContain('example.com');
      expect(error.message).not.toContain('disk failure');
    }
  });
});
