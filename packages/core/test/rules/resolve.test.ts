import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import {
  resolveCommitment,
  sessionReservability,
  sessionRef,
  sessionToCommitment,
  usableTime,
} from '../../src/rules/resolve.js';
import { personal, reserved, session } from './helpers.js';

// Tests for commitment resolution (itinerary-rules, S2).
// Requirements: 1.5, 2.5, 3.7, 5.7, 11.5. All sample data is self-made.

describe('resolveCommitment, reserved sessions', () => {
  test('resolves a complete session', () => {
    const s = session({ isAllDay: false });
    expect(resolveCommitment(reserved(s), { s1: s })).toEqual({
      ref: 'AAA101',
      venue: 'Alpha Hall',
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      isAllDay: false,
      isReservable: true,
      missing: [],
    });
  });

  test('Venue_Resolution order: session venue, then commitment venue', () => {
    const s = session({ venue: undefined });
    const withCommitmentVenue = { ...reserved(s), venue: 'Beta Tower' };
    expect(resolveCommitment(withCommitmentVenue, { s1: s }).venue).toBe('Beta Tower');
    const both = { ...reserved(session()), venue: 'Beta Tower' };
    expect(resolveCommitment(both, { s1: session() }).venue).toBe('Alpha Hall');
    const blankSession = session({ venue: '   ' });
    expect(resolveCommitment(withCommitmentVenue, { s1: blankSession }).venue).toBe('Beta Tower');
  });

  test('a sessionId absent from the lookup has unknown times and reservability', () => {
    const resolved = resolveCommitment({ ...reserved(session()), venue: 'Beta Tower' }, {});
    expect(resolved.venue).toBe('Beta Tower');
    expect(resolved.startsAt).toBeUndefined();
    expect(resolved.endsAt).toBeUndefined();
    expect(resolved.isReservable).toBeUndefined();
    expect(resolved.missing).toEqual(['startsAt', 'endsAt', 'reservability']);
    expect(resolved.ref).toBe('s1');
  });

  test('does not look up prototype keys as sessions', () => {
    const c = { ...reserved(session()), sessionId: 'constructor' };
    expect(resolveCommitment(c, {}).missing).toContain('startsAt');
  });

  test('names a commitment by code, then title, then commitment title, then id', () => {
    const noCode = session({ code: '' });
    expect(resolveCommitment(reserved(noCode), { s1: noCode }).ref).toBe('Test session');
    const noName = session({ code: '', title: '' });
    const c = { ...reserved(noName), title: 'Booked title' };
    expect(resolveCommitment(c, { s1: noName }).ref).toBe('Booked title');
    expect(resolveCommitment(reserved(noName), { s1: noName }).ref).toBe('s1');
    expect(sessionRef(noName)).toBe('s1');
    const noId = { ...reserved(noName), sessionId: '' };
    expect(resolveCommitment(noId, {}).ref).toBe('unnamed item');
    expect(sessionRef(session())).toBe('AAA101');
  });

  test('reads all-day status from the session', () => {
    const s = session({ isAllDay: true });
    expect(resolveCommitment(reserved(s), { s1: s }).isAllDay).toBe(true);
  });
});

describe('usable times and reservability', () => {
  test('a time is usable only when present, not listed missing, and a valid instant', () => {
    expect(usableTime(session(), 'startsAt')).toBe('2026-12-01T10:00:00-08:00');
    expect(usableTime(session({ startsAt: undefined }), 'startsAt')).toBeUndefined();
    expect(usableTime(session({ missingFields: ['endsAt'] }), 'endsAt')).toBeUndefined();
    expect(usableTime(session({ startsAt: '2026-12-01 10:00' }), 'startsAt')).toBeUndefined();
    expect(usableTime(session({ startsAt: '2026-12-01T10:00:00' }), 'startsAt')).toBeUndefined();
  });

  test('reservability is missing when listed in missingFields', () => {
    expect(sessionReservability(session({ isReservable: true }))).toBe(true);
    expect(sessionReservability(session({ isReservable: false }))).toBe(false);
    expect(sessionReservability(session({ missingFields: ['isReservable'] }))).toBeUndefined();
  });
});

