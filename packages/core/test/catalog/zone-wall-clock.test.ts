// Wall-clock times in the event time zone (compass-power tasks 55 and 56).

import { describe, expect, test } from 'vitest';
import {
  fromZoneWallClock,
  startOfDayBefore,
  toZoneWallClock,
} from '../../src/catalog/session-time.js';

const LAS_VEGAS = 'America/Los_Angeles';

describe('toZoneWallClock', () => {
  test('writes an instant as the wall-clock time in the zone, whatever its own offset', () => {
    expect(toZoneWallClock('2026-11-30T07:00:00-08:00', LAS_VEGAS)).toBe('2026-11-30T07:00:00');
    expect(toZoneWallClock('2026-11-30T15:00:00Z', LAS_VEGAS)).toBe('2026-11-30T07:00:00');
    expect(toZoneWallClock('2026-11-30T17:00:00+02:00', LAS_VEGAS)).toBe('2026-11-30T07:00:00');
  });

  test('follows daylight saving time', () => {
    expect(toZoneWallClock('2026-07-01T15:00:00Z', LAS_VEGAS)).toBe('2026-07-01T08:00:00');
  });

  test('is undefined for a bad instant or zone', () => {
    expect(toZoneWallClock('nope', LAS_VEGAS)).toBeUndefined();
    expect(toZoneWallClock('2026-11-30T07:00:00-08:00', 'Not/AZone')).toBeUndefined();
  });
});

describe('fromZoneWallClock', () => {
  test('reads a wall-clock time in the zone as an instant with its offset', () => {
    expect(fromZoneWallClock('2026-11-30T07:00:00', LAS_VEGAS)).toBe('2026-11-30T07:00:00-08:00');
    expect(fromZoneWallClock('2026-07-01T08:00:00', LAS_VEGAS)).toBe('2026-07-01T08:00:00-07:00');
  });

  test('round trips with toZoneWallClock', () => {
    const instant = fromZoneWallClock('2026-12-02T12:30:00', LAS_VEGAS);
    expect(instant).toBe('2026-12-02T12:30:00-08:00');
    expect(toZoneWallClock(instant ?? '', LAS_VEGAS)).toBe('2026-12-02T12:30:00');
  });

  test('is undefined for a bad value, an impossible date or a bad zone', () => {
    expect(fromZoneWallClock('2026-11-30T07:00:00Z', LAS_VEGAS)).toBeUndefined();
    expect(fromZoneWallClock('2026-11-31T07:00:00', LAS_VEGAS)).toBeUndefined();
    expect(fromZoneWallClock('2026-11-30T07:00:00', 'Not/AZone')).toBeUndefined();
  });
});

describe('startOfDayBefore', () => {
  test('is midnight on the day before, in the zone', () => {
    expect(startOfDayBefore('2026-11-30T05:30:00.000-08:00', LAS_VEGAS)).toBe(
      '2026-11-29T00:00:00-08:00',
    );
    // 30 November 05:30 PST is still 30 November in Las Vegas, though it is 13:30 UTC.
    expect(startOfDayBefore('2026-11-30T13:30:00Z', LAS_VEGAS)).toBe('2026-11-29T00:00:00-08:00');
  });

  test('crosses a month and a daylight saving change', () => {
    expect(startOfDayBefore('2026-03-09T12:00:00-07:00', LAS_VEGAS)).toBe(
      '2026-03-08T00:00:00-08:00',
    );
    expect(startOfDayBefore('2026-12-01T09:00:00-08:00', LAS_VEGAS)).toBe(
      '2026-11-30T00:00:00-08:00',
    );
  });

  test('is undefined for a bad instant or zone', () => {
    expect(startOfDayBefore('nope', LAS_VEGAS)).toBeUndefined();
    expect(startOfDayBefore('2026-11-30T05:30:00-08:00', 'Not/AZone')).toBeUndefined();
  });
});
