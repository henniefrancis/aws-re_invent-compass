// The EventsPort adapter over the real S1 (`@compass/core/api`, `/auth`, `/catalog`).
//
// Every id that comes from a tool argument passes the identifier check before any S1 call, and
// the event id passes it once when the adapter is built. S1 errors are mapped onto a CompassError
// code and nothing from the upstream message is kept. A write goes through S1's confirmedWrite:
// it is sent once and the schedule is read once afterwards; an unconfirmed write is reported as
// such and is never resent. The catalog is read from the validated on-disk cache only, so a read
// never causes a network call; `refresh_catalog` is the one place that refetches.

import {
  associateFavorites,
  cancelReservation,
  confirmedWrite,
  createPersonalTime,
  deletePersonalTime,
  disassociateFavorite,
  EventsApiError,
  getEvent,
  getSchedule,
  getSession,
  listEvents,
  reserveSessions,
  updatePersonalTime,
} from '@compass/core/api';
import type { AnnotatedBulkWriteResult, ClientContext } from '@compass/core/api';
import {
  AuthError,
  AudienceError,
  CallbackError,
  NoLoopbackPortError,
  NotSignedInError,
  OAuthNetworkError,
  OAuthTimeoutError,
  RefreshFailedError,
  SignInFailedError,
  SignInRequiredError,
  SignInTimeoutError,
  StateMismatchError,
} from '@compass/core/auth';
import {
  CacheWriteError,
  CatalogIncompleteError,
  filterCatalog,
  fromZoneWallClock,
  normaliseSession,
  parseVenues,
  readCache,
  refreshCatalog,
  resolveEventWindow,
  toZoneWallClock,
} from '@compass/core/catalog';
import type { CacheEntry, FsLike } from '@compass/core/catalog';
import type { BulkResult, PersonalTimeInput, ScheduleWire } from '@compass/contracts';
import { CompassError } from '../ports/errors.js';
import type { CompassErrorCode } from '../ports/errors.js';
import type {
  CatalogView,
  ConfirmedWriteResult,
  EventsPort,
  EventWindow,
  PlannerSession,
} from '../ports/events-port.js';
import { checkIdentifier, checkIdentifiers } from '../safety/identifiers.js';
import { containsAnyWord } from './word-match.js';

/** The sign-in side of S1, injected so the adapter works the same in live and simulated mode. */
export interface AuthPort {
  isSignedIn(): boolean;
  /** When the held access token expires, as an ISO instant, if known. */
  expiresAt(): string | undefined;
  /** Renews the held access token when it has expired or is about to (S1 refreshIfNeeded). */
  refreshIfNeeded(): Promise<void>;
  signIn(): Promise<{ memoryOnlyNotice?: string }>;
  signOut(): Promise<{ signOutUrl: string }>;
}

/** What the adapter needs. */
export interface EventsAdapterDeps {
  ctx: ClientContext;
  auth: AuthPort;
  /** The private cache directory (see S1 resolveAppDataDir). */
  catalogDir: string;
  catalogFs: FsLike;
  /** The raw venue list from data/venues.json. */
  venues: unknown;
  now: () => number;
}

const SIGN_IN_NOT_FINISHED: readonly (abstract new (...args: never[]) => Error)[] = [
  SignInTimeoutError,
  CallbackError,
  StateMismatchError,
  SignInFailedError,
  NoLoopbackPortError,
];

/** Maps an S1 error onto a CompassError with a fixed code; anything unrecognised is rethrown. */
export function mapEventsError(error: unknown): unknown {
  const table: [abstract new (...args: never[]) => Error, CompassErrorCode][] = [
    [NotSignedInError, 'NotSignedIn'],
    [SignInRequiredError, 'Unauthorized'],
    [RefreshFailedError, 'Network'],
    [OAuthNetworkError, 'Network'],
    [OAuthTimeoutError, 'Network'],
    [AudienceError, 'Internal'],
  ];
  for (const [type, code] of table) {
    if (error instanceof type) {
      return new CompassError(code);
    }
  }
  if (error instanceof CacheWriteError) {
    return new CompassError('Internal');
  }
  if (error instanceof CatalogIncompleteError) {
    return new CompassError('Network');
  }
  if (!(error instanceof EventsApiError)) {
    return error instanceof AuthError ? new CompassError('Internal') : error;
  }
  const byName: Record<string, CompassErrorCode> = {
    RateLimitedError: 'RateLimited',
    QuotaExceededError: 'RateLimited',
    UnauthorizedError: 'Unauthorized',
    ForbiddenError: 'Forbidden',
    NotFoundError: 'NotFound',
    ConflictError: 'Conflict',
    BadRequestError: 'BadRequest',
    ValidationError: 'Validation',
    ServerError: 'Server',
    UnexpectedResponseError: 'UnexpectedResponse',
    ResponseTooLargeError: 'UnexpectedResponse',
    EventWindowError: 'EventWindow',
    NetworkError: 'Network',
    TimeoutError: 'Network',
  };
  return new CompassError(byName[error.name] ?? 'Internal');
}

