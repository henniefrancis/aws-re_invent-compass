// Redaction helper and the shared error shape for the pass side (boarding-passes, S4).
//
// One rule crosses every S4 component (Requirement 8): the ID token, the attendee
// email, the Board_URL and the hand-off id are secrets that must never appear in a log
// line or an error message. This module centralises that rule so every component can
// build a summary that is safe to log and safe to show.

import { redact as redactText } from '../redact/redact.js';

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

/** The longest input the shared redactor scans (see ../redact/redact.ts). */
export { MAX_REDACT_INPUT_LENGTH as MAX_REDACT_INPUT } from '../redact/redact.js';

/**
 * Returns a string that is safe to log or to place in an error message. The rules are the
 * project's one redactor (release gate, CTO review M1): URLs (which carry the Board_URL and
 * the hand-off id fragment), credentials, key=value secrets, JWT shaped tokens, email
 * addresses and long opaque tokens are replaced with a placeholder that contains no part of
 * the original value.
 */
export function redact(value: string): string {
  return redactText(value);
}

/**
 * Build a PassError (ready to throw) whose summary has passed through redact. Use this everywhere an S4
 * component surfaces a failure, so no secret can reach the error path.
 */
export function passError(code: string, summary: string): PassError {
  return new PassError(code, summary);
}
