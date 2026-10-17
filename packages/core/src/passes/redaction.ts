// Redaction helper and the shared error shape for the pass side (boarding-passes, S4).
//
// One rule crosses every S4 component (Requirement 8): the ID token, the attendee
// email, the Board_URL and the hand-off id are secrets that must never appear in a log
// line or an error message. This module centralises that rule so every component can
// build a summary that is safe to log and safe to show.

/**
 * The error every S4 component raises. It carries a stable, machine-readable code and
 * a human-readable summary that has already passed through redact, so it never carries
 * a credential, the Board_URL, the hand-off id or any request input. It extends Error
 * so it can be thrown (the lint rules forbid throwing a plain object); its message is
 * the redacted summary, and it never records a cause or any other field.
 */
export class PassError extends Error {
  readonly code: string;
  readonly summary: string;

  constructor(code: string, summary: string) {
    const safe = redact(summary);
    super(safe);
    this.name = 'PassError';
    this.code = code;
    this.summary = safe;
  }
}

/**
 * A redaction placeholder written in place of a matched secret. It carries no part of
 * the original value.
 */
const REDACTED = '[redacted]';

/**
 * An Authorization style bearer credential: the word Bearer followed by the token.
 */
const BEARER_PATTERN = /\bBearer\s+\S+/gi;

/**
 * A JWT shaped value: three base64url segments separated by dots. Matched before email
 * so a token is never left behind.
 */
const JWT_PATTERN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/**
 * An email address. Deliberately conservative: a local part, an at sign and a dotted
 * domain. Replaced whole so neither the local part nor the domain survives.
 */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Any http or https URL, including its path, query and fragment. This catches the
 * Board_URL (whose hand-off id lives in its URL fragment) so neither the URL nor the
 * fragment is ever logged. The match stops at whitespace.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s]+/g;

/**
 * A key=value or key: value secret: a credential-like key name followed by its value, as in
 * access_token=abc or password: hunter2. The whole pair is replaced.
 */
const KEY_VALUE_PATTERN =
  /\b(?:access_token|id_token|refresh_token|token|secret|password|passwd|api[_-]?key|key|signature|sig|authorization|credential)s?\s*[=:]\s*\S+/gi;

/**
 * A long opaque token: a run of 22 or more base64 or base64url characters (22 is the
 * shortest base64url rendering of 128 bits), with optional padding. This catches a bare
 * hand-off id or capability and a refresh token that appears outside a URL, in either
 * base64 alphabet.
 */
const OPAQUE_PATTERN = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{22,}={0,2}/g;

/**
 * Return a string that is safe to log or to place in an error message. Every http or
 * https URL (which carries the Board_URL and the hand-off id fragment), every bearer
 * credential, every key=value secret, every JWT shaped token, every email address and
 * every long opaque token is replaced with a placeholder that contains no part of the
 * original value. The order matters: URLs are redacted first so a token or email sitting
 * inside a URL is removed with the URL, then bearer credentials, key=value pairs, JWTs,
 * emails and bare opaque tokens.
 */
export function redact(value: string): string {
  return value
    .replace(URL_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, REDACTED)
    .replace(KEY_VALUE_PATTERN, REDACTED)
    .replace(JWT_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(OPAQUE_PATTERN, REDACTED);
}

/**
 * Build a PassError (ready to throw) whose summary has passed through redact. Use this everywhere an S4
 * component surfaces a failure, so no secret can reach the error path.
 */
export function passError(code: string, summary: string): PassError {
  return new PassError(code, summary);
}
