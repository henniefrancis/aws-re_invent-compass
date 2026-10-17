// The gate for the owner-only live smoke tests (events-client, S1, security N3).
// A pure function so the gate itself is tested in every normal run.

/** The environment values the gate reads. */
export type GateEnv = Readonly<Record<string, string | undefined>>;

/** True when the environment looks like a CI run. */
function isCi(env: GateEnv): boolean {
  const ci = env.CI;
  return ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
}

/**
 * Live tests run only when the owner opts in twice (COMPASS_LIVE_TESTS=1 and
 * COMPASS_LIVE_CONFIRM=yes) and the run is not a CI run. Any other combination is
 * closed.
 */
export function isLiveEnabled(env: GateEnv): boolean {
  return env.COMPASS_LIVE_TESTS === '1' && env.COMPASS_LIVE_CONFIRM === 'yes' && !isCi(env);
}

/** The keychain service the live tests use, separate from the real one. */
export const LIVE_TEST_KEYCHAIN_SERVICE = 'reinvent-compass-livetest';
