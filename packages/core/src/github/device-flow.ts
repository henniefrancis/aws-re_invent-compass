// GitHub device flow sign-in and token refresh (compass-power task 45.1, Requirement P2.8).
//
// Source of truth: GitHub "Generating a user access token for a GitHub App" (device flow) and
// "Refreshing user access tokens", checked 20 October 2026. The device flow posts the client ID
// to https://github.com/login/device/code, then polls https://github.com/login/oauth/access_token
// with grant_type urn:ietf:params:oauth:grant-type:device_code no faster than `interval`,
// adding 5 seconds on slow_down. GitHub answers a pending poll with status 200 and an `error`
// field, so the error code is always read before the status. A device-flow token refreshes with
// grant_type refresh_token and no client secret.
//
// Parameters go in a form body, never in the URL, so a refresh token or device code can never
// reach a URL log. Nothing thrown or returned carries a token, a device code or a body: a
// failure is a reason from a fixed list. The fetch, clock and sleep are injected.

import { z } from 'zod';
import { MAX_OAUTH_BODY_BYTES } from '../api/capped-body.js';
import {
  GITHUB_FAILURE_CODES,
  GitHubNetworkError,
  GitHubNotConnectedError,
  GitHubSignInError,
  type GitHubSignInFailure,
} from './errors.js';
import {
  GITHUB_REQUEST_TIMEOUT_MS,
  USER_AGENT,
  readJsonBody,
  sendGitHubRequest,
  type GitHubFetch,
} from './http.js';

export const DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
/** The seconds GitHub adds to the polling interval on each slow_down. */
export const SLOW_DOWN_SECONDS = 5;

/** The GitHub tokens. Expiry is epoch milliseconds from `expires_in`; absent for a non-expiring token. */
export interface GitHubTokens {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
}

/** A started device flow. `deviceCode` is a secret: it is only ever sent back to GitHub. */
export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the codes expire. */
  expiresIn: number;
  /** The minimum seconds between polls. */
  interval: number;
}

/** The outcome of one poll. */
export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slowDown'; interval?: number }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'failed'; reason: GitHubSignInFailure }
  | { status: 'ok'; tokens: GitHubTokens };

/** The outcome of waiting for the attendee: a final poll result, or `aborted`. */
export type DeviceWaitResult =
  Exclude<DevicePollResult, { status: 'pending' } | { status: 'slowDown' }> | { status: 'aborted' };

/** True when `value` is an https URL on github.com, safe to show and open. */
function isGitHubWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.port === '';
  } catch {
    return false;
  }
}

const DeviceCodeSchema = z.object({
  device_code: z.string().min(1).max(512),
  user_code: z.string().regex(/^[A-Z0-9-]{1,32}$/),
  verification_uri: z.string().refine(isGitHubWebUrl),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive().default(5),
});

const TokenSchema = z.object({
  access_token: z.string().min(1).max(4096),
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).max(4096).optional(),
});

const ErrorSchema = z.object({ error: z.string().regex(/^[a-z_]{1,40}$/) });
const IntervalSchema = z.object({ interval: z.number().int().positive() });

/** The OAuth error code of a body, kept only if it is a short lower-case code. */
function errorCode(json: unknown): string | undefined {
  const parsed = ErrorSchema.safeParse(json);
  return parsed.success ? parsed.data.error : undefined;
}

/** A documented failure code, or `unknown_error`. */
function failureReason(code: string): GitHubSignInFailure {
  return (GITHUB_FAILURE_CODES as readonly string[]).includes(code)
    ? (code as GitHubSignInFailure)
    : 'unknown_error';
}

/** Tokens from a token endpoint body, or undefined when it is not a usable one. */
function tokensFrom(json: unknown, now: () => number): GitHubTokens | undefined {
  const parsed = TokenSchema.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  return {
    accessToken: parsed.data.access_token,
    ...(parsed.data.refresh_token === undefined ? {} : { refreshToken: parsed.data.refresh_token }),
    ...(parsed.data.expires_in === undefined
      ? {}
      : { accessTokenExpiresAt: now() + parsed.data.expires_in * 1000 }),
  };
}

/** POST a form to a github.com OAuth endpoint and parse the JSON reply. */
async function postForm(
  doFetch: GitHubFetch,
  url: string,
  params: Record<string, string>,
): Promise<{ status: number; json: unknown }> {
  const response = await sendGitHubRequest(doFetch, url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body: new URLSearchParams(params).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, json: await readJsonBody(response, MAX_OAUTH_BODY_BYTES) };
}

/** True for a 2xx status. */
function isOk(status: number): boolean {
  return status >= 200 && status <= 299;
}

/** What `startDeviceFlow` needs. */
export interface StartDeviceFlowOptions {
  clientId: string;
  fetch: GitHubFetch;
}

/**
 * Start the device flow. Throws GitHubSignInError with a fixed reason when GitHub refuses or
 * answers with something unusable, and GitHubNetworkError when it cannot be reached.
 */
