import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { parseBoardFragment, rawFragment } from '../../src/lib/board/fragment';
import { FIXED_ID, idArb, idFromBytes } from '../support/handoff-data';

describe('parseBoardFragment examples', () => {
  test('accepts #h= and a canonical id', () => {
    expect(parseBoardFragment(`#h=${FIXED_ID}`)).toEqual({ ok: true, id: FIXED_ID });
  });

  test('refuses every other form', () => {
    const refused = [
      '',
      '#',
      '#h=',
      `h=${FIXED_ID}`,
      `#H=${FIXED_ID}`,
      `#h=${FIXED_ID}&x=1`,
      `#h=${FIXED_ID}=`,
      `#h=${FIXED_ID} `,
      ` #h=${FIXED_ID}`,
      `#h=${FIXED_ID}\n`,
      `#h=${FIXED_ID.slice(0, 21)}`,
      `#h=${FIXED_ID}A`,
      `#h=${FIXED_ID.slice(0, 21)}B`,
      `#h=${FIXED_ID.slice(0, 21)}%41`,
      `?h=${FIXED_ID}`,
      `#x=1#h=${FIXED_ID}`,
    ];
    for (const hash of refused) {
      expect(parseBoardFragment(hash), JSON.stringify(hash)).toEqual({ ok: false });
    }
  });
});

describe('Property 1: The fragment parser accepts exactly the canonical hand-off ids', () => {
  // Feature: showcase-site, Property 1: The fragment parser accepts exactly the canonical hand-off ids
  test('any 16 bytes in unpadded base64url are accepted and decode back to the same bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 16 }), (bytes) => {
        const result = parseBoardFragment(`#h=${idFromBytes(bytes)}`);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.id).toHaveLength(22);
          expect([...Buffer.from(result.id, 'base64url')]).toEqual([...bytes]);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('any other string is refused', () => {
    const canonical = /^#h=[A-Za-z0-9_-]{21}[AQgw]$/;
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (text) => {
        fc.pre(!canonical.test(text));
        expect(parseBoardFragment(text)).toEqual({ ok: false });
      }),
      { numRuns: 300 },
    );
  });

  test('every mutation of a valid fragment is refused', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    fc.assert(
      fc.property(
        idArb,
        fc.constantFrom(
          'prefix',
          'padding',
          'percent',
          'short',
          'long',
          'badChar',
          'badLast',
          'trailing',
          'otherKey',
        ),
        fc.integer({ min: 0, max: 20 }),
        (id, mutation, at) => {
          const fragment = `#h=${id}`;
          const mutated: Record<string, string> = {
            prefix: `#g=${id}`,
            padding: `#h=${id}==`,
            percent: `#h=${id.slice(0, at)}%41${id.slice(at + 1, 21)}${id.slice(21)}`,
            short: `#h=${id.slice(0, 21)}`,
            long: `#h=${id}${alphabet.charAt(at)}`,
            badChar: `#h=${id.slice(0, at)}!${id.slice(at + 1)}`,
            badLast: `#h=${id.slice(0, 21)}${'BCDEFHIJKLMNOPRSTUVWXYZhijklmnopqrstuvxyz0123456789_-'.charAt(at)}`,
            trailing: `${fragment}&a=1`,
            otherKey: `#k=${id}`,
          };
          expect(parseBoardFragment(mutated[mutation] ?? '')).toEqual({ ok: false });
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('rawFragment (QA L8)', () => {
  test('is everything from the first # of the address, exactly as written', () => {
    expect(rawFragment(`https://x.invalid/board#h=${FIXED_ID}`)).toBe(`#h=${FIXED_ID}`);
    expect(rawFragment('https://x.invalid/board')).toBe('');
    expect(rawFragment('https://x.invalid/board?a=1#h=%41bc#more')).toBe('#h=%41bc#more');
    expect(rawFragment('https://x.invalid/board#')).toBe('#');
  });

  test('a percent-encoded id is never decoded, so the parser refuses it', () => {
    const encoded = `#h=%41${FIXED_ID.slice(1)}`;
    expect(rawFragment(`https://x.invalid/board${encoded}`)).toBe(encoded);
    expect(parseBoardFragment(rawFragment(`https://x.invalid/board${encoded}`))).toEqual({
      ok: false,
    });
    expect(parseBoardFragment(rawFragment(`https://x.invalid/board#h=${FIXED_ID}`)).ok).toBe(true);
  });
});
