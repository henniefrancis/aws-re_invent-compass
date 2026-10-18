import { posix, win32 } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isInside } from '../../src/safety/paths.js';

describe('isInside', () => {
  test('the folder itself and anything below it are inside, on either path style', () => {
    expect(isInside('/work', '/work', posix)).toBe(true);
    expect(isInside('/work/a/b', '/work', posix)).toBe(true);
    expect(isInside(String.raw`C:\work\a`, String.raw`C:\work`, win32)).toBe(true);
    expect(isInside('/work', '/work')).toBe(true);
  });

  test('a sibling, a parent, a lookalike name and another drive are outside', () => {
    expect(isInside('/other', '/work', posix)).toBe(false);
    expect(isInside('/', '/work', posix)).toBe(false);
    expect(isInside('/work-other', '/work', posix)).toBe(false);
    expect(isInside(String.raw`D:\work`, String.raw`C:\work`, win32)).toBe(false);
    expect(isInside(String.raw`C:\work2`, String.raw`C:\work`, win32)).toBe(false);
  });
});
