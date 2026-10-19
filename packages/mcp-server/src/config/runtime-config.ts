// Reads the runtime settings from the environment (task 1.2, integrator ruling from the S4
// security review).
//
// The Compass API host the ID token goes to comes from the build-time constant in
// `compass-api.ts`. `COMPASS_API_URL` can replace it only when `COMPASS_ALLOW_API_OVERRIDE=1`
// is also set, and then a one-line warning naming the override host is returned for the CLI and
// the server to print. The override must be https. `allowedHosts` is the host of the URL the
// client will really use (the constant or the explicit, double opted-in override), so the pass
// client's host check can never be widened by a stray variable on its own.

import { CompassError } from '../ports/errors.js';
import { COMPASS_API_BASE_URL } from './compass-api.js';

/** The settings read from the environment. */
export interface RuntimeConfig {
  mode: 'live' | 'simulated';
  /**
   * Read-only by default in live mode: no write reaches the Events API unless the attendee sets
   * COMPASS_ALLOW_WRITES=1 (compass-power task 37). Simulated mode never calls the Events API, so
   * its made-up bookings stay on.
   */
  readOnly: boolean;
  compassApiUrl: string;
  /** Passed to the pass client as `allowedHosts`: only the host of `compassApiUrl`. */
  allowedHosts: string[];
  /** A one-line warning to print when the override is in use. */
  warning?: string;
}

function parseOverride(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CompassError('BadRequest');
  }
  if (url.protocol !== 'https:') {
    throw new CompassError('BadRequest');
  }
  return url;
}

/** Reads the mode and the Compass API settings from `env`. */
export function readRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  const mode = env.COMPASS_MODE === 'simulated' ? 'simulated' : 'live';
  const readOnly = mode === 'live' && env.COMPASS_ALLOW_WRITES !== '1';
  const override = env.COMPASS_API_URL;
  const overrideAllowed = env.COMPASS_ALLOW_API_OVERRIDE === '1';
  if (override === undefined || override === '' || !overrideAllowed) {
    return {
      mode,
      readOnly,
      compassApiUrl: COMPASS_API_BASE_URL,
      allowedHosts: [new URL(COMPASS_API_BASE_URL).host],
    };
  }
  const url = parseOverride(override);
  return {
    mode,
    readOnly,
    compassApiUrl: url.toString().replace(/\/+$/, ''),
    allowedHosts: [url.host],
    warning: `Warning: the Compass API override is in use, so passes go to ${url.host} and not the built-in service.`,
  };
}
