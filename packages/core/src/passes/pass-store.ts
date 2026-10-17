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
import { randomUUID } from 'node:crypto';
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
/** Serials whose compensating void failed, to be voided first on the next sync. */
export const PENDING_VOID_FILE_NAME = '.pending-void';
/** The cross-process lock file. */
export const LOCK_FILE_NAME = `${RECORD_FILE_NAME}.lock`;
/**
 * A lock older than this is taken over: its owner is presumed crashed. The owner refreshes the
 * lock before every API call, so only a stalled or dead process lets it age this far.
 */
export const STALE_LOCK_MS = 10 * 60_000;
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

/** The pending-void file: serials still to be voided. Strict, and each must be a UUID. */
const PendingVoidSchema = z.strictObject({ serials: z.array(z.uuid()) });

/** True when the text is a record the store would accept. */
function isValidRecord(text: string): boolean {
  try {
    return IssuedPassRecordSchema.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}

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
  /** The serials whose compensating void failed and still need voiding. Empty when none. */
  readPendingVoids(): Promise<string[]>;
  /** Replace the list of serials still to be voided; an empty list removes the file. Mode 0600. */
  writePendingVoids(serials: string[]): Promise<void>;
  /** Remove the record file, its backup, the pending-void list and any temporary file. */
  deleteRecord(): Promise<void>;
  /** Run fn while holding the store lock. Re-entrant for the code running inside fn. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Refresh the lock timestamp so a long run is not mistaken for a crashed one. Call it before
   * each API call. Does nothing outside withLock; throws store.lock_lost when another process
   * has taken the lock over.
   */
  heartbeat(): Promise<void>;
}

/** The dependencies of the store. */
export interface PassStoreDeps {
  appData: AppDataResolver;
  fs: FileSystem;
  /** Supplies now (for the stale-lock check) and sleep (between lock attempts). */
  clock: Clock;
  /** Makes the random owner token written into the lock. Defaults to a random UUID. */
  newToken?: () => string;
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

/** The lock the running code holds, so a nested call does not deadlock and can heartbeat. */
interface HeldLock {
  lockPath: string;
  token: string;
}
const holding = new AsyncLocalStorage<HeldLock>();

/** A lock file holds the owner token, a space and the time it was last refreshed, in ms. */
const LOCK_CONTENT = /^([A-Za-z0-9-]{8,64}) (\d+)$/;

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

  const newToken = deps.newToken ?? randomUUID;
  const lockFailed = () =>
    passError('store.lock_failed', 'The issued-pass record could not be locked.');
  const lockContent = (token: string) => `${token} ${String(clock.now().getTime())}`;

