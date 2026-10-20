import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { ARTWORK_FILES, artworkModuleSource } from '../../src/artwork/render.js';
import { ARTWORK } from '../../src/apple/artwork.js';

const SIZES: Record<string, [number, number]> = {
  'icon.png': [38, 38],
  'icon@2x.png': [76, 76],
  'icon@3x.png': [114, 114],
  'logo.png': [160, 50],
  'logo@2x.png': [320, 100],
  'logo@3x.png': [480, 150],
};

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

describe("Feature: pass-service, the owner's artwork (task 38)", () => {
  test('the six images are RGBA PNGs of the documented sizes', () => {
    expect(Object.keys(ARTWORK).sort()).toEqual([...ARTWORK_FILES].sort());
    for (const name of ARTWORK_FILES) {
      const decoded = image(name);
      expect([decoded.width, decoded.height], name).toEqual(SIZES[name]);
    }
  });

  test('every image is transparent at its corners and carries visible ink', () => {
    for (const name of ARTWORK_FILES) {
      const img = image(name);
      expect(alphaAt(img, 0, 0), name).toBe(0);
      expect(alphaAt(img, img.width - 1, img.height - 1), name).toBe(0);
      const opaque = img.rgba.filter((value, index) => index % 4 === 3 && value === 255).length;
      expect(opaque, name).toBeGreaterThan((img.width * img.height) / 10);
    }
  });

  test('the logo is left-aligned and leaves the right of its slot empty', () => {
    const logo = image('logo@3x.png');
    const column = (x: number) =>
      Array.from({ length: logo.height }, (_, y) => alphaAt(logo, x, y)).some((a) => a > 0);
    expect(column(5)).toBe(true);
    expect(column(logo.width - 5)).toBe(false);
  });

  test('the module writer lists every image and names the source artwork', () => {
    const files = Object.fromEntries(
      ARTWORK_FILES.map((name) => [name, new Uint8Array([1, 2, 3])]),
    ) as Record<(typeof ARTWORK_FILES)[number], Uint8Array>;
    const source = artworkModuleSource(files);
    expect(source).toContain('export const ARTWORK');
    expect(source).toContain('logo.svg');
    expect(source).toContain('favicon.svg');
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
