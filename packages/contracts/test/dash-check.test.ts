import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
// The dash scanner is an ESM .mjs under .github/scripts, imported by relative
// path. It is not in the coverage include set, so this test checks behaviour
// without affecting coverage thresholds.
import { scanText, dashCheck, EXCLUDED } from '../../../.github/scripts/dash-check.mjs';

// Property test for the dash scanner (foundation-contracts, S0).
//
// Property 10: The dash scanner flags em and en dashes and only those.
// Validates: Requirements 7.3, 8.4, 12.8, 12.9.
//
// scanText reports a finding for every em dash (U+2014) and en dash (U+2013) and
// for no other character, including look-alikes such as the ASCII hyphen-minus
// (U+002D), the figure dash (U+2012), the horizontal bar (U+2015) and the minus
// sign (U+2212). dashCheck honours the single LICENSE exclusion.

const EM = '\u2014';
const EN = '\u2013';

const NUM_RUNS = 200;

// Characters that must NOT be flagged, including dash look-alikes.
const NON_DASH = [
  '-', // U+002D hyphen-minus
  '\u2010', // hyphen
  '\u2011', // non-breaking hyphen
  '\u2012', // figure dash
  '\u2015', // horizontal bar
  '\u2212', // minus sign
  'a',
  '1',
  ' ',
  '.',
  '_',
  '/',
];

describe('Feature: foundation-contracts, Property 10: The dash scanner flags em and en dashes and only those', () => {
  test('Feature: foundation-contracts, Property 10: counts em and en dashes and ignores look-alikes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constant(EM), fc.constant(EN), fc.constantFrom(...NON_DASH)), {
          maxLength: 40,
        }),
        (chars) => {
          const text = chars.join('');
          const expectedEm = chars.filter((c) => c === EM).length;
          const expectedEn = chars.filter((c) => c === EN).length;

          const findings = scanText(text);
          const emHits = findings.filter((f) => f.kind === 'em dash').length;
          const enHits = findings.filter((f) => f.kind === 'en dash').length;

          // Exactly the dashes are flagged, and nothing else.
          expect(emHits).toBe(expectedEm);
          expect(enHits).toBe(expectedEn);
          expect(findings.length).toBe(expectedEm + expectedEn);
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test('Feature: foundation-contracts, Property 10: reports the correct line and column', () => {
    // A dash on the second line at a known column is reported at that position.
    const text = 'clean first line\nword ' + EM + ' tail';
    const findings = scanText(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 2, column: 6, kind: 'em dash' });
  });

  test('Feature: foundation-contracts, Property 10: dashCheck flags a tracked file and honours the LICENSE exclusion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dash-check-'));
    try {
      // A file with an en dash is flagged.
      await writeFile(join(dir, 'doc.md'), `title ${EN} subtitle\n`, 'utf8');
      // LICENSE carries a dash but is excluded, so it must not be flagged.
      await writeFile(join(dir, 'LICENSE'), `license ${EM} text\n`, 'utf8');
      // A clean file is never flagged.
      await writeFile(join(dir, 'clean.txt'), 'no dashes here, only hyphen-minus\n', 'utf8');

      const { ok, findings } = dashCheck({
        cwd: dir,
        files: ['doc.md', 'LICENSE', 'clean.txt'],
      });
      expect(ok).toBe(false);
      // Exactly one finding, from doc.md, and never from LICENSE or clean.txt.
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ file: 'doc.md', kind: 'en dash' });
      expect(findings.some((f) => f.file === 'LICENSE')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('Feature: foundation-contracts, Property 10: LICENSE is the named exclusion', () => {
    expect(EXCLUDED.has('LICENSE')).toBe(true);
  });

  afterEach(() => {
    // no-op: temp dirs are cleaned within each test that creates them
  });

  beforeEach(() => {
    // no-op
  });
});
