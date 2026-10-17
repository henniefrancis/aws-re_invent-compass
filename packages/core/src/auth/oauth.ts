// OAuth constants and the form POST helper shared by sign-in, refresh and sign-out
// (events-client, S1).
//
// Every endpoint, the client id and the scope come from the official Events API
// sign-in documentation (tech steering, checked 15 October 2026). Nothing here is
// invented. The fetch is injected so no test reaches the real OAuth endpoints.
//
// Nothing in this file logs, and no error it raises carries a response body, a code,
// a token or a header: a failed call yields only a status and a safe error code.

import { z } from 'zod';
import { MAX_OAUTH_BODY_BYTES, readBodyCapped, type CappableResponse } from '../api/capped-body.js';

export const AUTHORIZE_ENDPOINT = 'https://oauth.awsevents.com/oauth2/authorize';
export const TOKEN_ENDPOINT = 'https://oauth.awsevents.com/oauth2/token';
export const REVOKE_ENDPOINT = 'https://oauth.awsevents.com/oauth2/revoke';
/** The Builder ID sign-out page returned to the caller after sign-out. */
export const BUILDER_ID_SIGN_OUT_URL = 'https://idp.awsevents.com/oidc/logout';
/** The public, shared client id. */
export const CLIENT_ID = '7vmom55m1qstvq8i71ph127bfq';
export const SCOPE = 'openid email events/access';
export const IDENTITY_PROVIDER = 'AWSBuilderID';
/** The time limit for a token or refresh call (revoke uses its own 10 second limit). */
export const OAUTH_REQUEST_TIMEOUT_MS = 30_000;
/** Refresh when the access token has this many seconds or fewer left. */
export const REFRESH_WINDOW_SECONDS = 300;

/** The init bag the injected fetch receives. Only what the OAuth calls set. */
export interface OAuthFetchInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  /** Never follow a redirect: it could carry a refresh token elsewhere. */
  redirect: 'error';
  /** Aborts the call: after 30 seconds by default, or the caller's own signal. */
  signal: AbortSignal;
}

/** The part of a fetch Response the OAuth calls read. */
export interface OAuthResponseLike extends CappableResponse {
  status: number;
  text(): Promise<string>;
}

/** The injected fetch shape. Tests pass a fake; production uses the global fetch. */
export type OAuthFetch = (url: string, init: OAuthFetchInit) => Promise<OAuthResponseLike>;

/** The real fetch, used only in production. Tests always inject a fake. */
export const defaultOAuthFetch: OAuthFetch = (url, init) => fetch(url, init);

/** The parsed outcome of one form POST: the status and the JSON body if it had one. */
export interface FormResult {
  status: number;
  json: unknown;
}

/** POST an application/x-www-form-urlencoded body and parse any JSON reply. */
export async function postForm(
  doFetch: OAuthFetch,
  url: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<FormResult> {
  const init: OAuthFetchInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
  };
  const response = await doFetch(url, init);
  const text = await readBodyCapped(response, MAX_OAUTH_BODY_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
}

/** True for a 2xx status. */
export function isOk(status: number): boolean {
  return status >= 200 && status <= 299;
}

/** The hostname of one of the constant endpoints, for the audience guard. */
export function hostOf(url: string): string {
  return new URL(url).hostname;
}

/** The token endpoint success body. Expiry comes from expires_in, never from a JWT. */
const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  // Only bearer tokens are accepted, as the Events API expects (finding L5).
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
});

/** A validated token response, or undefined when the body is not a usable one. */
export interface TokenResponse {
  accessToken: string;
  idToken: string;
  refreshToken: string | undefined;
  expiresInSeconds: number;
}

/** Parse a token endpoint body, returning undefined (never the body) on any problem. */
export function parseTokenResponse(json: unknown): TokenResponse | undefined {
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  return {
    accessToken: parsed.data.access_token,
    idToken: parsed.data.id_token,
    refreshToken: parsed.data.refresh_token,
    expiresInSeconds: parsed.data.expires_in,
  };
}

/** The OAuth error code of an error body, kept only if it is a short lower-case code. */
export function oauthErrorCode(json: unknown): string | undefined {
  const parsed = z.object({ error: z.string().regex(/^[a-z_]{1,40}$/) }).safeParse(json);
  return parsed.success ? parsed.data.error : undefined;
}
