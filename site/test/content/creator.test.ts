// Feature: showcase-site, tasks 34 and 35 (Requirements 24 and 25): The Creator and The Inspiration pages
// quote the owner's recorded answers, and the photo and links match what the owner chose.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ABOUT_PHOTO } from '../../src/lib/content/about';
import { INSPIRATION_SECTIONS } from '../../src/lib/content/inspiration';
import { CREATOR_LINKS } from '../../src/lib/content/links';
import { SITE_ROOT } from '../support/source-files';

const STORY = readFileSync(join(SITE_ROOT, '..', 'docs/story/creator-and-inspiration.md'), 'utf8');
const ARTWORK = readFileSync(join(SITE_ROOT, 'ARTWORK.md'), 'utf8');

describe('The Creator and The Inspiration (task 34)', () => {
  test('the creator links are the five pages the owner chose, all https, each with its image', () => {
    expect(CREATOR_LINKS.map((l) => l.label)).toEqual([
      'Personal website',
      'LinkedIn',
      'GitHub',
      'AWS Community South Africa',
      'AWS Builder Center',
    ]);
    for (const link of CREATOR_LINKS) {
      expect(link.href, link.label).toMatch(/^https:\/\//);
      expect(STORY, link.label).toContain(link.href);
      const image = readFileSync(join(SITE_ROOT, 'public', link.image));
      expect(image.subarray(8, 12).toString('ascii'), link.label).toBe('WEBP');
      expect(ARTWORK, link.label).toContain('`public' + link.image + '`');
    }
  });

  test('the photo is a WebP file in public, listed in ARTWORK.md, with a text alternative', () => {
    const file = readFileSync(join(SITE_ROOT, 'public', ABOUT_PHOTO.src));
    expect(file.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(file.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(readFileSync(join(SITE_ROOT, 'ARTWORK.md'), 'utf8')).toContain(
      `\`public${ABOUT_PHOTO.src}\``,
    );
    expect(ABOUT_PHOTO.alt).toContain('Hennie Francis');
  });

  test('every story heading is a heading in the source', () => {
    for (const section of INSPIRATION_SECTIONS) {
      expect(STORY, section.id).toContain(`### ${section.heading}\n`);
    }
  });
});
