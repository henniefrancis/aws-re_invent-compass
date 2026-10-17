// In-memory schedule for the simulated transport (events-client, S1, task 14.1).
//
// Holds one attendee's schedule for the life of the process so that a write followed
// by GetSchedule reflects it (Requirement 18.3). Bulk results are derived from this
// state, never scripted (Requirement 18.4):
//   ReserveSessions, per session, in order:
//     not in the catalog or not reservable   sessionNotReservable
//     already reserved                       alreadyScheduled
//     already started at the injected clock  timePassed (only if a clock is injected)
//     configured as full                     sessionFull
//     time clash with a reserved session     scheduleConflict, with conflictsWith
//     otherwise                              reserved (counts for later sessions in the
//                                            same request)
//   AssociateFavorites: unknown session -> other; already favorited -> alreadyFavorited.
// Session times come from the synthetic catalog only; sessions with no usable time
// never clash.

import type {
  BulkFailure,
  BulkResult,
  PersonalTime,
  PersonalTimeInput,
  ScheduleWire,
  SessionWire,
} from '@compass/contracts';
import { computeSessionInterval, type SessionInterval } from '../catalog/session-time.js';

/** The attendee's in-memory schedule. */
export interface InMemorySchedule {
  /** A copy of the current schedule in wire shape. */
  snapshot(): ScheduleWire;
  reserve(sessionIds: readonly string[]): BulkResult;
  favorite(sessionIds: readonly string[]): BulkResult;
  /** Remove a reservation; false if the session was not reserved. */
  cancel(sessionId: string): boolean;
  /** Remove a favorite; false if the session was not a favorite. */
  unfavorite(sessionId: string): boolean;
  createPersonalTime(input: PersonalTimeInput): PersonalTime;
  /** Replace a personal time entry; false if the id is unknown. */
  updatePersonalTime(id: string, input: PersonalTimeInput): boolean;
  /** Remove a personal time entry; false if the id is unknown. */
  deletePersonalTime(id: string): boolean;
}

/** What the schedule needs to know about the world. */
export interface ScheduleWorld {
  sessions: readonly SessionWire[];
  /** Session ids that are always full. */
  fullSessionIds: ReadonlySet<string>;
  /** The event timezone, for sessions whose time has none of its own. */
  eventTimezone: string;
  /**
   * An injected clock (epoch milliseconds). When present, a session that has already
   * started at that instant answers timePassed. When absent, no session ever does.
   */
  now?: () => number;
}

/** Create an empty schedule over a catalog. */
export function createInMemorySchedule(world: ScheduleWorld): InMemorySchedule {
  const byId = new Map(world.sessions.map((s) => [s.sessionId, s]));
  const intervals = new Map<string, SessionInterval | undefined>(
    world.sessions.map((s) => [
      s.sessionId,
      computeSessionInterval(s.sessionTime, world.eventTimezone),
    ]),
  );
  const reserved: string[] = [];
  const favorites: string[] = [];
  let personalTime: PersonalTime[] = [];
  let nextPersonalTimeId = 1;

  /** The reserved session ids whose time overlaps the given session. */
  function clashesWith(session: SessionWire): string[] {
    const mine = intervals.get(session.sessionId);
    if (mine === undefined) {
      return [];
    }
    return reserved.filter((id) => {
      const theirs = intervals.get(id);
      return theirs !== undefined && mine.startMs < theirs.endMs && theirs.startMs < mine.endMs;
    });
  }

  function reserveOne(id: string): BulkFailure | undefined {
    const session = byId.get(id);
    if (session?.isReservable !== true) {
      return { sessionId: id, code: 'sessionNotReservable' };
    }
    if (reserved.includes(id)) {
      return { sessionId: id, code: 'alreadyScheduled' };
    }
    const own = intervals.get(id);
    if (world.now !== undefined && own !== undefined && own.startMs <= world.now()) {
      return { sessionId: id, code: 'timePassed' };
    }
    if (world.fullSessionIds.has(id)) {
      return { sessionId: id, code: 'sessionFull' };
    }
    const clashes = clashesWith(session);
    if (clashes.length > 0) {
      return { sessionId: id, code: 'scheduleConflict', conflictsWith: clashes };
    }
    reserved.push(id);
    return undefined;
  }

  function favoriteOne(id: string): BulkFailure | undefined {
    if (!byId.has(id)) {
      return { sessionId: id, code: 'other' };
    }
    if (favorites.includes(id)) {
      return { sessionId: id, code: 'alreadyFavorited' };
    }
    favorites.push(id);
    return undefined;
  }

  function bulk(ids: readonly string[], one: (id: string) => BulkFailure | undefined): BulkResult {
    const result: BulkResult = { successful: [], failed: [] };
    for (const id of ids) {
      const failure = one(id);
      if (failure === undefined) {
        result.successful.push(id);
      } else {
        result.failed.push(failure);
      }
    }
    return result;
  }

  function removeFrom(list: string[], id: string): boolean {
    const index = list.indexOf(id);
    if (index < 0) {
      return false;
    }
    list.splice(index, 1);
    return true;
  }

  return {
    snapshot: () => ({
      reserved: [...reserved],
      favorites: [...favorites],
      personalTime: personalTime.map((p) => ({ ...p })),
    }),
    reserve: (ids) => bulk(ids, reserveOne),
    favorite: (ids) => bulk(ids, favoriteOne),
    cancel: (id) => removeFrom(reserved, id),
    unfavorite: (id) => removeFrom(favorites, id),
    createPersonalTime(input) {
      const entry: PersonalTime = { personalTimeId: `pt-${String(nextPersonalTimeId)}`, ...input };
      nextPersonalTimeId += 1;
      personalTime.push(entry);
      return entry;
    },
    updatePersonalTime(id, input) {
      const index = personalTime.findIndex((p) => p.personalTimeId === id);
      if (index < 0) {
        return false;
      }
      personalTime[index] = { personalTimeId: id, ...input };
      return true;
    },
    deletePersonalTime(id) {
      const before = personalTime.length;
      personalTime = personalTime.filter((p) => p.personalTimeId !== id);
      return personalTime.length < before;
    },
  };
}