export async function startDeviceFlow(options: StartDeviceFlowOptions): Promise<DeviceFlowStart> {
  const { status, json } = await postForm(options.fetch, DEVICE_CODE_URL, {
    client_id: options.clientId,
  });
  const code = errorCode(json);
  if (code !== undefined) {
    throw new GitHubSignInError(failureReason(code));
  }
  if (!isOk(status)) {
    throw new GitHubSignInError('http_error');
  }
  const parsed = DeviceCodeSchema.safeParse(json);
  if (!parsed.success) {
    throw new GitHubSignInError('invalid_response');
  }
  return {
    deviceCode: parsed.data.device_code,
    userCode: parsed.data.user_code,
    verificationUri: parsed.data.verification_uri,
    expiresIn: parsed.data.expires_in,
    interval: parsed.data.interval,
  };
}

/** What `pollDeviceToken` needs. */
export interface PollDeviceTokenOptions {
  clientId: string;
  deviceCode: string;
  fetch: GitHubFetch;
  /** The clock for the token expiry (default `Date.now`). */
  now?: () => number;
}

/** The poll result for a body that carries an OAuth error code. */
function pollResultFor(code: string, json: unknown): DevicePollResult {
  switch (code) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down': {
      const interval = IntervalSchema.safeParse(json);
      return interval.success
        ? { status: 'slowDown', interval: interval.data.interval }
        : { status: 'slowDown' };
    }
    case 'access_denied':
      return { status: 'denied' };
    case 'expired_token':
    case 'token_expired':
      return { status: 'expired' };
    default:
      return { status: 'failed', reason: failureReason(code) };
  }
}

/** Poll the token endpoint once. Never throws: every failure is a `failed` result. */
export async function pollDeviceToken(options: PollDeviceTokenOptions): Promise<DevicePollResult> {
  let status: number;
  let json: unknown;
  try {
    ({ status, json } = await postForm(options.fetch, ACCESS_TOKEN_URL, {
      client_id: options.clientId,
      device_code: options.deviceCode,
      grant_type: DEVICE_GRANT_TYPE,
    }));
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof GitHubNetworkError ? 'network' : 'http_error',
    };
  }
  const code = errorCode(json);
  if (code !== undefined) {
    return pollResultFor(code, json);
  }
  if (!isOk(status)) {
    return { status: 'failed', reason: 'http_error' };
  }
  const tokens = tokensFrom(json, options.now ?? Date.now);
  return tokens === undefined
    ? { status: 'failed', reason: 'invalid_response' }
    : { status: 'ok', tokens };
}

/** True once `signal` has aborted (a function, so each check reads it afresh). */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** What `waitForDeviceToken` needs. */
export interface WaitForDeviceTokenOptions {
  clientId: string;
  deviceCode: string;
  /** The starting interval in seconds, from `startDeviceFlow`. */
  interval: number;
  /** When the codes expire, in epoch milliseconds. */
  expiresAt: number;
  fetch: GitHubFetch;
  /** Waits `ms` milliseconds; should end early when `signal` aborts. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  signal?: AbortSignal;
}

/**
 * Poll until the attendee approves or denies, the codes expire, a poll fails for good, or
 * `signal` aborts. Waits `interval` seconds before each poll and adds 5 seconds on each
 * slow_down (or uses GitHub's new interval when it is longer). A network failure is retried
 * at the next interval, since the flow can run for 15 minutes.
 */
export async function waitForDeviceToken(
  options: WaitForDeviceTokenOptions,
): Promise<DeviceWaitResult> {
  let interval = options.interval;
  for (;;) {
    if (isAborted(options.signal)) {
      return { status: 'aborted' };
    }
    await options.sleep(interval * 1000, options.signal);
    if (isAborted(options.signal)) {
      return { status: 'aborted' };
    }
    if (options.now() >= options.expiresAt) {
      return { status: 'expired' };
    }
    const result = await pollDeviceToken({
      clientId: options.clientId,
      deviceCode: options.deviceCode,
      fetch: options.fetch,
      now: options.now,
    });
    switch (result.status) {
      case 'pending':
        break;
      case 'slowDown':
        interval = Math.max(interval + SLOW_DOWN_SECONDS, result.interval ?? 0);
        break;
      case 'failed':
        if (result.reason !== 'network') {
          return result;
        }
        break;
      default:
        return result;
    }
  }
}

/** What `refreshGitHubToken` needs. */
export interface RefreshGitHubTokenOptions {
  clientId: string;
  refreshToken: string;
  fetch: GitHubFetch;
  /** The clock for the token expiry (default `Date.now`). */
  now?: () => number;
}

/**
 * Exchange a refresh token for a new token pair, without a client secret (valid for device-flow
 * tokens). A rejected refresh token (bad_refresh_token) throws GitHubNotConnectedError; any
 * other refusal throws GitHubSignInError, and a network failure GitHubNetworkError.
 */
export async function refreshGitHubToken(
  options: RefreshGitHubTokenOptions,
): Promise<GitHubTokens> {
  const { status, json } = await postForm(options.fetch, ACCESS_TOKEN_URL, {
    client_id: options.clientId,
    grant_type: 'refresh_token',
    refresh_token: options.refreshToken,
  });
  const code = errorCode(json);
  if (code === 'bad_refresh_token') {
    throw new GitHubNotConnectedError();
  }
  if (code !== undefined) {
    throw new GitHubSignInError(failureReason(code));
  }
  if (!isOk(status)) {
    throw new GitHubSignInError('http_error');
  }
  const tokens = tokensFrom(json, options.now ?? Date.now);
  if (tokens === undefined) {
    throw new GitHubSignInError('invalid_response');
  }
  return tokens;
}
