// Credential provider and audience guard (events-client, S1, task 9.6).
//
// Each credential has exactly one audience (Requirement 4):
//   - the access token goes only to api.awsevents.com (the Events API),
//   - the refresh token goes only to oauth.awsevents.com (token and revoke),
//   - the ID token goes only to the passes caller, for the Compass API.
// assertAudience is the single enforcement point: it refuses any mismatch. The api
// layer sees only EventsApiCredential (the access token); the ID token is reached
// through the separate IdTokenProvider and is never part of the ClientContext.
//
// The providers do not own tokens or refresh logic. They sit over CredentialSources,
// a small seam the token store and the single-flight refresh are wired into (task
// 11), so this file has no dependency on either and stays unit-testable.

import { AudienceError, NotSignedInError } from './errors.js';
import type { EventsApiCredential } from '../api/transport.js';

/** The three credential kinds and the single audience each may be released to. */
export type CredentialKind = 'access-token' | 'refresh-token' | 'id-token';

/** The Events API host: the only destination for the access token. */
export const EVENTS_API_HOST = 'api.awsevents.com';
/** The OAuth host: the only destination for the refresh token. */
export const OAUTH_HOST = 'oauth.awsevents.com';
/**
 * The ID token's audience: the passes caller reaching the Compass API. The Compass
 * API host belongs to another stream, so the audience is a fixed label that only the
 * passes module passes in; no Events API or OAuth host can ever match it.
 */
export const ID_TOKEN_AUDIENCE = 'compass-api';

const AUDIENCES: Readonly<Record<CredentialKind, string>> = {
  'access-token': EVENTS_API_HOST,
  'refresh-token': OAUTH_HOST,
  'id-token': ID_TOKEN_AUDIENCE,
};

/**
 * Refuse to release a credential to anything but its own audience. The comparison is
 * an exact, case-insensitive match on the whole host, so a look-alike such as
 * api.awsevents.com.example.net never matches.
 */
export function assertAudience(kind: CredentialKind, targetHost: string): void {
  if (AUDIENCES[kind] !== targetHost.toLowerCase()) {
    throw new AudienceError();
  }
}

/** The token reads and refresh actions the providers are built on. */
export interface CredentialSources {
  /** Refresh first when the access token is within 300 seconds of expiry. */
  refreshIfNeeded(): Promise<void>;
  /** Refresh now, regardless of the expiry window. Rejects on failure. */
  refreshNow(): Promise<void>;
  /** The current access token, or undefined when not signed in. */
  accessToken(): string | undefined;
  /** The current ID token, or undefined when not signed in. */
  idToken(): string | undefined;
}

/** Provides the ID token to the passes module only. */
export interface IdTokenProvider {
  /** Refreshes within 300 seconds of expiry, then returns the ID token. */
  getIdTokenForCompassApi(): Promise<string>;
}

/** The Events API credential: the access token only, never the ID or refresh token. */
export function createEventsApiCredential(sources: CredentialSources): EventsApiCredential {
  return {
    async getAccessTokenForEventsApi() {
      assertAudience('access-token', EVENTS_API_HOST);
      await sources.refreshIfNeeded();
      const token = sources.accessToken();
      if (token === undefined) {
        throw new NotSignedInError();
      }
      return token;
    },
    forceRefresh() {
      return sources.refreshNow();
    },
  };
}

/** The ID token provider for the passes module. Not part of the ClientContext. */
export function createIdTokenProvider(sources: CredentialSources): IdTokenProvider {
  return {
    async getIdTokenForCompassApi() {
      assertAudience('id-token', ID_TOKEN_AUDIENCE);
      await sources.refreshIfNeeded();
      const token = sources.idToken();
      if (token === undefined) {
        throw new NotSignedInError();
      }
      return token;
    },
  };
}
