import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  contrastRatio,
  interpolateSrgb,
  relativeLuminance,
  worstContrast,
  type Gradient,
  type Hex,
} from '../../src/lib/design/contrast';
import { CONTRAST_PAIRS, GRADIENTS, TOKENS } from '../../src/lib/design/tokens';

// The AWS brand colour denylist. No design token may use one of these colours.
const AWS_BRAND_DENYLIST: readonly string[] = [
  '#ff9900',
  '#f90',
  '#ec7211',
  '#232f3e',
  '#161e2d',
  '#146eb4',
  '#0073bb',
  '#0972d3',
  '#527fff',
  '#ff4f8b',
  '#d13212',
  '#1a476f',
  '#00a1c9',
];

const channel = fc.integer({ min: 0, max: 255 });
const hexArb = fc
  .tuple(channel, channel, channel)
  .map(([r, g, b]): Hex => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);

const gradientArb = fc
  .array(fc.tuple(hexArb, fc.double({ min: 0, max: 1, noNaN: true })), {
    minLength: 2,
    maxLength: 5,
  })
  .map((raw): Gradient => {
    const sorted = [...raw].sort((a, b) => a[1] - b[1]);
    return { stops: sorted.map(([colour, at]) => ({ colour, at })) };
  });

describe('contrast maths', () => {
  test('black on white is 21 and white on white is 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#000000')).toBe(0);
  });

  test('a colour that is not six hex digits is refused', () => {
    expect(() => relativeLuminance('#12345')).toThrow('hex string');
    expect(() => relativeLuminance('red' as Hex)).toThrow('hex string');
  });

  test('interpolation covers the stops, the ends and the middle', () => {
    const g: Gradient = {
      stops: [
        { colour: '#000000', at: 0.2 },
        { colour: '#ffffff', at: 0.6 },
        { colour: '#ff0000', at: 1 },
      ],
    };
    expect(interpolateSrgb(g, 0)).toBe('#000000');
    expect(interpolateSrgb(g, 0.2)).toBe('#000000');
    expect(interpolateSrgb(g, 0.4)).toBe('#808080');
    expect(interpolateSrgb(g, 0.6)).toBe('#ffffff');
    expect(interpolateSrgb(g, 0.8)).toMatch(/^#ff[78][0-9a-f][78][0-9a-f]$/);
    expect(interpolateSrgb(g, 1)).toBe('#ff0000');
    expect(interpolateSrgb(g, 2)).toBe('#ff0000');
  });

  test('a gradient with no stop is refused', () => {
    expect(() => interpolateSrgb({ stops: [] }, 0.5)).toThrow('at least one stop');
  });

  test('worst contrast over a single colour is the plain ratio', () => {
    expect(worstContrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  test('worst contrast over a gradient finds the weakest point', () => {
    const g: Gradient = {
      stops: [
        { colour: '#000000', at: 0 },
        { colour: '#ffffff', at: 1 },
      ],
    };
    expect(worstContrast('#000000', g, 4)).toBe(1);
    expect(worstContrast('#ffffff', g)).toBe(1);
  });
});

describe('design tokens', () => {
  test('use no AWS brand colour', () => {
    const used = [
      ...Object.values(TOKENS),
      ...Object.values(GRADIENTS).flatMap((g) => g.stops.map((s) => s.colour)),
    ].map((c) => c.toLowerCase());
    for (const colour of used) {
      expect(AWS_BRAND_DENYLIST).not.toContain(colour);
    }
  });

  test('every contrast pair reaches its ratio at the worst point', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThan(20);
    for (const pair of CONTRAST_PAIRS) {
      const needed = pair.kind === 'text' ? 4.5 : 3;
      expect(worstContrast(pair.foreground, pair.background), pair.name).toBeGreaterThanOrEqual(
        needed,
      );
    }
  });
});

describe('Property 16: Contrast maths is correct and every token pair passes', () => {
  // Feature: showcase-site, Property 16: Contrast maths is correct and every token pair passes
  test('contrastRatio is symmetric, between 1 and 21, and 1 for identical colours', () => {
    fc.assert(
      fc.property(hexArb, hexArb, (a, b) => {
        const ratio = contrastRatio(a, b);
        expect(ratio).toBeCloseTo(contrastRatio(b, a), 10);
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21.0000001);
        expect(contrastRatio(a, a)).toBe(1);
      }),
      { numRuns: 200 },
    );
  });

  test('worstContrast is no greater than the contrast at any stop or sample', () => {
    fc.assert(
      fc.property(hexArb, gradientArb, fc.integer({ min: 1, max: 64 }), (fg, gradient, samples) => {
        const worst = worstContrast(fg, gradient, samples);
        for (const stop of gradient.stops) {
          expect(worst).toBeLessThanOrEqual(contrastRatio(fg, stop.colour) + 1e-12);
        }
        for (let i = 0; i <= samples; i += 1) {
          const at = contrastRatio(fg, interpolateSrgb(gradient, i / samples));
          expect(worst).toBeLessThanOrEqual(at + 1e-12);
        }
      }),
      { numRuns: 200 },
    );
  });

  test('every entry in CONTRAST_PAIRS reaches 4.5 for text and 3 for non-text', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CONTRAST_PAIRS), (pair) => {
        const needed = pair.kind === 'text' ? 4.5 : 3;
        expect(worstContrast(pair.foreground, pair.background)).toBeGreaterThanOrEqual(needed);
      }),
      { numRuns: 100 },
    );
  });
});
