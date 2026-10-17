import { describe, expect, test } from 'vitest';
import { createPassFieldsSchema } from '../src/index.js';

// Unit tests for the PassFields date bounds (foundation-contracts, S0, build plan
// section 5.3, ADR-026). startsAt, endsAt and nextConnection.startsAt accept an
// optional fraction of one to nine digits and at most 35 characters, so an
// attacker-sized date string can never reach joi isoDate inside passkit-generator.

const PASS_WINDOW = {
  start: '2026-11-30T00:00:00-08:00',
  end: '2026-12-05T00:00:00-08:00',
  timezone: 'America/Los_Angeles',
} as const;

const PassFieldsSchema = createPassFieldsSchema(PASS_WINDOW);

const BASE = {
  sessionCode: 'AIM101',
  title: 'Valid title',
  venue: 'Venetian',
  room: 'Room 101',
  startsAt: '2026-12-01T09:00:00-08:00',
  endsAt: '2026-12-01T10:00:00-08:00',
} as const;

// A valid next connection, so a rejection below can only come from its date.
const NEXT = {
  sessionCode: 'AIM102',
  startsAt: '2026-12-01T11:00:00-08:00',
  venue: 'Wynn',
  walkMinutes: 20,
} as const;

function accepted(fields: Record<string, unknown>): boolean {
  return PassFieldsSchema.safeParse({ ...BASE, ...fields }).success;
}

describe('Feature: foundation-contracts, PassFields date bounds', () => {
  test('accepts fractions of one to nine digits, the longest form included', () => {
    expect(accepted({ startsAt: '2026-12-01T09:00:00.1-08:00' })).toBe(true);
    expect(accepted({ startsAt: '2026-12-01T17:00:00.123Z' })).toBe(true);
    // 19 + 10 + 6 = 35 characters, the maximum.
    expect(accepted({ endsAt: '2026-12-01T10:00:00.123456789-08:00' })).toBe(true);
    expect(accepted({ nextConnection: NEXT })).toBe(true);
  });

  test('rejects a fraction longer than nine digits', () => {
    expect(accepted({ startsAt: '2026-12-01T09:00:00.1234567890-08:00' })).toBe(false);
  });

  test('rejects an attacker-sized fraction on every date field without echoing it', () => {
    const huge = `2026-12-01T10:00:00.${'0'.repeat(60_000)}Z`;
    for (const fields of [
      { startsAt: huge },
      { endsAt: huge },
      { nextConnection: { ...NEXT, startsAt: huge } },
    ]) {
      const result = PassFieldsSchema.safeParse({ ...BASE, ...fields });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).not.toContain('0000000000');
    }
  });

  test('rejects a string over 35 characters even with a valid shape prefix', () => {
    expect(accepted({ startsAt: '2026-12-01T09:00:00-08:00' + ' '.repeat(11) })).toBe(false);
  });
});
