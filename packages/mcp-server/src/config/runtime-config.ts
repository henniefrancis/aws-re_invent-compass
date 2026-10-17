// Reads COMPASS_MODE and COMPASS_API_URL (task 1.2). Anything other than the exact value
// `simulated` means live mode, and an override URL must be https so a token can never be
// sent in clear text. Errors carry no value.

import { CompassError } from '../ports/errors.js';
import { COMPASS_API_BASE_URL } from './compass-api.js';

/** The settings read from the environment. */
export interface RuntimeConfig {
  mode: 'live' | 'simulated';
  compassApiUrl: string;
}

function parseOverride(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CompassError('BadRequest');
  }
  if (url.protocol !== 'https:') {
    throw new CompassError('BadRequest');
  }
  return url.toString().replace(/\/+$/, '');
}

/** Reads the mode and the Compass API URL from `env`. */
export function readRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  const override = env.COMPASS_API_URL;
  return {
    mode: env.COMPASS_MODE === 'simulated' ? 'simulated' : 'live',
    compassApiUrl:
      override === undefined || override === '' ? COMPASS_API_BASE_URL : parseOverride(override),
  };
}
