import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { parseIsoWithOffset } from '../../src/lib/time/iso';
import { isoArb } from '../support/handoff-data';

describe('parseIsoWithOffset', () => {
  test('reads real date-times with Z, positive and negative offsets and fractions', () => {
    expect(parseIsoWithOffset('2026-11-30T10:20:00Z')).toBe(Date.parse('2026-11-30T10:20:00Z'));
    expect(parseIsoWithOffset('2026-11-30T10:20:00-08:00')).toBe(
      Date.parse('2026-11-30T18:20:00Z'),
    );
    expect(parseIsoWithOffset('2026-11-30T10:20:00+05:45')).toBe(
      Date.parse('2026-11-30T04:35:00Z'),
    );
    expect(parseIsoWithOffset('2026-11-30T10:20:00.5Z')).toBe(
      Date.parse('2026-11-30T10:20:00.500Z'),
    );
    expect(parseIsoWithOffset('2028-02-29T00:00:00Z')).toBe(Date.parse('2028-02-29T00:00:00Z'));
  });

  test('refuses text that is not a real date-time with an offset', () => {
    const refused = [
      '',
      '2026-11-30',
      '2026-11-30T10:20:00',
      '2026-11-30 10:20:00Z',
      '2026-11-30T10:20Z',
      '2026-02-30T10:20:00Z',
      '2027-02-29T10:20:00Z',
      '2026-13-01T10:20:00Z',
      '2026-00-10T10:20:00Z',
      '2026-11-00T10:20:00Z',
      '2026-11-30T24:00:00Z',
      '2026-11-30T10:60:00Z',
      '2026-11-30T10:20:60Z',
      '2026-11-30T10:20:00+24:00',
      '2026-11-30T10:20:00+05:60',
      '0099-11-30T10:20:00Z',
      '2026-11-30T10:20:00Z ',
    ];
    for (const text of refused) {
      expect(parseIsoWithOffset(text), text).toBeNull();
    }
  });

  test('agrees with Date.parse for every generated real date-time', () => {
    fc.assert(
      fc.property(isoArb, (iso) => {
        expect(parseIsoWithOffset(iso)).toBe(Date.parse(iso));
      }),
      { numRuns: 300 },
    );
  });
});
