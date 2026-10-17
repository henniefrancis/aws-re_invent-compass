// Original pass artwork: a compass-rose glyph and a "Compass" wordmark in an original
// palette (deep teal, white, amber). No AWS logo, colour or wording is used.
// Everything is drawn from first principles with supersampling, so the images are
// reproducible byte for byte.

export type Rgb = readonly [number, number, number];

export const PALETTE = {
  background: [14, 62, 74] as Rgb,
  ink: [255, 255, 255] as Rgb,
  accent: [242, 169, 59] as Rgb,
  label: [190, 226, 232] as Rgb,
} as const;

export interface Raster {
  width: number;
  height: number;
  /** Straight-alpha RGBA, width * height * 4 bytes. */
  rgba: Uint8Array;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
}

/** WCAG contrast ratio between two colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

type Sample = readonly [number, number, number, number] | undefined;

const SAMPLES = 3;

function render(width: number, height: number, sampleAt: (x: number, y: number) => Sample): Raster {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const color = sampleAt(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
          if (color !== undefined) {
            const alpha = color[3];
            r += color[0] * alpha;
            g += color[1] * alpha;
            b += color[2] * alpha;
            a += alpha;
          }
        }
      }
      const offset = (y * width + x) * 4;
      if (a > 0) {
        rgba[offset] = Math.round(r / a);
        rgba[offset + 1] = Math.round(g / a);
        rgba[offset + 2] = Math.round(b / a);
        rgba[offset + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
      }
    }
  }
  return { width, height, rgba };
}

function opaque(color: Rgb): Sample {
  return [color[0], color[1], color[2], 1];
}

/** The compass rose at (cx, cy) with radius `radius`: a ring, a four-point star, a hub. */
function roseAt(px: number, py: number, cx: number, cy: number, radius: number): Sample {
  const dx = px - cx;
  const dy = py - cy;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius * 0.09) {
    return undefined; // the hub is a hole
  }
  const reach = radius * 0.72;
  const inStar = (Math.abs(dx) / reach) ** 0.6 + (Math.abs(dy) / reach) ** 0.6 <= 1;
  if (inStar) {
    return opaque(dy < 0 ? PALETTE.accent : PALETTE.ink);
  }
  if (distance >= radius * 0.8 && distance <= radius * 0.92) {
    return opaque(PALETTE.ink);
  }
  return undefined;
}

/** The square pass icon: the rose on the deep teal background. */
export function drawIcon(size: number): Raster {
  return render(
    size,
    size,
    (x, y) => roseAt(x, y, size / 2, size / 2, size * 0.46) ?? opaque(PALETTE.background),
  );
}

// A 5 by 9 bitmap font for the letters of "Compass" (rows 0 to 6 are the cap height,
// rows 2 to 6 the lowercase height, rows 7 and 8 the descender).
const GLYPHS: Record<string, readonly string[]> = {
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.', '.....', '.....'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.', '.....', '.....'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '.....', '.....'],
  p: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '####.', '#....', '#....'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####', '.....', '.....'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.', '.....', '.....'],
};

const WORD = 'Compass';
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 9;
const WORD_COLUMNS = WORD.length * GLYPH_WIDTH + (WORD.length - 1);

function wordmarkAt(px: number, py: number, left: number, top: number, scale: number): Sample {
  const column = Math.floor((px - left) / scale);
  const row = Math.floor((py - top) / scale);
  if (column < 0 || column >= WORD_COLUMNS || row < 0 || row >= GLYPH_HEIGHT) {
    return undefined;
  }
  const letterIndex = Math.floor(column / (GLYPH_WIDTH + 1));
  const inLetter = column - letterIndex * (GLYPH_WIDTH + 1);
  if (inLetter >= GLYPH_WIDTH) {
    return undefined;
  }
  // The letter, row and column are in range by the checks above.
  const bitmap = GLYPHS[WORD.charAt(letterIndex)]!;
  return bitmap[row]!.charAt(inLetter) === '#' ? opaque(PALETTE.ink) : undefined;
}

/** The pass logo: the rose and the "Compass" wordmark on a transparent background. */
export function drawLogo(width: number, height: number): Raster {
  const roseRadius = height * 0.46;
  const roseCx = roseRadius + height * 0.04;
  const roseCy = height / 2;
  const textLeft = roseCx + roseRadius + height * 0.12;
  const scale = Math.max(1, Math.floor((width - textLeft - height * 0.04) / WORD_COLUMNS));
  const textTop = (height - GLYPH_HEIGHT * scale) / 2;
  return render(
    width,
    height,
    (x, y) =>
      roseAt(x, y, roseCx, roseCy, roseRadius) ?? wordmarkAt(x, y, textLeft, textTop, scale),
  );
}
