// @compass/core/auth entry point (events-client, S1).
//
// PKCE sign-in, the loopback callback server, the token store with keychain and
// memory fallback, single-flight refresh, sign-out and the audience-guarded
// credential providers. Nothing here returns or exposes a token except the two
// providers (access token to the api layer, ID token to the passes module).

export {
  AuthError,
  NoLoopbackPortError,
  SignInTimeoutError,
  CallbackError,
  AudienceError,
  NotSignedInError,
  StateMismatchError,
  SignInFailedError,
  SignInRequiredError,
  RefreshFailedError,
} from './errors.js';

export {
  createPkcePair,
  createState,
  computeChallenge,
  type PkcePair,
  type RandomBytes,
} from './pkce.js';

export {
  bindLoopback,
  defaultLoopbackDeps,
  LOOPBACK_PORTS,
  CALLBACK_PATH,
  MAX_WRONG_STATE_CALLBACKS,
  MAX_HEADER_SIZE_BYTES,
  HEADERS_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  type LoopbackResult,
  type LoopbackServer,
  type LoopbackDeps,
  type BindOptions,
  type RequestHandler,
  type RequestLike,
  type ResponseLike,
  type ServerLike,
} from './loopback-server.js';

export {
  assertAudience,
  createEventsApiCredential,
  createIdTokenProvider,
  EVENTS_API_HOST,
  OAUTH_HOST,
  ID_TOKEN_AUDIENCE,
  type CredentialKind,
  type CredentialSources,
  type IdTokenProvider,
} from './credential-provider.js';

export {
  createTokenStore,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNTS,
  type TokenSet,
  type TokenStore,
  type StorageKind,
  type KeyringLike,
  type KeyringEntryLike,
} from './token-store.js';

export { registerStoreSecrets } from './secret-registering-store.js';

export {
  signIn,
  startSignIn,
  buildAuthorizeUrl,
  redirectUriFor,
  MEMORY_ONLY_NOTICE,
  DEFAULT_SIGN_IN_TIMEOUT_MS,
  type SignInDeps,
  type SignInResult,
  type PendingSignIn,
  type BrowserOpener,
} from './sign-in.js';

export {
  refreshIfNeeded,
  refreshNow,
  createCredentialSources,
  type RefreshDeps,
} from './refresh.js';

export { signOut, REVOKE_TIMEOUT_MS, type SignOutDeps, type SignOutResult } from './sign-out.js';

export {
  defaultOAuthFetch,
  AUTHORIZE_ENDPOINT,
  TOKEN_ENDPOINT,
  REVOKE_ENDPOINT,
  BUILDER_ID_SIGN_OUT_URL,
  CLIENT_ID,
  SCOPE,
  IDENTITY_PROVIDER,
  REFRESH_WINDOW_SECONDS,
  OAUTH_REQUEST_TIMEOUT_MS,
  type OAuthFetch,
  type OAuthFetchInit,
  type OAuthResponseLike,
} from './oauth.js';