/** The bulk result without S1's client-side annotation. */
function plainBulk(annotated: AnnotatedBulkWriteResult): BulkResult {
  return {
    successful: [...annotated.result.successful],
    failed: annotated.result.failed.map(({ sessionId, code, conflictsWith }) => ({
      sessionId,
      code,
      ...(conflictsWith === undefined ? {} : { conflictsWith }),
    })),
  };
}

/** A date-time with no zone: minutes, and optionally seconds and a fraction (QA Low-3). */
const NAIVE_WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * The wire form of a personal time instant: the wall-clock time in the event time zone, with no
 * zone suffix. The OpenAPI document said UTC, but the live service and the re:Invent app read
 * the value as event time, so 07:00 PST sent as 15:00 showed at 15:00 (compass-power task 55).
 * AWS has since corrected the document to event wall-clock time (re-checked 31 October 2026).
 */
export function toWireInstant(instant: string, eventTimezone: string): string {
  const local = toZoneWallClock(instant, eventTimezone);
  if (local === undefined) {
    throw new CompassError('LayoverInvalid');
  }
  return local;
}

/** An instant with an explicit zone: a naive wire value is event time, so it gets the zone's offset. */
function fromWireInstant(value: string, eventTimezone: string): string {
  const naive = NAIVE_WALL_CLOCK.exec(value);
  if (naive === null) {
    return value;
  }
  return fromZoneWallClock(`${value.slice(0, 16)}:${naive[1] ?? '00'}`, eventTimezone) ?? value;
}

/** The schedule with personal time instants made explicit, so every reader compares real instants. */
function readableSchedule(schedule: ScheduleWire, eventTimezone: string): ScheduleWire {
  return {
    ...schedule,
    personalTime: schedule.personalTime.map((entry) => ({
      ...entry,
      startDateTime: fromWireInstant(entry.startDateTime, eventTimezone),
      endDateTime: fromWireInstant(entry.endDateTime, eventTimezone),
    })),
  };
}

function requireIds(ids: readonly string[]): void {
  if (!checkIdentifiers(ids).ok) {
    throw new CompassError('IdentifierRejected');
  }
}

function viewOf(entries: readonly CacheEntry[]): CatalogView {
  const byId = new Map<string, PlannerSession>();
  const labels = new Set<string>();
  for (const { session, wire } of entries) {
    const services = wire.services ?? [];
    byId.set(session.sessionId, { session, services });
    for (const service of services) {
      labels.add(service);
    }
  }
  return {
    byId,
    labels: [...labels].sort(),
    filter: (filter) => {
      const { services, words, ...rest } = filter;
      const wanted = services?.map((s) => s.toLowerCase());
      return filterCatalog(entries, rest)
        .filter(
          ({ wire }) =>
            wanted === undefined ||
            (wire.services ?? []).some((s) => wanted.includes(s.toLowerCase())),
        )
        .filter(
          ({ session, wire }) =>
            words === undefined ||
            containsAnyWord([session.title, wire.abstract, wire.topics, wire.services], words),
        )
        .map(({ session }) => session);
    },
  };
}

/**
 * The catalog from the validated on-disk cache, with no network call. Used by the adapter and by
 * the hooks, which must never reach the network. Throws CatalogMissing when there is no cache.
 */
export function readCachedCatalog(dir: string, eventId: string, fs: FsLike): Promise<CatalogView> {
  const cache = readCache(dir, eventId, fs);
  return cache === undefined || cache.eventId !== eventId
    ? Promise.reject(new CompassError('CatalogMissing'))
    : Promise.resolve(viewOf(cache.entries));
}

