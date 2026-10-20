import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import {
  ARTWORK_BUDGET_BYTES,
  ARTWORK_FILES,
  artworkModuleSource,
} from '../../src/artwork/render.js';
import { ARTWORK } from '../../src/apple/artwork.js';

const SIZES: Record<string, [number, number]> = {
  'icon.png': [38, 38],
  'icon@2x.png': [76, 76],
  'icon@3x.png': [114, 114],
  'logo.png': [160, 50],
  'logo@2x.png': [320, 100],
  'logo@3x.png': [480, 150],
  'primaryLogo@2x.png': [252, 60],
  'primaryLogo@3x.png': [378, 90],
  'artwork@2x.png': [716, 896],
};

/** The images drawn on a transparent canvas: every one but the poster's full-bleed artwork. */
const TRANSPARENT = ARTWORK_FILES.filter((name) => name !== 'artwork@2x.png');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Undo one PNG filter row (types 0 to 4) in place, given the previous unfiltered row. */
function unfilter(type: number, row: Buffer, previous: Buffer, bpp: number): void {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bpp ? (row[i - bpp] ?? 0) : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
    let add = 0;
    if (type === 1) add = left;
    if (type === 2) add = up;
    if (type === 3) add = (left + up) >> 1;
    if (type === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    }
    row[i] = ((row[i] ?? 0) + add) & 0xff;
  }
}

/** Decode an 8-bit RGBA PNG (colour type 6), joining every IDAT chunk. */
function decode(png: Buffer): { width: number; height: number; rgba: Buffer } {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(6);
  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('latin1');
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const row = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    unfilter(raw[start] ?? 0, row, previous, 4);
    row.copy(rgba, y * stride);
    previous = row;
  }
  return { width, height, rgba };
}

const image = (name: string) => decode(Buffer.from(ARTWORK[name] ?? '', 'base64'));
const alphaAt = (img: { width: number; rgba: Buffer }, x: number, y: number) =>
  img.rgba[(y * img.width + x) * 4 + 3] ?? 0;

describe("Feature: pass-service, the owner's artwork (tasks 38 and 42)", () => {
  test('the nine images are RGBA PNGs of the documented sizes', () => {
    expect(Object.keys(ARTWORK).sort()).toEqual([...ARTWORK_FILES].sort());
    for (const name of ARTWORK_FILES) {
      const decoded = image(name);
      expect([decoded.width, decoded.height], name).toEqual(SIZES[name]);
    }
  });

  test('every logo and icon is transparent at its corners and carries visible ink', () => {
    for (const name of TRANSPARENT) {
      const img = image(name);
      expect(alphaAt(img, 0, 0), name).toBe(0);
      expect(alphaAt(img, img.width - 1, img.height - 1), name).toBe(0);
      const opaque = img.rgba.filter((value, index) => index % 4 === 3 && value === 255).length;
      expect(opaque, name).toBeGreaterThan((img.width * img.height) / 10);
    }
  });

  test('the logo and the primary logo are left-aligned and leave the right of their slot empty', () => {
    for (const name of ['logo@3x.png', 'primaryLogo@3x.png']) {
      const logo = image(name);
      const column = (x: number) =>
        Array.from({ length: logo.height }, (_, y) => alphaAt(logo, x, y)).some((a) => a > 0);
      expect(column(5), name).toBe(true);
      expect(column(logo.width - 5), name).toBe(false);
    }
  });

  test("the poster artwork is the owner's picture, opaque edge to edge (task 42)", () => {
    const art = image('artwork@2x.png');
    for (const [x, y] of [
      [0, 0],
      [art.width - 1, 0],
      [0, art.height - 1],
      [art.width - 1, art.height - 1],
    ] as const) {
      expect(alphaAt(art, x, y)).toBe(255);
    }
    // The top of the picture is a dark violet sky and the bottom a bright pink and orange.
    const pixel = (x: number, y: number) => {
      const at = (y * art.width + x) * 4;
      return [art.rgba[at] ?? 0, art.rgba[at + 1] ?? 0, art.rgba[at + 2] ?? 0];
    };
    const brightness = ([r, g, b]: number[]) => (r ?? 0) + (g ?? 0) + (b ?? 0);
    expect(brightness(pixel(10, 10))).toBeLessThan(120);
    expect(brightness(pixel(10, art.height - 10))).toBeGreaterThan(250);
  });

  test('the artwork set stays under its budget, so a 10-pass bundle fits a Lambda response (task 42)', () => {
    const total = Object.values(ARTWORK).reduce(
      (sum, base64) => sum + Buffer.from(base64, 'base64').length,
      0,
    );
    expect(total).toBeLessThan(ARTWORK_BUDGET_BYTES);
    // Ten passes of artwork, base64-encoded, under Lambda's 6 MB synchronous response limit.
    expect(Math.ceil((10 * ARTWORK_BUDGET_BYTES * 4) / 3)).toBeLessThan(6 * 1024 * 1024);
  });

  test('the module writer lists every image and names the source artwork', () => {
    const files = Object.fromEntries(
      ARTWORK_FILES.map((name) => [name, new Uint8Array([1, 2, 3])]),
    ) as Record<(typeof ARTWORK_FILES)[number], Uint8Array>;
    const source = artworkModuleSource(files);
    expect(source).toContain('export const ARTWORK');
    expect(source).toContain('logo.svg');
    expect(source).toContain('favicon.svg');
    expect(source).toContain('pass-background.jpg');
    expect(source.endsWith('\n')).toBe(true);
    for (const name of ARTWORK_FILES) {
      expect(source).toContain(`'${name}':
    'AQID',`);
    }
    expect(
      source
        .split('\n')
        .filter((line) => line.startsWith('//'))
        .join(' '),
    ).not.toMatch(/aws|amazon/i);
  });
});
