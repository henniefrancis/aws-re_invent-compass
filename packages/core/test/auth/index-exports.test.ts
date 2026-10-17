import { describe, expect, test } from 'vitest';
import * as auth from '../../src/auth/index.js';

// Structural export test for the auth entry point (events-client, S1, task 16.1).
// The list is explicit so a new export, especially one that could expose a token, is a deliberate change.

const EXPECTED = [
  'OAuthNetworkError',
  'OAuthTimeoutError',
  'CONNECTIONS_CHECKING_INTERVAL_MS',
  'AUTHORIZE_ENDPOINT',
  'AudienceError',
  'AuthError',
  'BUILDER_ID_SIGN_OUT_URL',
  'CALLBACK_PATH',
  'MAX_WRONG_STATE_CALLBACKS',
  'CLIENT_ID',
  'CallbackError',
  'DEFAULT_SIGN_IN_TIMEOUT_MS',
  'EVENTS_API_HOST',
  'HEADERS_TIMEOUT_MS',
  'IDENTITY_PROVIDER',
  'ID_TOKEN_AUDIENCE',
  'KEYCHAIN_ACCOUNTS',
  'KEYCHAIN_SERVICE',
  'LOOPBACK_PORTS',
  'MAX_HEADER_SIZE_BYTES',
  'MEMORY_ONLY_NOTICE',
  'NoLoopbackPortError',
  'NotSignedInError',
  'OAUTH_HOST',
  'OAUTH_REQUEST_TIMEOUT_MS',
  'REFRESH_WINDOW_SECONDS',
  'REQUEST_TIMEOUT_MS',
  'REVOKE_ENDPOINT',
  'REVOKE_TIMEOUT_MS',
  'RefreshFailedError',
  'SCOPE',
  'SignInFailedError',
  'SignInRequiredError',
  'SignInTimeoutError',
  'StateMismatchError',
  'TOKEN_ENDPOINT',
  'assertAudience',
  'bindLoopback',
  'buildAuthorizeUrl',
  'computeChallenge',
  'createCredentialSources',
  'createEventsApiCredential',
  'createIdTokenProvider',
  'createPkcePair',
  'createState',
  'createTokenStore',
  'defaultLoopbackDeps',
  'defaultOAuthFetch',
  'redirectUriFor',
  'refreshIfNeeded',
  'refreshNow',
  'registerStoreSecrets',
  'signIn',
  'signOut',
  'startSignIn',
];

describe('events-client, task 16.1: the auth entry point', () => {
  test('exports exactly the listed runtime names', () => {
    expect(Object.keys(auth).sort()).toEqual([...EXPECTED].sort());
  });

  test('no export reads a token out of the store directly', () => {
    for (const name of Object.keys(auth)) {
      expect(name).not.toMatch(/^get(Access|Refresh|Id)Token$/);
    }
  });
});
