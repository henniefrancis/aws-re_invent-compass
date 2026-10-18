import type { Clock } from '../../src/ports/clock.js';

/** A clock fixed at one instant, movable with `set`. */
export interface FixedClock extends Clock {
  set(iso: string): void;
}

/** Creates a clock fixed at `iso`. */
export function fixedClock(iso = '2026-11-30T16:00:00.000Z'): FixedClock {
  let current = new Date(iso);
  return {
    now: () => new Date(current.getTime()),
    set: (next: string) => {
      current = new Date(next);
    },
  };
}
