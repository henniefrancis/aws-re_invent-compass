// Shared self-made test helpers for the rules engine tests (itinerary-rules, S2).
// Everything here is invented sample data. Nothing is read from the synthetic
// catalog fixtures (Req 12.5, ADR-025).
import type { Commitment, NormalisedSession } from '@compass/contracts';
import {
  withContextDefaults,
  type Context,
  type ContextInput,
  type VenueData,
} from '../../src/rules/context.js';
import type { ScheduleInput } from '../../src/rules/resolve.js';

export const ZONE = 'America/Los_Angeles';
export const NOW = '2026-12-01T06:00:00-08:00';

/** Three self-made venues with a complete walking-time matrix of the same minutes. */
export function testVenueData(minutes = 20): VenueData {
  const names = ['Alpha Hall', 'Beta Tower', 'Gamma Plaza'];
  return {
    venues: names.map((name) => ({ venue: { name } })),
    walkingTimes: names.flatMap((from) =>
      names
        .filter((to) => to !== from)
        .map((to) => ({ from, to, minutes, source: { kind: 'estimate' as const } })),
    ),
  };
}

/** A complete context in the event timezone, with caller overrides. */
export function testContext(overrides: Partial<ContextInput> = {}): Context {
  return withContextDefaults({
    now: NOW,
    eventTimezone: ZONE,
    venueData: testVenueData(),
    ...overrides,
  });
}

/** A reservable session on 1 December 2026, 10:00 to 11:00 Pacific, in Alpha Hall. */
export function session(overrides: Partial<NormalisedSession> = {}): NormalisedSession {
  return {
    sessionId: 's1',
    code: 'AAA101',
    title: 'Test session',
    type: 'Workshop',
    level: '200',
    venue: 'Alpha Hall',
    room: 'Room 1',
    startsAt: '2026-12-01T10:00:00-08:00',
    endsAt: '2026-12-01T11:00:00-08:00',
    isAllDay: false,
    isReservable: true,
    seatAvailability: 'available',
    missingFields: [],
    ...overrides,
  };
}

/** A reservedSession commitment that mirrors a session. */
export function reserved(s: NormalisedSession): Commitment {
  return {
    kind: 'reservedSession',
    sessionId: s.sessionId,
    startsAt: s.startsAt ?? '',
    endsAt: s.endsAt ?? '',
  };
}

/** A personalTime commitment. */
export function personal(
  title: string,
  startsAt: string,
  endsAt: string,
  location?: string,
): Commitment {
  return { kind: 'personalTime', title, startsAt, endsAt, location };
}

/** Build a schedule from sessions that are all reserved, plus extra commitments. */
export function scheduleOf(sessions: NormalisedSession[], extra: Commitment[] = []): ScheduleInput {
  return {
    commitments: [...sessions.map((s) => reserved(s)), ...extra],
    sessions: Object.fromEntries(sessions.map((s) => [s.sessionId, s])),
  };
}
