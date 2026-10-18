import type {
  BulkResult,
  NormalisedSession,
  PersonalTimeInput,
  ScheduleWire,
} from '@compass/contracts';
import type {
  CatalogView,
  ConfirmedWriteResult,
  EventWindow,
  EventsPort,
} from '../../src/ports/events-port.js';
import { CompassError } from '../../src/ports/errors.js';

/** One recorded call on the fake. */
export interface RecordedCall {
  method: string;
  args: readonly unknown[];
}

/** The methods that change the attendee's real schedule. */
export const EVENTS_WRITE_METHODS: readonly string[] = [
  'reserve',
  'cancel',
  'favorite',
  'unfavorite',
  'createPersonalTime',
  'updatePersonalTime',
  'deletePersonalTime',
];

/**
 * A recording EventsPort with a small schedule state machine. Every call is recorded.
 * A method named in `failWith` throws that error. Writes mutate `schedule` and return
 * it, unless `confirm` is `unconfirmed`, in which case the schedule is not returned.
 */
export class FakeEvents implements EventsPort {
  readonly calls: RecordedCall[] = [];
  readonly failWith = new Map<string, Error>();
  readonly reserveFailures = new Map<string, { code: string; conflictsWith?: string[] }>();
  readonly sessions = new Map<string, NormalisedSession>();
  signedIn = true;
  confirm: 'confirmed' | 'unconfirmed' = 'confirmed';
  /** When true the write is sent but the schedule does not change (a silent no-op). */
  ignoreWrites = false;
  schedule: ScheduleWire = { reserved: [], favorites: [], personalTime: [] };
  window: EventWindow = {
    start: '2026-11-29T00:00:00-08:00',
    end: '2026-12-05T23:59:00-08:00',
    timezone: 'America/Los_Angeles',
  };
  catalogView: CatalogView | undefined;
  signInResult: { signedIn: boolean; expiresAt?: string; memoryOnlyNotice?: string } = {
    signedIn: true,
    expiresAt: '2026-12-01T00:00:00.000Z',
  };
  signOutUrl = 'https://idp.awsevents.com/oidc/logout';
  refreshResult = { sessionCount: 3, refreshedAt: '2026-11-30T16:00:00.000Z' };
  private personalTimeCounter = 0;

  constructor(catalog?: CatalogView) {
    this.catalogView = catalog;
  }

  get writeCalls(): RecordedCall[] {
    return this.calls.filter((call) => EVENTS_WRITE_METHODS.includes(call.method));
  }

  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  private run<T>(method: string, args: readonly unknown[], fn: () => T): Promise<T> {
    this.calls.push({ method, args });
    const error = this.failWith.get(method);
    if (error !== undefined) {
      return Promise.reject(error);
    }
    return Promise.resolve(fn());
  }

  private snapshotSchedule(): ScheduleWire {
    return structuredClone(this.schedule);
  }

  private confirmed<T>(result: T): ConfirmedWriteResult<T> {
    return this.confirm === 'confirmed'
      ? { kind: 'confirmed', result, schedule: this.snapshotSchedule() }
      : { kind: 'unconfirmed', result };
  }

  signIn(
    force: boolean,
  ): Promise<{ signedIn: boolean; expiresAt?: string; memoryOnlyNotice?: string }> {
    return this.run('signIn', [force], () => this.signInResult);
  }

  signOut(): Promise<{ signOutUrl: string }> {
    return this.run('signOut', [], () => ({ signOutUrl: this.signOutUrl }));
  }

  isSignedIn(): Promise<boolean> {
    return this.run('isSignedIn', [], () => this.signedIn);
  }

  refreshCatalog(): Promise<{ sessionCount: number; refreshedAt: string }> {
    return this.run('refreshCatalog', [], () => this.refreshResult);
  }

  catalog(): Promise<CatalogView> {
    return this.run('catalog', [], () => {
      if (this.catalogView === undefined) {
        throw new CompassError('CatalogMissing');
      }
      return this.catalogView;
    });
  }

