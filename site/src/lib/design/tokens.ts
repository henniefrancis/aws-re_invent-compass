// Design tokens for the showcase site (showcase-site, Component 16).
//
// The palette is original: deep teal, warm paper and plum. It uses no AWS brand colour (the
// denylist lives in the site tests). styles/tokens.css declares these exact values as CSS
// custom properties, and a test keeps the two in step.
//
// Every foreground and background pairing the stylesheets use is listed in CONTRAST_PAIRS,
// so one property test proves that the whole palette meets WCAG 2.2 AA.

import type { ContrastPair, Gradient, Hex } from './contrast';

export const TOKENS: Readonly<Record<string, Hex>> = {
  paper: '#f7f4ec',
  surface: '#ffffff',
  tint: '#e6efec',
  ink: '#1c2526',
  inkMuted: '#445152',
  brand: '#0f5257',
  brandStrong: '#0a3b3f',
  onBrand: '#ffffff',
  accent: '#6b2d5c',
  border: '#5f6e6f',
  focus: '#8a1c7c',
  ok: '#1b6b3a',
  warn: '#7a4f00',
  block: '#a31d2a',
};

export const GRADIENTS: Readonly<Record<string, Gradient>> = {
  hero: {
    stops: [
      { colour: '#0f5257', at: 0 },
      { colour: '#0a3b3f', at: 1 },
    ],
  },
};

const hero = GRADIENTS['hero'] as Gradient;

/** Text colours drawn over each page surface. */
const TEXT_ON_SURFACES: readonly (readonly [string, string])[] = [
  ['ink', 'paper'],
  ['ink', 'surface'],
  ['ink', 'tint'],
  ['inkMuted', 'paper'],
  ['inkMuted', 'surface'],
  ['inkMuted', 'tint'],
  ['brand', 'paper'],
  ['brand', 'surface'],
  ['brand', 'tint'],
  ['accent', 'paper'],
  ['accent', 'surface'],
  ['accent', 'tint'],
  ['ok', 'paper'],
  ['ok', 'surface'],
  ['ok', 'tint'],
  ['warn', 'paper'],
  ['warn', 'surface'],
  ['warn', 'tint'],
  ['block', 'paper'],
  ['block', 'surface'],
  ['block', 'tint'],
];

/** Focus rings, borders and graphics drawn against each page surface. */
const NON_TEXT_ON_SURFACES: readonly (readonly [string, string])[] = [
  ['border', 'paper'],
  ['border', 'surface'],
  ['border', 'tint'],
  ['focus', 'paper'],
  ['focus', 'surface'],
  ['focus', 'tint'],
  ['brand', 'paper'],
  ['brand', 'surface'],
  ['brand', 'tint'],
  ['ok', 'surface'],
  ['warn', 'surface'],
  ['block', 'surface'],
];

function token(name: string): Hex {
  return TOKENS[name] as Hex;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...TEXT_ON_SURFACES.map(([fg, bg]): ContrastPair => ({
    name: `${fg} text on ${bg}`,
    foreground: token(fg),
    background: token(bg),
    kind: 'text',
  })),
  {
    name: 'onBrand text on brand',
    foreground: token('onBrand'),
    background: token('brand'),
    kind: 'text',
  },
  {
    name: 'onBrand text on brandStrong',
    foreground: token('onBrand'),
    background: token('brandStrong'),
    kind: 'text',
  },
  {
    name: 'onBrand text on the hero gradient',
    foreground: token('onBrand'),
    background: hero,
    kind: 'text',
  },
  ...NON_TEXT_ON_SURFACES.map(([fg, bg]): ContrastPair => ({
    name: `${fg} line or graphic on ${bg}`,
    foreground: token(fg),
    background: token(bg),
    kind: 'nonText',
  })),
  {
    name: 'onBrand line on brand fill',
    foreground: token('onBrand'),
    background: token('brand'),
    kind: 'nonText',
  },
];
