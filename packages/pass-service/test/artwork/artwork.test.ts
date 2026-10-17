import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { PALETTE, contrastRatio, drawIcon, drawLogo } from '../../src/artwork/draw.js';
import { encodePng } from '../../src/artwork/png.js';
import { ARTWORK_FILES, artworkModuleSource, renderArtwork } from '../../src/artwork/render.js';
import { ARTWORK } from '../../src/apple/artwork.js';

const SIZES: Record<string, [number, number]> = {
  'icon.png': [29, 29],
  'icon@2x.png': [58, 58],
  'icon@3x.png': [87, 87],
  'logo@2x.png': [320, 100],
  'logo@3x.png': [480, 150],
};

function decode(png: Uint8Array): { width: number; height: number; rgba: Buffer } {
  const buffer = Buffer.from(png);
  expect(
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ).toBe(true);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const idatLength = buffer.readUInt32BE(33);
  const raw = inflateSync(buffer.subarray(41, 41 + idatLength));
  const stride = width * 4;
  const rgba = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (stride + 1)]).toBe(0);
    raw.copy(rgba, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, rgba };
}

describe('Feature: pass-service, original artwork', () => {
  test('the five images have the documented sizes and decode to RGBA', () => {
    const files = renderArtwork();
    for (const name of ARTWORK_FILES) {
      const decoded = decode(files[name]);
      expect([decoded.width, decoded.height]).toEqual(SIZES[name]);
    }
  });

  test('the committed module holds exactly what the artwork code renders', () => {
    const files = renderArtwork();
    expect(Object.keys(ARTWORK).sort()).toEqual([...ARTWORK_FILES].sort());
    for (const name of ARTWORK_FILES) {
      expect(ARTWORK[name]).toBe(Buffer.from(files[name]).toString('base64'));
    }
    const source = artworkModuleSource(files);
    expect(source).toContain('export const ARTWORK');
    expect(source.endsWith('\n')).toBe(true);
    for (const name of ARTWORK_FILES) {
      expect(source).toContain(`'${name}'`);
    }
  });

  test('rendering is deterministic', () => {
    expect(
      Buffer.from(renderArtwork()['icon@3x.png']).equals(
        Buffer.from(renderArtwork()['icon@3x.png']),
      ),
    ).toBe(true);
  });

  test('the icon is opaque at its corner and the logo is transparent outside its drawing', () => {
    const icon = decode(renderArtwork()['icon@3x.png']);
    expect([...icon.rgba.subarray(0, 4)]).toEqual([...PALETTE.background, 255]);
    const logo = decode(renderArtwork()['logo@3x.png']);
    expect(logo.rgba[3]).toBe(0);
    expect(logo.rgba.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });

  test('the drawing has partly transparent edge pixels (anti-aliasing) and both ink colours', () => {
    const { rgba } = drawLogo(320, 100);
    const alphas = new Set<number>();
    for (let i = 3; i < rgba.length; i += 4) {
      alphas.add(rgba[i] ?? 0);
    }
    expect(alphas.size).toBeGreaterThan(2);
    const icon = drawIcon(87).rgba;
    const hasAmber = icon.some(
      (_, i) => i % 4 === 0 && icon[i] === PALETTE.accent[0] && icon[i + 1] === PALETTE.accent[1],
    );
    expect(hasAmber).toBe(true);
  });

  test('text colours reach 4.5 to 1 contrast on the background', () => {
    expect(contrastRatio(PALETTE.ink, PALETTE.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.label, PALETTE.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.accent, PALETTE.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(PALETTE.background, PALETTE.ink)).toBe(
      contrastRatio(PALETTE.ink, PALETTE.background),
    );
  });

  test('contrast of black on white is the maximum and handles dark channels', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });

  test('no AWS orange or wording is used', () => {
    const awsOrange: [number, number, number] = [255, 153, 0];
    for (const color of Object.values(PALETTE)) {
      expect(color).not.toEqual(awsOrange);
    }
    const comments = artworkModuleSource(renderArtwork())
      .split('\n')
      .filter((line) => line.startsWith('//'));
    expect(comments.join(' ')).not.toMatch(/aws/i);
  });

  test('the PNG encoder refuses pixel data of the wrong size', () => {
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow(RangeError);
    expect(encodePng(1, 1, new Uint8Array(4))).toBeInstanceOf(Uint8Array);
  });
});
