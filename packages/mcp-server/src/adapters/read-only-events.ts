// Read-only live mode (compass-power task 37): wraps the Events adapter so that no write can
// reach the Events API, whatever calls it. Every read passes straight through; every write
// throws ReadOnly before any request is made. The schedule tools check the mode first and
// explain what they would have done, so this guard is the last line, not the usual path.

import { CompassError } from '../ports/errors.js';
import type { EventsPort } from '../ports/events-port.js';

const refuse = (): Promise<never> => Promise.reject(new CompassError('ReadOnly'));

export function readOnlyEvents(events: EventsPort): EventsPort {
  return {
    signIn: (force) => events.signIn(force),
    signOut: () => events.signOut(),
    isSignedIn: () => events.isSignedIn(),
    refreshCatalog: () => events.refreshCatalog(),
    catalog: () => events.catalog(),
    eventWindow: () => events.eventWindow(),
    getSchedule: () => events.getSchedule(),
    getSession: (sessionId) => events.getSession(sessionId),
    reserve: refuse,
    cancel: refuse,
    favorite: refuse,
    unfavorite: refuse,
    createPersonalTime: refuse,
    updatePersonalTime: refuse,
    deletePersonalTime: refuse,
  };
}
