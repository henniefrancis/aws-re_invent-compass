import { InjectionToken } from '@angular/core';
import { createFragmentHolder, type FragmentHolder } from '../lib/board/early-fragment';

/** Holds the hand-off fragment, taken before the router starts, until the board page asks. */
export const FRAGMENT_HOLDER = new InjectionToken<FragmentHolder>('FRAGMENT_HOLDER', {
  providedIn: 'root',
  factory: createFragmentHolder,
});