describe('resolveCommitment, personal time', () => {
  test('takes times from the commitment and location as the venue', () => {
    const c = personal(
      'Lunch',
      '2026-12-01T12:00:00-08:00',
      '2026-12-01T12:30:00-08:00',
      'Alpha Hall',
    );
    expect(resolveCommitment(c, {})).toEqual({
      ref: 'Lunch',
      venue: 'Alpha Hall',
      startsAt: '2026-12-01T12:00:00-08:00',
      endsAt: '2026-12-01T12:30:00-08:00',
      isAllDay: false,
      isReservable: false,
      missing: [],
    });
  });

  test('reports a missing location and unusable times', () => {
    const c = personal('Rest', 'noon', '', undefined);
    const resolved = resolveCommitment(c, {});
    expect(resolved.missing).toEqual(['venue', 'startsAt', 'endsAt']);
    expect(resolved.startsAt).toBeUndefined();
    expect(resolved.endsAt).toBeUndefined();
  });
});

describe('end not after start', () => {
  test('is reported as order, for sessions and personal time, and ignored for all-day items', () => {
    const same = session({ endsAt: session().startsAt });
    expect(resolveCommitment(reserved(same), { s1: same }).missing).toEqual(['order']);
    const before = session({ endsAt: '2026-12-01T09:00:00-08:00' });
    expect(resolveCommitment(reserved(before), { s1: before }).missing).toEqual(['order']);
    const rest = personal(
      'Rest',
      '2026-12-01T12:00:00-08:00',
      '2026-12-01T11:00:00-08:00',
      'Alpha Hall',
    );
    expect(resolveCommitment(rest, {}).missing).toEqual(['order']);
    const allDay = session({ isAllDay: true, endsAt: '2026-12-01T09:00:00-08:00' });
    expect(resolveCommitment(reserved(allDay), { s1: allDay }).missing).toEqual([]);
    const ok = session();
    expect(resolveCommitment(reserved(ok), { s1: ok }).missing).toEqual([]);
  });
});

describe('sessionToCommitment', () => {
  test('mirrors the session as a reservedSession commitment', () => {
    const s = session();
    expect(sessionToCommitment(s)).toEqual({
      kind: 'reservedSession',
      sessionId: 's1',
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      title: 'Test session',
      venue: 'Alpha Hall',
    });
  });

  test('uses empty strings for absent times, which resolve as missing', () => {
    const s = session({ startsAt: undefined, endsAt: undefined });
    const c = sessionToCommitment(s);
    expect(c).toMatchObject({ startsAt: '', endsAt: '' });
    expect(resolveCommitment(c, { s1: s }).missing).toEqual(['startsAt', 'endsAt']);
  });
});

describe('missing fields resolve to unknown', () => {
  // Feature: itinerary-rules, Property 3: Missing required field yields unknown with a reason and no value
  test('Property 3: every absent field is reported missing and never given a default', () => {
    fc.assert(
      fc.property(
        fc.record({
          venue: fc.boolean(),
          startsAt: fc.boolean(),
          endsAt: fc.boolean(),
          reservability: fc.boolean(),
        }),
        fc.boolean(),
        (absent, listedInMissingFields) => {
          const missingFields: string[] = [];
          const overrides: Parameters<typeof session>[0] = {};
          if (absent.venue) overrides.venue = undefined;
          if (absent.startsAt) {
            if (listedInMissingFields) missingFields.push('startsAt');
            else overrides.startsAt = undefined;
          }
          if (absent.endsAt) {
            if (listedInMissingFields) missingFields.push('endsAt');
            else overrides.endsAt = 'not a time';
          }
          if (absent.reservability) missingFields.push('isReservable');
          const s = session({ ...overrides, missingFields });
          const resolved = resolveCommitment(reserved(s), { s1: s });

          const expected: string[] = [];
          if (absent.venue) expected.push('venue');
          if (absent.startsAt) expected.push('startsAt');
          if (absent.endsAt) expected.push('endsAt');
          if (absent.reservability) expected.push('reservability');
          expect(resolved.missing).toEqual(expected);
          // No default is ever substituted for an absent value.
          expect(resolved.venue === undefined).toBe(absent.venue);
          expect(resolved.startsAt === undefined).toBe(absent.startsAt);
          expect(resolved.endsAt === undefined).toBe(absent.endsAt);
          expect(resolved.isReservable === undefined).toBe(absent.reservability);
        },
      ),
      { numRuns: 200 },
    );
  });
});
