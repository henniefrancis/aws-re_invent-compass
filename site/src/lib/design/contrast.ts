// WCAG 2.x contrast maths for the design tokens (showcase-site, Component 16).
//
// Colours are six digit hex strings. Gradients are lists of stops that are interpolated
// linearly on the gamma encoded sRGB channels, which is what a browser paints for
// `linear-gradient(in srgb, ...)`. Text over a gradient is judged at its worst point.

export type Hex = `#${string}`;

export interface GradientStop {
  readonly colour: Hex;
  /** Position from 0 to 1, ascending through the list. */
  readonly at: number;
}

export interface Gradient {
  readonly stops: readonly GradientStop[];
}

export interface ContrastPair {
  readonly name: string;
  readonly foreground: Hex;
  readonly background: Hex | Gradient;
  readonly kind: 'text' | 'nonText';
}

/** Samples taken along a gradient, in addition to every stop. */
export const DEFAULT_GRADIENT_SAMPLES = 256;

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  if (!HEX_PATTERN.test(hex)) {
    throw new Error('A colour must be a hex string such as #1a2b3c.');
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(channels: Rgb): Hex {
  const part = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${part(channels[0])}${part(channels[1])}${part(channels[2])}`;
}

function linearise(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a colour, from 0 (black) to 1 (white), as WCAG 2.x defines it. */
export function relativeLuminance(hex: Hex): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** Contrast ratio of two colours, from 1 to 21. The order of the arguments does not matter. */
export function contrastRatio(a: Hex, b: Hex): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The colour of a gradient at position t (0 to 1), by linear interpolation on sRGB channels. */
export function interpolateSrgb(gradient: Gradient, t: number): Hex {
  const stops = gradient.stops;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('A gradient needs at least one stop.');
  }
  if (t <= first.at) {
    return first.colour;
  }
  if (t >= last.at) {
    return last.colour;
  }
  const upperIndex = stops.findIndex((stop) => stop.at >= t);
  const upper = stops[upperIndex] as GradientStop;
  const lower = stops[upperIndex - 1] as GradientStop;
  const share = (t - lower.at) / (upper.at - lower.at);
  const from = parseHex(lower.colour);
  const to = parseHex(upper.colour);
  const mixed = from.map((channel, index) =>
    Math.round(channel + ((to[index] as number) - channel) * share),
  );
  return toHex(mixed as unknown as Rgb);
}

/**
 * The lowest contrast of a foreground colour over a background, which is a single colour or
 * a gradient. For a gradient it looks at every stop and at `samples` evenly spaced points.
 */
export function worstContrast(
  foreground: Hex,
  background: Hex | Gradient,
  samples: number = DEFAULT_GRADIENT_SAMPLES,
): number {
  if (typeof background === 'string') {
    return contrastRatio(foreground, background);
  }
  const points: Hex[] = background.stops.map((stop) => stop.colour);
  for (let index = 0; index <= samples; index += 1) {
    points.push(interpolateSrgb(background, index / samples));
  }
  return Math.min(...points.map((point) => contrastRatio(foreground, point)));
}
