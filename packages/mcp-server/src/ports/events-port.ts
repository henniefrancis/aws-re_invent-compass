// The S1 events-client seam (design, Component 6). The real adapter (task 26) wraps
// S1 auth, api, catalog and simulated exports; tests use the recording fake.

import type {
  BulkResult,
  NormalisedSession,
  PersonalTimeInput,
  ScheduleWire,
} from '@compass/contracts';

/** The event window and timezone, read from GetEvent. Never hard-coded. */
export interface EventWindow {
  start: string;
  end: string;
  timezone: string;
}

/** A cached session with the catalog `services` labels the planner and taxonomy use. */
export interface PlannerSession {
  session: NormalisedSession;
  services: readonly string[];
}

/** A filter over the cached catalog (S1 filterCatalog). */
export interface CatalogFilter {
  text?: string;
  services?: string[];
  level?: string;
  type?: string;
  day?: string;
}

/** Read-only view of the cached catalog. Abstracts never appear here. */
export interface CatalogView {
  byId: ReadonlyMap<string, PlannerSession>;
  /** Distinct `services` values across the cache. */
  labels: readonly string[];
  filter(filter: CatalogFilter): NormalisedSession[];
}

/**
 * The outcome of one confirmed write: the write was sent once and GetSchedule was read
 * once afterwards. `unconfirmed` means the write was sent but the schedule could not be
 * read back, so the caller must not resend.
 */
export type ConfirmedWriteResult<T> =
  { kind: 'confirmed'; result: T; schedule: ScheduleWire } | { kind: 'unconfirmed'; result: T };

/** S1 as the server sees it. Every method may throw a CompassError. */
export interface EventsPort {
  signIn(
    force: boolean,
  ): Promise<{ signedIn: boolean; expiresAt?: string; memoryOnlyNotice?: string }>;
  signOut(): Promise<{ signOutUrl: string }>;
  isSignedIn(): Promise<boolean>;
  refreshCatalog(): Promise<{ sessionCount: number; refreshedAt: string }>;
  /** From the cache. Throws CatalogMissing when there is no cache yet. */
  catalog(): Promise<CatalogView>;
  eventWindow(): Promise<EventWindow>;
  getSchedule(): Promise<ScheduleWire>;
  getSession(sessionId: string): Promise<NormalisedSession>;
  reserve(ids: string[]): Promise<ConfirmedWriteResult<BulkResult>>;
  cancel(id: string): Promise<ConfirmedWriteResult<null>>;
  favorite(ids: string[]): Promise<ConfirmedWriteResult<BulkResult>>;
  unfavorite(id: string): Promise<ConfirmedWriteResult<null>>;
  createPersonalTime(input: PersonalTimeInput): Promise<ConfirmedWriteResult<null>>;
  updatePersonalTime(id: string, input: PersonalTimeInput): Promise<ConfirmedWriteResult<null>>;
  deletePersonalTime(id: string): Promise<ConfirmedWriteResult<null>>;
}
