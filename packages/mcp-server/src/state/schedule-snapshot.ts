// The Schedule_Snapshot (personal data record P4): the last confirmed GetSchedule result
// and the event window, in the OS app-data folder, mode 0o600. It never holds a token or
// an email. The store implementation is added in task 11.5; the types live here from
// task 1 because the Runtime and the hook runner type against them.

import type { ScheduleWire } from '@compass/contracts';
import type { EventWindow } from '../ports/events-port.js';

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
