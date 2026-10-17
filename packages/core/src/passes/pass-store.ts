// Pass_Store for the pass side (boarding-passes, S4, Requirement 3).
//
// Reads and writes the local Issued_Pass_Record (personal data record P5) inside the
// per-OS app-data folder, through the injected AppDataResolver and FileSystem. The record
// holds, per issued pass, only the serial number, session code, fields hash and platforms.
// The schema is strict in both directions, so a record carrying any other field (an ID
// token or an email, for example) is refused on write and on read rather than stored.
//
// Every failure is a PassError with a fixed sentence: it never names the folder (a path can
// contain a user name) and never echoes the record.
import { z } from 'zod';
import { joinInFolder, RECORD_FILE_NAME } from './app-data.js';
import type { AppDataResolver, FileSystem } from './interfaces.js';
import type { IssuedPassRecord } from './models.js';
import { passError } from './redaction.js';

/** The record file is readable and writable by its owner only. */
export const RECORD_FILE_MODE = 0o600;

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

/** The store's operations. */
export interface PassStore {
  /** The record, or an empty record when none has been written. */
  read(): Promise<IssuedPassRecord>;
  /** Replace the record, creating the file with mode 0600. */
  write(record: IssuedPassRecord): Promise<void>;
  /** Remove the record file. */
  deleteRecord(): Promise<void>;
}

/** The dependencies of the store. */
export interface PassStoreDeps {
  appData: AppDataResolver;
  fs: FileSystem;
}

/** Build the Pass_Store. */
export function createPassStore(deps: PassStoreDeps): PassStore {
  const { appData, fs } = deps;

  return {
    async read() {
      const root = appData.resolve();
      let text: string | undefined;
      try {
        text = await fs.readFile(joinInFolder(root, RECORD_FILE_NAME));
      } catch {
        throw passError('store.read_failed', 'The issued-pass record could not be read.');
      }
      if (text === undefined) {
        return { passes: [] };
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      const parsed = IssuedPassRecordSchema.safeParse(json);
      if (!parsed.success) {
        throw passError('store.corrupt_record', 'The issued-pass record is not valid.');
      }
      return parsed.data;
    },

    async write(record) {
      const parsed = IssuedPassRecordSchema.safeParse(record);
      if (!parsed.success) {
        throw passError('store.invalid_record', 'The issued-pass record is not valid.');
      }
      const root = appData.resolve();
      try {
        await fs.ensureDir(root);
        await fs.writeFile(
          joinInFolder(root, RECORD_FILE_NAME),
          `${JSON.stringify(parsed.data, null, 2)}\n`,
          RECORD_FILE_MODE,
        );
      } catch {
        throw passError('store.write_failed', 'The issued-pass record could not be written.');
      }
    },

    async deleteRecord() {
      try {
        await fs.remove(joinInFolder(appData.resolve(), RECORD_FILE_NAME));
      } catch {
        throw passError('store.delete_failed', 'The issued-pass record could not be deleted.');
      }
    },
  };
}
