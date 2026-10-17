// Typed errors for the auth module (events-client, S1).
//
// Every auth failure is one of these classes, all extending AuthError. Messages are
// fixed strings built from safe inputs only: never a token, a refresh token, an ID
// token, an email, an Authorization header, an authorization code or a raw response
// body (Requirements 2.5, 20.2). The only variable content any error carries is a
// short machine code that is checked against a strict pattern before use.

/** The base for every error the auth module throws. */
export abstract class AuthError extends Error {
  protected constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** None of the loopback ports could be bound (Requirement 1.3). */
export class NoLoopbackPortError extends AuthError {
  constructor() {
    super('NoLoopbackPortError', 'No loopback port is available for sign-in');
  }
}

/** No request reached /callback within the sign-in timeout (Requirement 1.6). */
export class SignInTimeoutError extends AuthError {
  constructor() {
    super('SignInTimeoutError', 'Sign-in timed out waiting for the browser redirect');
  }
}

/** The redirect carried an error or was malformed. */
export class CallbackError extends AuthError {
  /** A short lower-case OAuth error code, or "invalid_callback". Never free text. */
  readonly code: string;

  constructor(code: string) {
    super('CallbackError', `Sign-in was not completed (${code})`);
    this.code = code;
  }
}

/** The credential kind does not match the destination (Requirement 4.5). */
export class AudienceError extends AuthError {
  constructor() {
    super('AudienceError', 'A credential was refused because the destination is not its audience');
  }
}

/** No token is held, so the attendee must sign in. */
export class NotSignedInError extends AuthError {
  constructor() {
    super('NotSignedInError', 'Not signed in. Sign in to continue');
  }
}

/** The redirect state did not match the state generated for this attempt. */
export class StateMismatchError extends AuthError {
  constructor() {
    super('StateMismatchError', 'Sign-in was rejected because the state value did not match');
  }
}

/** The authorization code exchange failed or returned an unusable response. */
export class SignInFailedError extends AuthError {
  constructor() {
    super('SignInFailedError', 'Sign-in failed during the token exchange');
  }
}

/** The refresh token was rejected, so the attendee must sign in again. */
export class SignInRequiredError extends AuthError {
  constructor() {
    super('SignInRequiredError', 'The session has ended. Sign in again to continue');
  }
}

/** A refresh failed for a reason other than a rejected refresh token. */
export class RefreshFailedError extends AuthError {
  constructor() {
    super('RefreshFailedError', 'The access token could not be refreshed');
  }
}

/** An OAuth call failed over the network. Fixed message; the cause is not kept. */
export class OAuthNetworkError extends AuthError {
  constructor() {
    super('OAuthNetworkError', 'The sign-in service could not be reached');
  }
}

/** An OAuth call ran past its time limit. Fixed message; the cause is not kept. */
export class OAuthTimeoutError extends AuthError {
  constructor() {
    super('OAuthTimeoutError', 'The sign-in service did not answer in time');
  }
}
