import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  TIME_NOT_AVAILABLE,
  dayHeading,
  formatDateInZone,
  formatInZone,
  formatInZone24,
  formatWallClock,
  offsetLabel,
  timezoneNote,
} from '../../src/lib/time/time-format';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function offsetText(minutes: number): string {
  if (minutes === 0) {
    return 'Z';
  }
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const offsetMinutes = fc.integer({ min: -48, max: 56 }).map((q) => q * 15);

const isoArb = fc
  .record({
    year: fc.integer({ min: 2020, max: 2035 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
    offset: offsetMinutes,
  })
  .map((p) => ({
    ...p,
    iso: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offsetText(p.offset)}`,
  }));

function expectedTwelveHour(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(h)}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The ISO text of an instant written with the offset an IANA zone has at that instant. */
function isoInZone(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const zone = get('timeZoneName');
  const offset = zone === 'GMT' ? 'Z' : zone.replace('GMT', '');
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

const ZONES = [
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Pacific/Auckland',
  'America/St_Johns',
  'UTC',
];

describe('time formatting examples', () => {
  test('formats midnight, noon and afternoon in 12-hour form', () => {
    expect(formatWallClock('2026-11-30T00:05:00-08:00')).toBe('12:05 AM');
    expect(formatWallClock('2026-11-30T12:00:00-08:00')).toBe('12:00 PM');
    expect(formatWallClock('2026-11-30T14:30-08:00')).toBe('2:30 PM');
    expect(formatWallClock('2026-11-30T10:20:00.000Z')).toBe('10:20 AM');
  });

  test('shows a fixed text for a value that is not an ISO date-time with an offset', () => {
    expect(formatWallClock('tomorrow')).toBe(TIME_NOT_AVAILABLE);
    expect(formatWallClock('2026-11-30T10:20:00')).toBe(TIME_NOT_AVAILABLE);
    expect(offsetLabel('tomorrow')).toBe('offset not available');
  });

  test('labels offsets, with zero as UTC', () => {
    expect(offsetLabel('2026-11-30T10:20:00-08:00')).toBe('UTC-08:00');
    expect(offsetLabel('2026-11-30T10:20:00+05:45')).toBe('UTC+05:45');
    expect(offsetLabel('2026-11-30T10:20:00Z')).toBe('UTC');
    expect(offsetLabel('2026-11-30T10:20:00+00:00')).toBe('UTC');
  });

  test('formats an instant in an IANA zone', () => {
    expect(formatInZone('2026-11-30T22:30:00Z', 'America/Los_Angeles')).toBe('2:30 PM');
    expect(formatInZone('2026-11-30T22:30:00Z', 'UTC')).toBe('10:30 PM');
  });

  test('builds a day heading from an event local date', () => {
    expect(dayHeading('2026-11-30')).toBe('Monday 30 November');
    expect(dayHeading('2026-12-03')).toBe('Thursday 3 December');
  });

  test('states one timezone note only when all offsets agree', () => {
    expect(timezoneNote([])).toBeNull();
    expect(timezoneNote(['2026-11-30T10:20:00-08:00', '2026-12-01T09:00:00-08:00'])).toBe(
      'Times are event local time (UTC-08:00).',
    );
    expect(timezoneNote(['2026-11-30T10:20:00-08:00', '2026-12-01T09:00:00-07:00'])).toBeNull();
  });
});

describe('Property 9: Event local time formatting preserves the wall clock', () => {
  // Feature: showcase-site, Property 9: Event local time formatting preserves the wall clock
  test('formatWallClock shows the hour and minute written in the string', () => {
    fc.assert(
      fc.property(isoArb, (p) => {
        expect(formatWallClock(p.iso)).toBe(expectedTwelveHour(p.hour, p.minute));
      }),
      { numRuns: 200 },
    );
  });

  test('formatInZone equals formatWallClock of the instant written with the zone offset', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 11, 31) }),
        fc.constantFrom(...ZONES),
        (epochMs, zone) => {
          const written = isoInZone(epochMs, zone);
          expect(formatInZone(new Date(epochMs).toISOString(), zone)).toBe(
            formatWallClock(written),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  test('timezoneNote returns one note exactly when all offsets in the view agree', () => {
    fc.assert(
      fc.property(fc.array(isoArb, { minLength: 1, maxLength: 6 }), (items) => {
        const labels = new Set(items.map((i) => offsetLabel(i.iso)));
        const note = timezoneNote(items.map((i) => i.iso));
        if (labels.size === 1) {
          expect(note).toBe(`Times are event local time (${[...labels][0] ?? ''}).`);
        } else {
          expect(note).toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('24-hour and date in a zone', () => {
  test('write the wall clock with two digits and the date as day, short month, year', () => {
    expect(formatInZone24('2026-12-03T21:05:00Z', 'America/Los_Angeles')).toBe('13:05');
    expect(formatInZone24('2026-12-03T08:00:00Z', 'UTC')).toBe('08:00');
    expect(formatInZone24('2026-12-03T00:00:00Z', 'UTC')).toBe('00:00');
    expect(formatDateInZone('2026-12-03T21:05:00Z', 'America/Los_Angeles')).toBe('3 Dec 2026');
    expect(formatDateInZone('2026-12-04T03:00:00Z', 'America/Los_Angeles')).toBe('3 Dec 2026');
  });
});
