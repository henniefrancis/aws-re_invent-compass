import type { Clock } from '../../src/seams.js';

export interface FakeClock extends Clock {
  set(ms: number): void;
  advance(ms: number): void;
}

export function createFakeClock(start = Date.parse('2026-12-01T12:00:00Z')): FakeClock {
  let current = start;
  return {
    now: () => current,
    set(ms) {
      current = ms;
    },
    advance(ms) {
      current += ms;
    },
  };
}
