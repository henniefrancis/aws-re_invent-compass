import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import * as reasons from '../../src/rules/reasons.js';

// Tests for the plain-English reason builders (itinerary-rules, S2).
// Requirements: 8.10, 11.6, 12.3. All sample data is self-made.

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

// Free text with dashes, long words, line breaks and empty strings mixed in.
const freeText = fc.oneof(
  fc.string({ maxLength: 120 }),
  fc.constantFrom(
    `Mandalay ${EM_DASH} Bay`,
    `Wynn ${EN_DASH} Encore`,
    '',
    '   ',
    'a b c d e f g h i j k l m n o p q r s t u v w x y z',
    'line one\nline two\tline three',
    'DAT302-R',
  ),
);
const num = fc.integer({ min: -100000, max: 100000 });
const flag = fc.boolean();
const zone = fc.constantFrom<'missing' | 'unrecognised'>('missing', 'unrecognised');
const edge = fc.constantFrom<'start' | 'end'>('start', 'end');
const placement = fc.constantFrom<'after' | 'before'>('after', 'before');
const kind = fc.constantFrom<'meal' | 'rest'>('meal', 'rest');
const alert = fc.constantFrom<'tight' | 'impossible'>('tight', 'impossible');
const rule = fc.constantFrom(...Object.values(reasons.RULE_NAMES));

// Every builder, paired with an arbitrary for its arguments.
const builders: Array<[string, fc.Arbitrary<string>]> = [
  ['zoneProblem', zone.map((z) => reasons.zoneProblem(z))],
  ['missingTime', fc.tuple(freeText, edge).map(([r, e]) => reasons.missingTime(r, e))],
  ['boardingCloses', freeText.map((t) => reasons.boardingCloses(t))],
  ['boardingNotApplicable', fc.constant(reasons.boardingNotApplicable())],
  ['boardingMissingStart', fc.constant(reasons.boardingMissingStart())],
  ['boardingMissingReservability', fc.constant(reasons.boardingMissingReservability())],
  [
    'connectionComfortable',
    fc
      .tuple(freeText, freeText, num, flag, num)
      .map(([a, b, m, e, s]) => reasons.connectionComfortable(a, b, m, e, s)),
  ],
  [
    'connectionTight',
    fc
      .tuple(freeText, freeText, num, flag, num)
      .map(([a, b, m, e, s]) => reasons.connectionTight(a, b, m, e, s)),
  ],
  [
    'connectionImpossible',
    fc
      .tuple(freeText, freeText, num, flag, num)
      .map(([a, b, m, e, s]) => reasons.connectionImpossible(a, b, m, e, s)),
  ],
  ['connectionVenueMissing', freeText.map((r) => reasons.connectionVenueMissing(r))],
  ['connectionVenueNotListed', freeText.map((r) => reasons.connectionVenueNotListed(r))],
  [
    'connectionPairMissing',
    fc.tuple(freeText, freeText).map(([a, b]) => reasons.connectionPairMissing(a, b)),
  ],
  ['connectionBoardingMissing', freeText.map((r) => reasons.connectionBoardingMissing(r))],
  [
    'connectionTimeMissing',
    fc.tuple(freeText, edge).map(([r, e]) => reasons.connectionTimeMissing(r, e)),
  ],
  [
    'connectionAlert',
    fc
      .tuple(alert, fc.constant('The walk is short.'))
      .map(([k, r]) => reasons.connectionAlert(k, r)),
  ],
  [
    'clashOverlap',
    fc
      .tuple(freeText, freeText, freeText, freeText)
      .map(([a, b, f, t]) => reasons.clashOverlap(a, b, f, t)),
  ],
  ['clashTimeMissing', fc.tuple(freeText, edge).map(([r, e]) => reasons.clashTimeMissing(r, e))],
  [
    'mealLayoverMissing',
    fc.tuple(freeText, num, num).map(([d, f, r]) => reasons.mealLayoverMissing(d, f, r)),
  ],
  ['longStretch', fc.tuple(freeText, num, num).map(([d, m, x]) => reasons.longStretch(d, m, x))],
  ['suggestMealBlock', fc.constant(reasons.suggestMealBlock())],
  ['suggestRestBlock', placement.map((p) => reasons.suggestRestBlock(p))],
  ['noPlacement', kind.map((k) => reasons.noPlacement(k))],
  [
    'energyExplanation',
    fc.tuple(num, num, num, num).map(([s, c, w, v]) => reasons.energyExplanation(s, c, w, v)),
  ],
  ['energyDataMissing', freeText.map((r) => reasons.energyDataMissing(r))],
  [
    'energyWalkUnknown',
    fc.tuple(freeText, freeText).map(([a, b]) => reasons.energyWalkUnknown(a, b)),
  ],
  [
    'energyCountOnly',
    fc.tuple(num, num, flag).map(([c, l, o]) => reasons.energyCountOnly(c, l, o)),
  ],
  [
    'energyOverloadVerdict',
    fc.tuple(flag, num).map(([o, t]) => reasons.energyOverloadVerdict(o, t)),
  ],
  ['rebookRepeat', fc.tuple(freeText, freeText).map(([c, t]) => reasons.rebookRepeat(c, t))],
  ['rebookStandby', fc.tuple(freeText, freeText).map(([c, t]) => reasons.rebookStandby(c, t))],
  [
    'rebookWalkUp',
    fc.tuple(freeText, freeText, flag).map(([c, t, f]) => reasons.rebookWalkUp(c, t, f)),
  ],
  ['rebookNone', fc.constant(reasons.rebookNone())],
  ['rebookFound', num.map((n) => reasons.rebookFound(n))],
  ['rebookFoundOne', fc.constant(reasons.rebookFound(1))],
  ['rebookZoneProblem', zone.map((z) => reasons.rebookZoneProblem(z))],
  ['rebookNowUnusable', fc.constant(reasons.rebookNowUnusable())],
  ['swapReserveStep', freeText.map((c) => reasons.swapReserveStep(c))],
  ['swapConfirmStep', fc.constant(reasons.swapConfirmStep())],
  ['swapCancelStep', flag.map((b) => reasons.swapCancelStep(b))],
  ['swapSafe', fc.constant(reasons.swapSafe())],
  ['swapUnsafe', fc.array(freeText, { maxLength: 5 }).map((refs) => reasons.swapUnsafe(refs))],
  ['swapFailed', fc.constant(reasons.swapFailed())],
  ['swapUnknown', fc.constant(reasons.swapUnknown())],
  ['guardMealLost', freeText.map((d) => reasons.guardMealLost(d))],
  [
    'guardOverload',
    fc
      .tuple(freeText, fc.constant('Energy score is 90.'))
      .map(([d, e]) => reasons.guardOverload(d, e)),
  ],
  [
    'guardMissingData',
    fc
      .tuple(rule, fc.constant('The end time of DAT302 is missing.'))
      .map(([r, d]) => reasons.guardMissingData(r, d)),
  ],
];

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== '');
}