/** Creates the events port over the real S1. */
export function createEventsAdapter(deps: EventsAdapterDeps): EventsPort {
  const { ctx, auth } = deps;
  if (!checkIdentifier(ctx.eventId).ok) {
    throw new CompassError('IdentifierRejected');
  }
  let window: Promise<EventWindow> | undefined;

  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw mapEventsError(error);
    }
  };

  const eventWindow = (): Promise<EventWindow> => {
    window ??= guard(async () =>
      resolveEventWindow(await listEvents(ctx), await getEvent(ctx, ctx.eventId)),
    );
    window.catch(() => {
      window = undefined;
    });
    return window;
  };

  /**
   * The schedule with its personal time read as event time. The event window is read only when
   * there is personal time, so a plain schedule read stays one call. By the time a write reads
   * back personal time the window is already known: the tool read the schedule first, and a
   * personal time write reads the window before it sends.
   */
  const readable = async (schedule: ScheduleWire): Promise<ScheduleWire> =>
    schedule.personalTime.length === 0
      ? schedule
      : readableSchedule(schedule, (await eventWindow()).timezone);

  const confirmed = async <W, R>(
    write: () => Promise<W>,
    result: (written: W) => R,
  ): Promise<ConfirmedWriteResult<R>> => {
    const outcome = await guard(() => confirmedWrite(write, () => getSchedule(ctx)));
    if (outcome.confirmed) {
      // The write was sent: if the event window cannot be read now, the change is unconfirmed,
      // never an error that invites a second send (QA and security Low-2).
      const schedule = await readable(outcome.schedule.schedule).catch(() => undefined);
      if (schedule !== undefined) {
        return { kind: 'confirmed', result: result(outcome.write), schedule };
      }
    }
    return { kind: 'unconfirmed', result: result(outcome.write) };
  };

  /** Sends personal time with both times written in the event time zone. */
  const personalTimeWrite = async (
    input: PersonalTimeInput,
    send: (wire: PersonalTimeInput) => Promise<unknown>,
  ): Promise<ConfirmedWriteResult<null>> => {
    const { timezone } = await eventWindow();
    const wire = {
      ...input,
      startDateTime: toWireInstant(input.startDateTime, timezone),
      endDateTime: toWireInstant(input.endDateTime, timezone),
    };
    return confirmed(
      () => send(wire),
      () => null,
    );
  };

  return {
    signIn: async (force) => {
      // Renew a held sign-in before reporting it, so the expiry shown is never one that has
      // already passed. A rejected refresh token means the sign-in has ended: sign in again.
      if (!force && auth.isSignedIn()) {
        try {
          await auth.refreshIfNeeded();
          const expiresAt = auth.expiresAt();
          return { signedIn: true, ...(expiresAt === undefined ? {} : { expiresAt }) };
        } catch (error) {
          if (!(error instanceof SignInRequiredError)) {
            throw mapEventsError(error);
          }
        }
      }
      try {
        const done = await auth.signIn();
        const expiresAt = auth.expiresAt();
        return {
          signedIn: true,
          ...(expiresAt === undefined ? {} : { expiresAt }),
          ...(done.memoryOnlyNotice === undefined
            ? {}
            : { memoryOnlyNotice: done.memoryOnlyNotice }),
        };
      } catch (error) {
        if (SIGN_IN_NOT_FINISHED.some((type) => error instanceof type)) {
          return { signedIn: false };
        }
        throw mapEventsError(error);
      }
    },

    signOut: () => guard(() => auth.signOut()),

    isSignedIn: () => Promise.resolve(auth.isSignedIn()),

    refreshCatalog: () =>
      guard(async () => {
        const { timezone } = await eventWindow();
        const entries = await refreshCatalog({
          ctx,
          dir: deps.catalogDir,
          fs: deps.catalogFs,
          eventTimezone: timezone,
          venues: deps.venues,
          now: deps.now,
        });
        return { sessionCount: entries.length, refreshedAt: new Date(deps.now()).toISOString() };
      }),

    catalog: () => readCachedCatalog(deps.catalogDir, ctx.eventId, deps.catalogFs),

    eventWindow,

    getSchedule: () => guard(async () => readable((await getSchedule(ctx)).schedule)),

    getSession: (sessionId) => {
      requireIds([sessionId]);
      return guard(async () => {
        const { timezone } = await eventWindow();
        const { session } = await getSession(ctx, sessionId);
        return normaliseSession(session, parseVenues(deps.venues), timezone);
      });
    },

    reserve: (ids) => {
      requireIds(ids);
      return confirmed(() => reserveSessions(ctx, ids), plainBulk);
    },

    cancel: (id) => {
      requireIds([id]);
      return confirmed(
        () => cancelReservation(ctx, id),
        () => null,
      );
    },

    favorite: (ids) => {
      requireIds(ids);
      return confirmed(() => associateFavorites(ctx, ids), plainBulk);
    },

    unfavorite: (id) => {
      requireIds([id]);
      return confirmed(
        () => disassociateFavorite(ctx, id),
        () => null,
      );
    },

    createPersonalTime: (input: PersonalTimeInput) =>
      personalTimeWrite(input, (wire) => createPersonalTime(ctx, wire)),

    updatePersonalTime: (id, input) => {
      requireIds([id]);
      return personalTimeWrite(input, (wire) => updatePersonalTime(ctx, id, wire));
    },

    deletePersonalTime: (id) => {
      requireIds([id]);
      return confirmed(
        () => deletePersonalTime(ctx, id),
        () => null,
      );
    },
  };
}
