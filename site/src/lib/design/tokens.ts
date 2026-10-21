// Design tokens for the showcase site (showcase-site, Component 16).
//
// The palette follows the Compass pass and QR page (task 25): a dark card over the owner's
// Pass Designer gradient, white text and the pass's orange. It uses no AWS brand colour (the
// denylist lives in the site tests). styles/tokens.css declares these exact values as CSS
// custom properties, and a test keeps the two in step.
//
// Every foreground and background pairing the stylesheets use is listed in CONTRAST_PAIRS,
// so one property test proves that the whole palette meets WCAG 2.2 AA.

import type { ContrastPair, Gradient, Hex } from './contrast';

export const TOKENS: Readonly<Record<string, Hex>> = {
  paper: '#0c0d26',
  surface: '#15173a',
  tint: '#22265c',
  ink: '#ffffff',
  inkMuted: '#c8cae8',
  brand: '#f09740',
  brandStrong: '#ffb36b',
  onBrand: '#0c0d26',
  onHero: '#ffffff',
  accent: '#c79bff',
  border: '#8f93c9',
  focus: '#ffd84d',
  ok: '#6fdc9a',
  warn: '#ffcc55',
  block: '#ff8a94',
};

export const GRADIENTS: Readonly<Record<string, Gradient>> = {
  hero: {
    stops: [
      { colour: '#05052e', at: 0 },
      { colour: '#2236f0', at: 1 },
    ],
  },
  /** The page backdrop: the pass gradient. Decorative only; no text sits on it directly. */
  page: {
    stops: [
      { colour: '#05052e', at: 0 },
      { colour: '#2236f0', at: 0.4 },
      { colour: '#e61ee8', at: 0.8 },
      { colour: '#ff6a20', at: 1 },
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
    name: 'onHero text on the hero gradient',
    foreground: token('onHero'),
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