  eventWindow(): Promise<EventWindow> {
    return this.run('eventWindow', [], () => this.window);
  }

  getSchedule(): Promise<ScheduleWire> {
    return this.run('getSchedule', [], () => this.snapshotSchedule());
  }

  getSession(sessionId: string): Promise<NormalisedSession> {
    return this.run('getSession', [sessionId], () => {
      const session =
        this.sessions.get(sessionId) ?? this.catalogView?.byId.get(sessionId)?.session;
      if (session === undefined) {
        throw new CompassError('NotFound');
      }
      return session;
    });
  }

  reserve(ids: string[]): Promise<ConfirmedWriteResult<BulkResult>> {
    return this.run('reserve', [ids], () => {
      const result: BulkResult = { successful: [], failed: [] };
      for (const id of ids) {
        const failure = this.reserveFailures.get(id);
        if (failure !== undefined) {
          result.failed.push({ sessionId: id, ...failure });
        } else {
          result.successful.push(id);
          if (!this.ignoreWrites && !this.schedule.reserved.includes(id)) {
            this.schedule.reserved.push(id);
          }
        }
      }
      return this.confirmed(result);
    });
  }

  cancel(id: string): Promise<ConfirmedWriteResult<null>> {
    return this.run('cancel', [id], () => {
      if (!this.ignoreWrites) {
        this.schedule.reserved = this.schedule.reserved.filter((x) => x !== id);
      }
      return this.confirmed(null);
    });
  }

  favorite(ids: string[]): Promise<ConfirmedWriteResult<BulkResult>> {
    return this.run('favorite', [ids], () => {
      const result: BulkResult = { successful: [], failed: [] };
      for (const id of ids) {
        const failure = this.reserveFailures.get(id);
        if (failure !== undefined) {
          result.failed.push({ sessionId: id, ...failure });
        } else {
          result.successful.push(id);
          if (!this.ignoreWrites && !this.schedule.favorites.includes(id)) {
            this.schedule.favorites.push(id);
          }
        }
      }
      return this.confirmed(result);
    });
  }

  unfavorite(id: string): Promise<ConfirmedWriteResult<null>> {
    return this.run('unfavorite', [id], () => {
      if (!this.ignoreWrites) {
        this.schedule.favorites = this.schedule.favorites.filter((x) => x !== id);
      }
      return this.confirmed(null);
    });
  }

  createPersonalTime(input: PersonalTimeInput): Promise<ConfirmedWriteResult<null>> {
    return this.run('createPersonalTime', [input], () => {
      if (!this.ignoreWrites) {
        this.personalTimeCounter += 1;
        this.schedule.personalTime.push({
          personalTimeId: `pt-${this.personalTimeCounter}`,
          startDateTime: input.startDateTime,
          endDateTime: input.endDateTime,
          title: input.title,
          description: input.description,
          ...(input.location === undefined ? {} : { location: input.location }),
        });
      }
      return this.confirmed(null);
    });
  }

  updatePersonalTime(id: string, input: PersonalTimeInput): Promise<ConfirmedWriteResult<null>> {
    return this.run('updatePersonalTime', [id, input], () => {
      const entry = this.schedule.personalTime.find((p) => p.personalTimeId === id);
      if (!this.ignoreWrites && entry !== undefined) {
        entry.startDateTime = input.startDateTime;
        entry.endDateTime = input.endDateTime;
        entry.title = input.title;
        entry.description = input.description;
      }
      return this.confirmed(null);
    });
  }

  deletePersonalTime(id: string): Promise<ConfirmedWriteResult<null>> {
    return this.run('deletePersonalTime', [id], () => {
      if (!this.ignoreWrites) {
        this.schedule.personalTime = this.schedule.personalTime.filter(
          (p) => p.personalTimeId !== id,
        );
      }
      return this.confirmed(null);
    });
  }
}
