// Typed errors for the GitHub module (compass-power task 45.1).
//
// Every failure the module raises is one of these classes, all extending GitHubError. The
// messages are fixed strings: never a token, a refresh token, a device code, a header, a URL,
// a repository name or a response body (Requirement P2.9). The only variable content an error
// carries is a status number, a reset time or a short reason taken from a fixed list.

/** The base for every error the GitHub module throws. */
export abstract class GitHubError extends Error {
  protected constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** There is no usable GitHub token: the attendee must connect GitHub (again). */
export class GitHubNotConnectedError extends GitHubError {
  constructor() {
    super('GitHubNotConnectedError', 'GitHub is not connected. Connect GitHub to continue');
  }
}

/** GitHub refused the call because a rate limit was reached. */
export class GitHubRateLimitedError extends GitHubError {
  /** When the limit resets, in epoch milliseconds, if GitHub said. */
  readonly resetAt: number | undefined;

  constructor(resetAt: number | undefined) {
    super('GitHubRateLimitedError', 'GitHub rate limit reached. Try again later');
    this.resetAt = resetAt;
  }
}

/** A GitHub call answered with a status the module does not accept, or an unusable body. */
export class GitHubRequestError extends GitHubError {
  readonly status: number;

  constructor(status: number) {
    super('GitHubRequestError', `GitHub answered with status ${String(status)}`);
    this.status = status;
  }
}

/** A GitHub call failed over the network or ran past its time limit. The cause is not kept. */
export class GitHubNetworkError extends GitHubError {
  constructor() {
    super('GitHubNetworkError', 'GitHub could not be reached');
  }
}

/** A request to a URL outside the fixed GitHub hosts (or a token to the wrong host) was refused. */
export class GitHubUrlRefusedError extends GitHubError {
  constructor() {
    super('GitHubUrlRefusedError', 'A request outside the allowed GitHub hosts was refused');
  }
}

/** The repository does not exist, or the GitHub App cannot read it. */
export class GitHubRepositoryNotFoundError extends GitHubError {
  constructor() {
    super(
      'GitHubRepositoryNotFoundError',
      'That repository could not be found, or the GitHub App cannot read it',
    );
  }
}

/** The repository archive was refused (a redirect elsewhere) or could not be read. */
export class GitHubArchiveError extends GitHubError {
  constructor() {
    super('GitHubArchiveError', 'The repository archive could not be read');
  }
}

/** The documented GitHub OAuth error codes that end a sign-in or a refresh. */
export const GITHUB_FAILURE_CODES = [
  'incorrect_client_credentials',
  'device_flow_disabled',
  'unsupported_grant_type',
  'incorrect_device_code',
  'bad_verification_code',
  'unverified_user_email',
  'redirect_uri_mismatch',
] as const;

/**
 * Why a GitHub sign-in step failed: a documented code, or one of `unknown_error` (an error
 * code GitHub does not document), `invalid_response` (a body that is not a usable answer),
 * `http_error` (a failing status with no error code) and `network`.
 */
export type GitHubSignInFailure =
  | (typeof GITHUB_FAILURE_CODES)[number]
  | 'unknown_error'
  | 'invalid_response'
  | 'http_error'
  | 'network';

/** Starting the device flow or refreshing a token failed. Carries only the reason. */
export class GitHubSignInError extends GitHubError {
  readonly reason: GitHubSignInFailure;

  constructor(reason: GitHubSignInFailure) {
    super('GitHubSignInError', `GitHub sign-in failed (${reason})`);
    this.reason = reason;
  }
}
