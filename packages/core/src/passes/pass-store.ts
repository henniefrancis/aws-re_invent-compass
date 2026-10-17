// Pass_Store for the pass side (boarding-passes, S4, Requirement 3).
//
// Reads and writes the local Issued_Pass_Record (personal data record P5) inside the
// per-OS app-data folder, through the injected AppDataResolver, FileSystem and Clock. The
// record holds, per issued pass, only the serial number, session code, fields hash and
// platforms. The schema is strict in both directions, so a record carrying any other field
// (an ID token or an email, for example) is refused on write and on read rather than stored.
//
// Writes are atomic: the new record goes to a temporary file in the same folder and is
// renamed over the old one, after the previous record has been copied to a single .bak.
// A reader therefore sees the old record or the new one, never half of either.
//
// withLock serialises whole read-modify-write runs: an in-process mutex per record path, then
// a cross-process lock file made with exclusive-create semantics. A lock older than two
// minutes is treated as left behind by a crashed process and is taken over. read never takes
// the lock (a rename is atomic); write and deleteRecord take it themselves unless the caller
// already holds it.
//
// Every failure is a PassError with a fixed sentence: it never names the folder (a path can
// contain a user name) and never echoes the record.
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { APP_DIR_MODE, joinInFolder, RECORD_FILE_NAME } from './app-data.js';
import type { AppDataResolver, Clock, FileSystem } from './interfaces.js';
import type { IssuedPass, IssuedPassRecord } from './models.js';
import { passError } from './redaction.js';

/** The record file is readable and writable by its owner only. */
export const RECORD_FILE_MODE = 0o600;
/** The single previous copy of the record, kept beside it. */
export const BACKUP_FILE_NAME = `${RECORD_FILE_NAME}.bak`;
/** The temporary file a write goes through before the rename. */
export const TEMP_FILE_NAME = `${RECORD_FILE_NAME}.tmp`;
/** The cross-process lock file. */
export const LOCK_FILE_NAME = `${RECORD_FILE_NAME}.lock`;
/** A lock older than this is taken over: its owner is presumed crashed. */
export const STALE_LOCK_MS = 2 * 60_000;
/** How long to wait between attempts to take a held lock, and how many attempts to make. */
const LOCK_RETRY_MS = 100;
const LOCK_MAX_ATTEMPTS = 100;

/** The stored shape. Strict, so nothing beyond the four fields can be stored or read. */
const IssuedPassRecordSchema: z.ZodType<IssuedPassRecord> = z.strictObject({
  passes: z.array(
    z.strictObject({
      serialNumber: z.uuid(),
      sessionCode: z.string(),
      fieldsHash: z.string().regex(/^[0-9a-f]{64}$/),
      platforms: z.array(z.enum(['apple', 'google'])),
    }),
  ),
});

/** What a read found: the record (one entry per session code) and the older duplicates dropped. */
export interface ReadResult {
  record: IssuedPassRecord;
  /** Entries superseded by a newer entry for the same session code, oldest first. */
  superseded: IssuedPass[];
}

/** The store's operations. */
export interface PassStore {
  /** The record, or an empty record when none has been written. One entry per session code. */
  read(): Promise<IssuedPassRecord>;
  /** Like read, and also the older duplicates that were dropped, so their passes can be voided. */
  readWithSuperseded(): Promise<ReadResult>;
  /** Replace the record atomically, creating the file with mode 0600 and keeping one .bak. */
  write(record: IssuedPassRecord): Promise<void>;
  /** Remove the record file, its backup and any temporary file. */
  deleteRecord(): Promise<void>;
  /** Run fn while holding the store lock. Re-entrant for the code running inside fn. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

/** The dependencies of the store. */
export interface PassStoreDeps {
  appData: AppDataResolver;
  fs: FileSystem;
  /** Supplies now (for the stale-lock check) and sleep (between lock attempts). */
  clock: Clock;
}

/** In-process mutex: one queue per record path, shared by every store instance. */
const queues = new Map<string, Promise<void>>();

function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(fn);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  });
  return result;
}

/** Marks code that already holds the lock, so a nested call does not deadlock on itself. */
const holding = new AsyncLocalStorage<boolean>();

