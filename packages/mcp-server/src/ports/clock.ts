// The injected clock. Handlers and the planner never read the system time directly,
// so tests can fix "now" and the 15-minute snapshot age and hand-off expiry stay
// deterministic.

/** A source of the current time. */
export interface Clock {
  now(): Date;
}

/** The real clock, used by the live and simulated runtimes. */
export const systemClock: Clock = {
  now: () => new Date(),
};
