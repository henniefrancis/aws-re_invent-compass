import { describe, expect, test } from 'vitest';
import { GRADIENTS, TOKENS } from '../../src/lib/design/tokens';
import { listFiles } from '../support/source-files';

const styles = listFiles('src/styles', ['.css']);
const byName = (name: string): string => {
  const file = styles.find((f) => f.path === `src/styles/${name}`);
  if (file === undefined) {
    throw new Error(`Missing stylesheet ${name}`);
  }
  return file.text;
};

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('tokens.css', () => {
  const css = byName('tokens.css');
  const declared = new Map<string, string>(
    [...css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );

  test('declares exactly the colour tokens, with the same values', () => {
    const colours = [...declared.entries()].filter(([name]) => name.startsWith('color-'));
    expect(colours.map(([name, value]) => [name, value])).toEqual(
      Object.entries(TOKENS).map(([name, value]) => [`color-${kebab(name)}`, value]),
    );
  });

  test('declares each gradient with srgb interpolation and the same stops', () => {
    for (const [name, gradient] of Object.entries(GRADIENTS)) {
      const expected = `linear-gradient(in srgb, ${gradient.stops
        .map((s) => `${s.colour} ${String(s.at * 100)}%`)
        .join(', ')})`;
      expect(declared.get(`gradient-${kebab(name)}`)).toBe(expected);
    }
  });
});

describe('stylesheets', () => {
  test('index.css imports every other stylesheet', () => {
    const index = byName('index.css');
    for (const file of styles) {
      const name = file.path.replace('src/styles/', '');
      if (name !== 'index.css') {
        expect(index).toContain(`'./${name}'`);
      }
    }
  });

  test('no stylesheet uses fixed or sticky positioning', () => {
    for (const file of styles) {
      expect(file.text, file.path).not.toMatch(/position\s*:\s*(fixed|sticky)/);
    }
  });

  test('forced colors and reduced motion blocks exist', () => {
    expect(byName('forced-colors.css')).toContain('@media (forced-colors: active)');
    expect(byName('motion.css')).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('every control keeps a 44 pixel target', () => {
    const base = byName('base.css');
    expect(base).toMatch(/min-block-size:\s*var\(--target\)/);
    expect(base).toMatch(/min-inline-size:\s*var\(--target\)/);
    expect(byName('tokens.css')).toContain('--target: 44px');
  });

  test('stylesheets load no web font and no other origin', () => {
    for (const file of styles) {
      expect(file.text, file.path).not.toMatch(/@font-face|url\(|https?:\/\//);
    }
  });
});