  /** Take the lock for the token, waiting for a live holder and taking over a stale one. */
  async function acquireFileLock(lockPath: string, token: string): Promise<void> {
    for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
      let held: string | undefined;
      let stale = false;
      try {
        if (await fs.createExclusive(lockPath, lockContent(token), RECORD_FILE_MODE)) {
          return;
        }
        held = await fs.readFile(lockPath);
        if (held !== undefined) {
          // The time comes from the lock's own content. A lock with no readable content (empty
          // or garbage) counts as stale only when the file itself is older than the limit.
          const match = LOCK_CONTENT.exec(held);
          const touched = match ? Number(match[2]) : await fs.mtimeMs(lockPath);
          if (touched === undefined) {
            continue; // it vanished while we looked: try again at once
          }
          stale = clock.now().getTime() - touched > STALE_LOCK_MS;
          if (stale && (await fs.readFile(lockPath)) === held) {
            // Compare before removing, so a lock refreshed or replaced meanwhile is left alone.
            await fs.remove(lockPath);
          }
        }
      } catch {
        throw lockFailed();
      }
      if (held === undefined || stale) {
        continue; // released, or just cleared: try again at once
      }
      await clock.sleep(LOCK_RETRY_MS);
    }
    throw passError('store.locked', 'The issued-pass record is in use by another process.');
  }

  /** Remove the lock only if it still holds our token (never somebody else's). */
  async function releaseFileLock(held: HeldLock): Promise<void> {
    try {
      const content = await fs.readFile(held.lockPath);
      if (content?.startsWith(`${held.token} `)) {
        await fs.remove(held.lockPath);
      }
    } catch {
      // A lock left behind heals through the stale rule.
    }
  }

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (holding.getStore() !== undefined) {
      return fn();
    }
    const root = appData.resolve();
    return runExclusive(joinInFolder(root, RECORD_FILE_NAME), async () => {
      try {
        await fs.ensureDir(root, APP_DIR_MODE);
      } catch {
        throw lockFailed();
      }
      const held: HeldLock = { lockPath: joinInFolder(root, LOCK_FILE_NAME), token: newToken() };
      await acquireFileLock(held.lockPath, held.token);
      try {
        return await holding.run(held, fn);
      } finally {
        await releaseFileLock(held);
      }
    });
  }

  async function heartbeat(): Promise<void> {
    const held = holding.getStore();
    if (held === undefined) {
      return;
    }
    let content: string | undefined;
    try {
      content = await fs.readFile(held.lockPath);
    } catch {
      throw lockFailed();
    }
    if (!content?.startsWith(`${held.token} `)) {
      throw passError(
        'store.lock_lost',
        'The issued-pass record lock was taken over by another process. Nothing more was changed.',
      );
    }
    try {
      await fs.writeFile(held.lockPath, lockContent(held.token), RECORD_FILE_MODE);
    } catch {
      throw lockFailed();
    }
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
          // The backup is only ever overwritten from a record that parses, so a corrupt record
          // can never replace the last good copy.
          if (previous !== undefined && isValidRecord(previous)) {
            await fs.writeFile(joinInFolder(root, BACKUP_FILE_NAME), previous, RECORD_FILE_MODE);
          }
          await fs.rename(tempPath, recordPath);
        } catch {
          await fs.remove(tempPath).catch(() => undefined);
          throw passError('store.write_failed', 'The issued-pass record could not be written.');
        }
      });
    },

    async readPendingVoids() {
      let text: string | undefined;
      try {
        text = await fs.readFile(joinInFolder(appData.resolve(), PENDING_VOID_FILE_NAME));
      } catch {
        throw passError('store.read_failed', 'The pending-void list could not be read.');
      }
      if (text === undefined) {
        return [];
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      const parsed = PendingVoidSchema.safeParse(json);
      if (!parsed.success) {
        throw passError(
          'store.corrupt_record',
          `The pending-void list is not valid. Run the forget_me tool, or delete the ${PENDING_VOID_FILE_NAME} file in the reinvent-compass app-data folder.`,
        );
      }
      return parsed.data.serials;
    },

    writePendingVoids(serials) {
      const parsed = PendingVoidSchema.safeParse({ serials: [...new Set(serials)] });
      if (!parsed.success) {
        return Promise.reject(
          passError('store.invalid_record', 'The pending-void list is not valid.'),
        );
      }
      return withLock(async () => {
        const path = joinInFolder(appData.resolve(), PENDING_VOID_FILE_NAME);
        try {
          if (parsed.data.serials.length === 0) {
            await fs.remove(path);
          } else {
            await fs.writeFile(path, `${JSON.stringify(parsed.data)}\n`, RECORD_FILE_MODE);
          }
        } catch {
          throw passError('store.write_failed', 'The pending-void list could not be written.');
        }
      });
    },

    deleteRecord() {
      return withLock(async () => {
        const root = appData.resolve();
        try {
          for (const name of [
            RECORD_FILE_NAME,
            BACKUP_FILE_NAME,
            TEMP_FILE_NAME,
            PENDING_VOID_FILE_NAME,
          ]) {
            await fs.remove(joinInFolder(root, name));
          }
        } catch {
          throw passError('store.delete_failed', 'The issued-pass record could not be deleted.');
        }
      });
    },

    withLock,
    heartbeat,
  };
}
