import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  MAX_ABSTRACT_CODE_POINTS,
  MAX_TITLE_CODE_POINTS,
  sanitiseText,
} from '../../src/api/sanitise-text.js';
import { createHarness, response } from './operation-harness.js';
import { getSchedule } from '../../src/api/get-schedule.js';

// Tests for text sanitising (events-client, S1, security finding N1). Special
// characters are built with String.fromCodePoint so the source holds no raw control
// or bidirectional characters.

const ch = (code: number): string => String.fromCodePoint(code);
const RLO = ch(0x202e);
const ZWSP = ch(0x200b);
const NUL = ch(0);

const REMOVED = [
  0x00, 0x01, 0x07, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0x7f, 0x80, 0x85, 0x9f, 0x200b, 0x200c, 0x200d,
  0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
];

function hasRemoved(text: string): boolean {
  return [...text].some((c) => {
    const code = c.codePointAt(0) ?? 0;
    return REMOVED.includes(code) || code <= 0x08 || (code >= 0x0b && code <= 0x1f);
  });
}

describe('events-client, N1: sanitiseText', () => {
  test('every control, zero-width and bidirectional character is removed', () => {
    for (const code of REMOVED) {
      expect(sanitiseText(`a${ch(code)}b`)).toBe('ab');
    }
  });

  test('in single-line text a tab, newline or carriage return becomes a space', () => {
    expect(sanitiseText('a\tb\nc\rd')).toBe('a b c d');
  });

  test('in multi-line text a newline is kept and a carriage return is dropped', () => {
    expect(sanitiseText('a\r\nb\tc', { multiline: true })).toBe('a\nb c');
  });

  test('text is normalised to NFC', () => {
    const decomposed = `e${ch(0x301)}`;
    expect(decomposed).toHaveLength(2);
    expect(sanitiseText(decomposed)).toBe(ch(0xe9));
  });

  test('truncation counts code points, never splits a surrogate pair, and never rejects', () => {
    const emoji = ch(0x1f600);
    const cut = sanitiseText(emoji.repeat(400));
    expect([...cut]).toHaveLength(MAX_TITLE_CODE_POINTS);
    expect(cut.endsWith(emoji)).toBe(true);
    expect([
      ...sanitiseText('a'.repeat(6000), {
        multiline: true,
        maxCodePoints: MAX_ABSTRACT_CODE_POINTS,
      }),
    ]).toHaveLength(5000);
    expect(sanitiseText('abcdef', { maxCodePoints: 3 })).toBe('abc');
    expect(sanitiseText('')).toBe('');
  });

  test('for any string the result is clean, within the limit, NFC and unchanged by a second pass', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 400 }),
        fc.boolean(),
        (text, multiline) => {
          const out = sanitiseText(text, { multiline, maxCodePoints: 50 });
          expect([...out].length).toBeLessThanOrEqual(50);
          expect(out).toBe(out.normalize('NFC'));
          if (!multiline) {
            expect(out).not.toMatch(/[\n\r\t]/);
          }
          expect(hasRemoved(out.replaceAll('\n', ''))).toBe(false);
          expect(sanitiseText(out, { multiline, maxCodePoints: 50 })).toBe(out);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('events-client, N1: personal time text is sanitised as the schedule is read', () => {
  test('title is single-line and description multi-line, both cleaned and truncated', async () => {
    const entry = {
      personalTimeId: 'p1',
      startDateTime: 's',
      endDateTime: 'e',
      title: `Lunch${RLO}\nBreak${'x'.repeat(400)}`,
      description: `Line one\r\nLine${ZWSP} two${'y'.repeat(6000)}`,
      location: `Room${NUL} 1`,
    };
    const bare = { ...entry, personalTimeId: 'p2', location: undefined };
    const h = createHarness({
      responses: [
        response(200, { schedule: { reserved: [], favorites: [], personalTime: [entry, bare] } }),
      ],
    });
    const { schedule } = await getSchedule(h.ctx);
    const first = schedule.personalTime[0];
    expect(first?.title.startsWith('Lunch Break')).toBe(true);
    expect([...(first?.title ?? '')]).toHaveLength(300);
    expect(first?.description.startsWith('Line one\nLine two')).toBe(true);
    expect([...(first?.description ?? '')]).toHaveLength(5000);
    expect(first?.location).toBe('Room 1');
    expect(schedule.personalTime[1]?.location).toBeUndefined();
  });
});
