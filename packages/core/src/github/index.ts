// Public surface of @compass/core/github (compass-power task 45.1): GitHub device-flow sign-in and
// refresh, the GitHub_Token_Store, the listing client, the in-memory archive reader and the worker
// that scans one repository under a hard budget. Exported by name; there is no barrel of barrels.
export {
  GITHUB_FAILURE_CODES,
  GitHubArchiveError,
  GitHubError,
  GitHubNetworkError,
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  GitHubRepositoryNotFoundError,
  GitHubRequestError,
  GitHubSignInError,
  GitHubUrlRefusedError,
} from './errors.js';
export type { GitHubSignInFailure } from './errors.js';
export {
  ALLOWED_GITHUB_HOSTS,
  GITHUB_API_VERSION,
  USER_AGENT,
  assertAllowedUrl,
  defaultGitHubFetch,
} from './http.js';
export type { GitHubFetch, GitHubFetchInit, GitHubResponseLike } from './http.js';
export {
  ACCESS_TOKEN_URL,
  DEVICE_CODE_URL,
  DEVICE_GRANT_TYPE,
  SLOW_DOWN_SECONDS,
  pollDeviceToken,
  refreshGitHubToken,
  startDeviceFlow,
  waitForDeviceToken,
} from './device-flow.js';
export type {
  DeviceFlowStart,
  DevicePollResult,
  DeviceWaitResult,
  GitHubTokens,
  PollDeviceTokenOptions,
  RefreshGitHubTokenOptions,
  StartDeviceFlowOptions,
  WaitForDeviceTokenOptions,
} from './device-flow.js';
export {
  GITHUB_KEYCHAIN_ACCOUNTS,
  GITHUB_KEYCHAIN_SERVICE,
  GITHUB_REFRESH_WINDOW_SECONDS,
  createGitHubTokenStore,
  getAccessToken,
  registerGitHubSecrets,
} from './token-store.js';
export type {
  GetAccessTokenOptions,
  GitHubTokenStore,
  GitHubTokenStoreOptions,
} from './token-store.js';
export {
  GITHUB_API_ORIGIN,
  MAX_LISTED_REPOSITORIES,
  MAX_LISTING_PAGES,
  createGitHubClient,
  isRepositoryFullName,
} from './client.js';
export type {
  GitHubClient,
  GitHubClientOptions,
  GitHubOwnerType,
  GitHubRepository,
} from './client.js';
export { DEFAULT_ARCHIVE_LIMITS, readRepositoryArchive } from './archive.js';
export type { ArchiveLimits, ReadRepositoryArchiveOptions } from './archive.js';
export {
  DEFAULT_GITHUB_SCAN_BUDGET_MS,
  GITHUB_WORKER_HEAP_MB,
  scanGitHubRepoInWorker,
} from './scan-in-worker.js';
export type { GitHubWorkerLike, ScanGitHubRepoOptions } from './scan-in-worker.js';
export type {
  GitHubScanFailure,
  GitHubScanReply,
  GitHubScanRequest,
} from './github-scan-worker-core.js';
