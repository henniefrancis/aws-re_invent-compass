import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SITE_ROOT } from '../support/source-files';

// Showcase-site task 20: the owner's artwork as a decorative banner on the Board_Page.
const template = readFileSync(
  join(SITE_ROOT, 'src', 'app', 'pages', 'board', 'board-page.component.html'),
  'utf8',
);
const css = readFileSync(join(SITE_ROOT, 'src', 'styles', 'components.css'), 'utf8');

describe('board artwork', () => {
  test('the banner is a decorative, same-origin image with its size set', () => {
    const img = /<img\s+class="board-art"[\s\S]*?\/>/.exec(template)?.[0] ?? '';
    expect(img).toContain('src="artwork/pass-background.jpg"');
    expect(img).toContain('alt=""');
    expect(img).toContain('width="734"');
    expect(img).toContain('height="1148"');
    expect(img).not.toMatch(/https?:\/\//);
    // The banner sits before the panel, so the panel text never overlays the picture.
    expect(template.indexOf('board-art')).toBeLessThan(template.indexOf('board-panel'));
  });

  test('the picture is small and cropped to a banner', () => {
    const bytes = statSync(join(SITE_ROOT, 'public', 'artwork', 'pass-background.jpg')).size;
    expect(bytes).toBeLessThan(60_000);
    expect(css).toMatch(/\.board-art\s*\{[^}]*object-fit:\s*cover/);
  });
});
