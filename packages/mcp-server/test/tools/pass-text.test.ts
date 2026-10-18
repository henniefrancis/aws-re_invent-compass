import { describe, expect, test } from 'vitest';
import { HANDOFF_SHARING_NOTE, withoutFragment } from '../../src/tools/pass-text.js';

describe('withoutFragment', () => {
  test('drops everything from the first hash, and leaves a link without one alone', () => {
    expect(withoutFragment('https://compass.invalid/board#h=abc#def')).toBe(
      'https://compass.invalid/board',
    );
    expect(withoutFragment('https://compass.invalid/board')).toBe('https://compass.invalid/board');
    expect(HANDOFF_SHARING_NOTE).toContain('Do not share');
  });
});