describe('reason builders', () => {
  test('clean replaces em and en dashes with a hyphen', () => {
    expect(reasons.clean(`a ${EM_DASH} b ${EN_DASH} c`)).toBe('a - b - c');
    expect(reasons.clean('plain')).toBe('plain');
  });

  test('label caps words and length and never returns an empty name', () => {
    expect(reasons.label('one two three four five six')).toBe('one two three four');
    expect(reasons.label('x'.repeat(100))).toHaveLength(30);
    expect(reasons.label('   ')).toBe('unnamed item');
    expect(reasons.stamp('2026-12-01 10:00:00 extra')).toBe('2026-12-01 10:00:00');
    expect(reasons.stamp('x'.repeat(50))).toHaveLength(20);
  });

  test('mins uses the singular for one minute', () => {
    expect(reasons.mins(1)).toBe('1 minute');
    expect(reasons.mins(1.2)).toBe('1 minute');
    expect(reasons.mins(0)).toBe('0 minutes');
    expect(reasons.mins(20)).toBe('20 minutes');
  });

  test('representative strings read as plain English', () => {
    expect(reasons.connectionTight('Venetian', 'Wynn', 30, true, 3)).toBe(
      'The walk from Venetian to Wynn is 30 minutes, an estimate. That leaves only 3 minutes to spare.',
    );
    expect(reasons.boardingCloses('2026-12-01 10:20')).toBe(
      'Boarding closes at 2026-12-01 10:20. Your seat is released then.',
    );
    expect(reasons.connectionComfortable('A', 'B', 5, false, 9)).toBe(
      'The walk from A to B is 5 minutes. You arrive 9 minutes before it is due.',
    );
    expect(reasons.energyCountOnly(7, 6, true)).toBe('7 commitments is more than the limit of 6.');
    expect(reasons.energyCountOnly(3, 6, false)).toBe('3 commitments is within the limit of 6.');
    expect(reasons.energyOverloadVerdict(false, 100)).toBe('That is within the limit of 100.');
    expect(reasons.rebookWalkUp('X1', '2026-12-02 09:00', true)).toContain('is full');
    expect(reasons.rebookWalkUp('X1', '2026-12-02 09:00', false)).toContain('needs no reservation');
    expect(reasons.zoneProblem('missing')).toContain('missing');
    expect(reasons.zoneProblem('unrecognised')).toContain('not recognised');
    expect(reasons.connectionAlert('tight', 'x.')).toBe('Tight connection. x.');
    expect(reasons.swapCancelStep(false)).toContain('You can cancel');
  });

  // Feature: itinerary-rules, Property 18: Every produced string is plain English with no em dash or en dash
  test.each(builders)(
    'Property 18: %s has no em dash, no en dash and sentences of 20 words or fewer',
    (_name, arbitrary) => {
      fc.assert(
        fc.property(arbitrary, (text) => {
          expect(text).not.toContain(EM_DASH);
          expect(text).not.toContain(EN_DASH);
          expect(text.trim().length).toBeGreaterThan(0);
          for (const sentence of sentences(text)) {
            expect(sentence.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(20);
          }
        }),
        { numRuns: 100 },
      );
    },
  );
});
