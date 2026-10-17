// The Schedule_Snapshot (personal data record P4): the last confirmed GetSchedule result and
// the event window, in the OS app-data folder, file mode 0o600 and directory mode 0o700.
// It never holds a token or an email. In simulated mode it lives in a `simulated`
// subfolder. Writes are atomic: a temporary file is written, then renamed over the target.
// POSIX modes are ignored on Windows, where the per-user app-data location is relied on.

import { join } from 'node:path';
import { ScheduleWireSchema } from '@compass/contracts';
import type { ScheduleWire } from '@compass/contracts';
import { z } from 'zod';
import type { EventWindow } from '../ports/events-port.js';
import type { FsLike } from '../ports/fs-ports.js';

/** What is written to disk. */
export interface ScheduleSnapshot {
  version: 1;
  mode: 'live' | 'simulated';
  fetchedAt: string;
  eventWindow: EventWindow;
  schedule: ScheduleWire;
}

/** Reads and writes the snapshot. */
export interface SnapshotStore {
  write(snapshot: ScheduleSnapshot): Promise<void>;
  read(): Promise<ScheduleSnapshot | undefined>;
  remove(): Promise<void>;
}

const ScheduleSnapshotSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['live', 'simulated']),
  fetchedAt: z.string(),
  eventWindow: z.object({ start: z.string(), end: z.string(), timezone: z.string() }),
  schedule: ScheduleWireSchema,
});

/** The snapshot file name. */
export const SNAPSHOT_FILE_NAME = 'schedule-snapshot.json';

/** Creates the store under `appDataDir` (or its `simulated` subfolder). */
export function createSnapshotStore(
  appDataDir: string,
  mode: 'live' | 'simulated',
  fs: FsLike,
  processId = 0,
): SnapshotStore {
  const directory = mode === 'simulated' ? join(appDataDir, 'simulated') : appDataDir;
  const file = join(directory, SNAPSHOT_FILE_NAME);
  return {
    write: async (snapshot) => {
      const temporary = `${file}.${processId}.tmp`;
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
      await fs.rename(temporary, file);
    },
    read: async () => {
      let text: string;
      try {
        text = await fs.readFile(file);
      } catch {
        return undefined;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return undefined;
      }
      const parsed = ScheduleSnapshotSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    },
    remove: () => fs.remove(file),
  };
}
