import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { SessionWireSchema } from '../src/index.js';

// Unit test for the required catalog edge cases (foundation-contracts, S0).
//
// Validates: Requirement 6.4.
//
// The committed catalog must contain at least one of each optional-field edge case
// so that every optional path is exercised downstream:
//   - a repeat (abbreviation ending in -R or -R<digit>);
//   - an all-day session (isAllDaySession true);
//   - a session with no venue (venue field absent);
//   - a session with no end time (a sessionTime with a time but no length, and not
//     all-day).

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');
const catalogPath = resolve(repoRoot, 'fixtures', 'synthetic', 'catalog.json');

interface Session {
  abbreviation?: string;
  venue?: string;
  type?: string;
  isAllDaySession?: boolean;
  isReservable?: boolean;
  seatAvailability?: string;
  sessionTime?: { time?: string; length?: string };
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Session[];

describe('Feature: foundation-contracts, synthetic catalog edge cases', () => {
  test('contains at least one repeat (-R) session', () => {
    const repeats = catalog.filter((s) => /-R[0-9]?$/.test(s.abbreviation ?? ''));
    expect(repeats.length).toBeGreaterThanOrEqual(1);
  });

  test('contains at least one all-day session', () => {
    const allDay = catalog.filter((s) => s.isAllDaySession === true);
    expect(allDay.length).toBeGreaterThanOrEqual(1);
  });

  test('contains at least one session with no venue', () => {
    const missingVenue = catalog.filter((s) => s.venue === undefined);
    expect(missingVenue.length).toBeGreaterThanOrEqual(1);
  });

  test('contains at least one session with no end time (time present, length absent, not all-day)', () => {
    const missingEnd = catalog.filter(
      (s) =>
        s.isAllDaySession !== true &&
        s.sessionTime !== undefined &&
        s.sessionTime.time !== undefined &&
        s.sessionTime.length === undefined,
    );
    expect(missingEnd.length).toBeGreaterThanOrEqual(1);
  });

  test('contains at least one non-reservable breakout session (walk-up only)', () => {
    // The re:Invent FAQ: lecture-style breakout sessions take no reservation.
    const nonReservableBreakouts = catalog.filter(
      (s) => s.type === 'Breakout session' && s.isReservable === false,
    );
    expect(nonReservableBreakouts.length).toBeGreaterThanOrEqual(1);
    // Every breakout is non-reservable and walk-up.
    for (const s of catalog.filter((s) => s.type === 'Breakout session')) {
      expect(s.isReservable).toBe(false);
      expect(s.seatAvailability).toBe('walkUp');
    }
  });

  test('contains at least one keynote, non-reservable and walk-up', () => {
    const keynotes = catalog.filter((s) => s.type === 'Keynote');
    expect(keynotes.length).toBeGreaterThanOrEqual(1);
    for (const s of keynotes) {
      expect(s.isReservable).toBe(false);
      expect(s.seatAvailability).toBe('walkUp');
    }
  });

  test('every committed session still validates against SessionWireSchema', () => {
    for (const session of catalog) {
      expect(SessionWireSchema.safeParse(session).success).toBe(true);
    }
  });
});
