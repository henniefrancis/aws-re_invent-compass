import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import * as reasons from '../../src/rules/reasons.js';

// Tests for caller text hardening in reasons (itinerary-rules, S2): names are cleaned, capped,
// counted by code point and quoted, and anything that is not text is treated as missing.
// All sample data is self-made.

const cp = (code: number): string => String.fromCodePoint(code);

describe('label and quoting hardening', () => {
  test('strips control, format, line and paragraph separator characters', () => {
    const hostile = `a${cp(0x202e)}b${cp(0x200b)}c${cp(0)}d${cp(0x1b)}e${cp(0x2028)}f${cp(0x2029)}g${cp(0x85)}h`;
    expect(reasons.label(hostile)).toBe('abc d e f');
    expect(reasons.label(`line one${cp(10)}line two${cp(13)}${cp(9)}line three`)).toBe(
      'line one line two',
    );
    expect(reasons.label(`${cp(0x202e)}${cp(0x200d)}`)).toBe('unnamed item');
    expect(reasons.stamp(`2026-12-01${cp(0x2028)}10:00${cp(0x202e)} more`)).toBe(
      '2026-12-01 10:00',
    );
  });

  test('counts code points, so an emoji is never split in half', () => {
    const emoji = cp(0x1f600);
    const name = `a${emoji.repeat(40)}`;
    expect(Array.from(reasons.label(name))).toHaveLength(30);
    expect(reasons.label(name)).toBe(`a${emoji.repeat(29)}`);
    expect(Array.from(reasons.stamp(emoji.repeat(40)))).toHaveLength(20);
    // No lone surrogate halves are left behind.
    expect(reasons.label(name).isWellFormed()).toBe(true);
  });

  test('a name with no letter or number is shown as unnamed item', () => {
    const emoji = cp(0x1f600);
    for (const value of [
      '!!!',
      '---',
      '...',
      '()',
      '?!',
      emoji,
      `${emoji}${emoji}`,
      '"',
      '  _ ',
      '#%&',
    ]) {
      expect(reasons.label(value), value).toBe('unnamed item');
      expect(reasons.q(value), value).toBe('"unnamed item"');
    }
    // A single letter or number is enough, wherever it is, in any script.
    for (const value of ['a!', '!a', '7', '#7', '\u00e9', '\u4e2d\u6587', '\u0661']) {
      expect(reasons.label(value), value).not.toBe('unnamed item');
    }
    expect(reasons.label('DAT302-R')).toBe('DAT302-R');
  });

  test('names are quoted, and a double quote inside a name cannot close the quotes', () => {
    expect(reasons.q('Wynn')).toBe('"Wynn"');
    expect(reasons.q('say "hi" now')).toBe(`"say 'hi' now"`);
    expect(reasons.clashOverlap('A', 'B', 'x', 'y')).toBe('"A" and "B" overlap from x to y.');
    expect(reasons.guardContextInvalid('bufferMinutes')).toBe(
      'The setting "bufferMinutes" is not valid. The reservation could not be checked.',
    );
  });

  test('anything that is not text is treated as missing and never throws', () => {
    for (const value of [undefined, null, 42, true, {}, [], () => 1, Symbol('x'), 10n]) {
      expect(reasons.label(value)).toBe('unnamed item');
      expect(reasons.q(value)).toBe('"unnamed item"');
      expect(reasons.stamp(value)).toBe('');
    }
  });

  test('a label is always short, quote free and free of control and format characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (text) => {
        const out = reasons.label(text);
        expect(Array.from(out).length).toBeLessThanOrEqual(30);
        expect(out.split(/\s+/).length).toBeLessThanOrEqual(4);
        expect(out).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"]/u);
        expect(out.length).toBeGreaterThan(0);
        expect(out).toBe(out.trim());
      }),
      { numRuns: 300 },
    );
  });
});
