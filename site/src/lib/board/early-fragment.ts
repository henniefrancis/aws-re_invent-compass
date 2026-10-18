// Taking the fragment before the router runs (showcase-site, security L-3).
//
// The hand-off id lives in the URL fragment. The router reads the address when it starts its
// first navigation and may write it back into the history, so the fragment has to be taken and
// removed from the address BEFORE that: an app initializer calls takeBoardFragment, and the
// board page asks the holder for the fragment once, later. The holder hands it over only once,
// so Back and Forward never bring an old link back (a reload shows Invalid_Link, as designed).

import { rawFragment } from './fragment';

const BOARD_PATHS: ReadonlySet<string> = new Set(['/board', '/board/']);

export interface EarlyFragmentDeps {
  readonly pathname: string;
  readonly href: string;
  readonly replaceState: (url: string) => void;
}

/**
 * On the board page: read the raw fragment from the address and replace the address with
 * `/board`. On any other page: do nothing and return an empty string.
 */
export function takeBoardFragment({ pathname, href, replaceState }: EarlyFragmentDeps): string {
  if (!BOARD_PATHS.has(pathname)) {
    return '';
  }
  const fragment = rawFragment(href);
  replaceState('/board');
  return fragment;
}

export interface FragmentHolder {
  set(fragment: string): void;
  /** The fragment, once. Later calls give an empty string. */
  take(): string;
}

export function createFragmentHolder(): FragmentHolder {
  let held = '';
  return {
    set(fragment) {
      held = fragment;
    },
    take() {
      const value = held;
      held = '';
      return value;
    },
  };
}
