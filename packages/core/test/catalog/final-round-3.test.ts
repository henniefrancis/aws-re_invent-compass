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

  test('another letter case, an unknown name and an empty value are refused', () => {
    for (const zone of ['utc', 'Utc', 'america/los_angeles', 'EUROPE/LONDON', 'Not/AZone', '']) {
      expect(isValidTimeZone(zone)).toBe(false);
    }
  });

  test('an alias the runtime resolves to another name is refused (documented limit)', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(false);
  });
});
