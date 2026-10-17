import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Unit test for the synthetic catalog's repeats (foundation-contracts, S0).
//
// Every session whose code ends in -R or -R<digit> must be a true repeat: a base
// session with the stripped code exists with an equal title, type and level, and
// the repeat does not overlap that base in time. Codes are not unique across the
// catalog, so a repeat is matched against every session that carries the stripped
// code and shares its title, type and level.

const here = resolve(fileURLToPath(import.meta.url), '..');
const catalogPath = resolve(here, '..', '..', '..', 'fixtures', 'synthetic', 'catalog.json');

interface Session {
  sessionId: string;
  abbreviation: string;
  title: string;
  type: string;
  level: string;
  sessionTime: { date: string; time: string; length?: string };
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Session[];
const REPEAT = /-R[0-9]?$/;
const repeats = catalog.filter((s) => REPEAT.test(s.abbreviation));

/** Minutes since midnight for an "HH:MM" start time. */
function startMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

/** Whether two sessions overlap in time (same date and intersecting intervals). */
function overlaps(a: Session, b: Session): boolean {
  if (a.sessionTime.date !== b.sessionTime.date) return false;
  const aStart = startMinutes(a.sessionTime.time);
  const bStart = startMinutes(b.sessionTime.time);
  const aEnd = aStart + Number(a.sessionTime.length ?? 0);
  const bEnd = bStart + Number(b.sessionTime.length ?? 0);
  return aStart < bEnd && bStart < aEnd;
}

describe('Feature: foundation-contracts, synthetic catalog repeats', () => {
  test('the catalog has repeats', () => {
    expect(repeats.length).toBeGreaterThanOrEqual(1);
  });

  test.each(repeats.map((r) => [r.abbreviation, r] as const))(
    '%s has a base with an equal title, type and level',
    (_code, repeat) => {
      const code = repeat.abbreviation.replace(REPEAT, '');
      const bases = catalog.filter(
        (s) =>
          s.abbreviation === code &&
          s.title === repeat.title &&
          s.type === repeat.type &&
          s.level === repeat.level,
      );
      expect(bases.length).toBeGreaterThanOrEqual(1);
      for (const base of bases) {
        expect(overlaps(repeat, base)).toBe(false);
      }
    },
  );
});