/** Keep the newest entry per session code (the last in file order), noting the rest. */
function dedupe(record: IssuedPassRecord): ReadResult {
  const newest = new Map<string, IssuedPass>();
  const superseded: IssuedPass[] = [];
  for (const pass of record.passes) {
    const older = newest.get(pass.sessionCode);
    if (older !== undefined) {
      superseded.push(older);
    }
    newest.set(pass.sessionCode, pass);
  }
  return { record: { passes: [...newest.values()] }, superseded };
}

/** Build the Pass_Store. */
export function createPassStore(deps: PassStoreDeps): PassStore {
  const { appData, fs, clock } = deps;

  async function acquireFileLock(lockPath: string): Promise<void> {
    for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
      let held: string | undefined;
      try {
        const created = await fs.createExclusive(
          lockPath,
          String(clock.now().getTime()),
          RECORD_FILE_MODE,
        );
        if (created) {
          return;
        }
        held = await fs.readFile(lockPath);
      } catch {
        throw passError('store.lock_failed', 'The issued-pass record could not be locked.');
      }
      if (held === undefined) {
        continue; // released between our two calls: try again at once
      }
      const takenAt = Number(held);
      if (!Number.isFinite(takenAt) || clock.now().getTime() - takenAt > STALE_LOCK_MS) {
        try {
          await fs.remove(lockPath);
        } catch {
          throw passError('store.lock_failed', 'The issued-pass record could not be locked.');
        }
        continue;
      }
      await clock.sleep(LOCK_RETRY_MS);
    }
    throw passError('store.locked', 'The issued-pass record is in use by another process.');
  }

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (holding.getStore() === true) {
      return fn();
    }
    const root = appData.resolve();
    return runExclusive(joinInFolder(root, RECORD_FILE_NAME), async () => {
      try {
        await fs.ensureDir(root, APP_DIR_MODE);
      } catch {
        throw passError('store.lock_failed', 'The issued-pass record could not be locked.');
      }
      const lockPath = joinInFolder(root, LOCK_FILE_NAME);
      await acquireFileLock(lockPath);
      try {
        return await holding.run(true, fn);
      } finally {
        await fs.remove(lockPath).catch(() => undefined);
      }
    });
  }

  async function readWithSuperseded(): Promise<ReadResult> {
    let text: string | undefined;
    try {
      text = await fs.readFile(joinInFolder(appData.resolve(), RECORD_FILE_NAME));
    } catch {
      throw passError('store.read_failed', 'The issued-pass record could not be read.');
    }
    if (text === undefined) {
      return { record: { passes: [] }, superseded: [] };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const parsed = IssuedPassRecordSchema.safeParse(json);
    if (!parsed.success) {
      throw passError(
        'store.corrupt_record',
        `The issued-pass record is not valid. Run the forget_me tool, or delete the ${RECORD_FILE_NAME} file in the reinvent-compass app-data folder, then sync again. The previous record may still be in ${BACKUP_FILE_NAME}.`,
      );
    }
    return dedupe(parsed.data);
  }

  return {
    readWithSuperseded,

    async read() {
      return (await readWithSuperseded()).record;
    },

    write(record) {
      const parsed = IssuedPassRecordSchema.safeParse(record);
      if (!parsed.success) {
        return Promise.reject(
          passError('store.invalid_record', 'The issued-pass record is not valid.'),
        );
      }
      return withLock(async () => {
        const root = appData.resolve();
        const recordPath = joinInFolder(root, RECORD_FILE_NAME);
        const tempPath = joinInFolder(root, TEMP_FILE_NAME);
        try {
          await fs.writeFile(
            tempPath,
            `${JSON.stringify(parsed.data, null, 2)}\n`,
            RECORD_FILE_MODE,
          );
          const previous = await fs.readFile(recordPath);
          if (previous !== undefined) {
            await fs.writeFile(joinInFolder(root, BACKUP_FILE_NAME), previous, RECORD_FILE_MODE);
          }
          await fs.rename(tempPath, recordPath);
        } catch {
          await fs.remove(tempPath).catch(() => undefined);
          throw passError('store.write_failed', 'The issued-pass record could not be written.');
        }
      });
    },

    deleteRecord() {
      return withLock(async () => {
        const root = appData.resolve();
        try {
          for (const name of [RECORD_FILE_NAME, BACKUP_FILE_NAME, TEMP_FILE_NAME]) {
            await fs.remove(joinInFolder(root, name));
          }
        } catch {
          throw passError('store.delete_failed', 'The issued-pass record could not be deleted.');
        }
      });
    },

    withLock,
  };
}
