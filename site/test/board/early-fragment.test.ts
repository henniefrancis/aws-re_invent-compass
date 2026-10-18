import { describe, expect, test } from 'vitest';
import { createFragmentHolder, takeBoardFragment } from '../../src/lib/board/early-fragment';
import { FIXED_ID } from '../support/handoff-data';

function run(pathname: string, href: string) {
  const replaced: string[] = [];
  const fragment = takeBoardFragment({
    pathname,
    href,
    replaceState: (url) => {
      replaced.push(url);
    },
  });
  return { fragment, replaced };
}

describe('takeBoardFragment (security L-3)', () => {
  test('on /board it returns the raw fragment and strips the address before anything else runs', () => {
    const result = run('/board', `https://x.invalid/board#h=${FIXED_ID}`);
    expect(result).toEqual({ fragment: `#h=${FIXED_ID}`, replaced: ['/board'] });
    expect(run('/board/', `https://x.invalid/board/#h=${FIXED_ID}`).replaced).toEqual(['/board']);
  });

  test('on /board without a fragment it still returns an empty string and replaces the address', () => {
    expect(run('/board', 'https://x.invalid/board')).toEqual({
      fragment: '',
      replaced: ['/board'],
    });
  });

  test('on any other page it touches nothing', () => {
    for (const path of ['/', '/demo', '/install', '/privacy', '/boardx', '/a/board']) {
      expect(run(path, `https://x.invalid${path}#main`)).toEqual({ fragment: '', replaced: [] });
    }
  });
});

describe('createFragmentHolder', () => {
  test('hands the fragment over once, so Back never brings an old link back', () => {
    const holder = createFragmentHolder();
    expect(holder.take()).toBe('');
    holder.set(`#h=${FIXED_ID}`);
    expect(holder.take()).toBe(`#h=${FIXED_ID}`);
    expect(holder.take()).toBe('');
  });
});
