import { describe, expect, test } from 'vitest';
import { computeSessionInterval, isValidTimeZone } from '../../src/catalog/session-time.js';

// Strict time zone checks (events-client, S1, L2): an exact runtime name, UTC, or the
// runtime's canonical name; never an offset string, never another letter case.

describe('events-client, L2: strict time zones', () => {
  test('offset strings are refused, even though the runtime would parse them', () => {
    for (const zone of ['+08:00', '-05:00', '+0800', '+08', '-0500', '+00:00', '-00:00']) {
      expect(isValidTimeZone(zone)).toBe(false);
      expect(
        computeSessionInterval(
          { date: '2026-12-01', time: '10:00', length: '30', timezone: zone },
          'UTC',
        ),
      ).toBeUndefined();
    }
  });

  test('UTC, exact runtime names and the runtime canonical name are accepted', () => {
    for (const zone of [
      'UTC',
      'America/Los_Angeles',
      'Europe/London',
      'Asia/Calcutta',
      'Etc/GMT+8',
    ]) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
  });

  test('a valid IANA alias the runtime resolves to another name is accepted (Asia/Kolkata)', () => {
    for (const zone of [
      'Asia/Kolkata',
      'Asia/Saigon',
      'America/Argentina/Buenos_Aires',
      'Europe/Kiev',
    ]) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
    expect(
      computeSessionInterval(
        { date: '2026-12-01', time: '10:00', length: '30', timezone: 'Asia/Kolkata' },
        'UTC',
      )?.startsAt,
    ).toBe('2026-12-01T10:00:00+05:30');
  });

  test('all-lower-case, all-capitals, other-case spellings, unknown names and empty values are refused', () => {
    for (const zone of [
      'utc',
      'Utc',
      'america/los_angeles',
      'EUROPE/LONDON',
      'AMERICA/LOS_ANGELES',
      'ASIA/KOLKATA',
      'asia/kolkata',
      'Europe/PARIS',
      'Not/AZone',
      '',
    ]) {
      expect(isValidTimeZone(zone)).toBe(false);
    }
  });
});
