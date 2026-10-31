import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SITE_ROOT } from '../support/source-files';

// Showcase-site task 21: the owner's logo in the header and the owner's favicon.
const header = readFileSync(
  join(SITE_ROOT, 'src', 'app', 'shell', 'site-header.component.html'),
  'utf8',
);
const artwork = (name: string) => readFileSync(join(SITE_ROOT, 'public', 'artwork', name), 'utf8');

describe('owner logo', () => {
  test('the home link is the logo, named by the product name', () => {
    const link = /<a class="brand-link"[\s\S]*?<\/a>/.exec(header)?.[0] ?? '';
    expect(link).toContain('src="artwork/logo.svg"');
    expect(link).toContain('[alt]="productName"');
    expect(link).toMatch(/width="\d+"/);
    expect(link).toMatch(/height="\d+"/);
  });

  test('the logo and favicon have no script, no external reference and no AWS typeface', () => {
    for (const name of ['logo.svg', 'favicon.svg']) {
      const svg = artwork(name);
      expect(svg, name).not.toMatch(/<script|on[a-z]+\s*=/i);
      expect(svg, name).not.toMatch(/(?:xlink:)?href="(?!#)/);
      expect(svg, name).not.toMatch(/amazon|ember/i);
    }
  });
});
