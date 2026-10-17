// The fixed error table (Requirement 17.1, design Error Handling). The mapper has no
// parameter for tool input, so nothing the model supplied can be echoed. Upstream error
// text is never used; the only variable parts are a wait in seconds and a pass-side summary
// that S4 already redacted (it passes through local redaction again).

import { FolderNotFoundError } from '@compass/core/scanner';
import { SpecWriteRefusedError } from '@compass/core/spec';
import { redactText } from '../logging/redact.js';
import { CompassError } from '../ports/errors.js';
import type { CompassErrorCode } from '../ports/errors.js';

/** The message for an unexpected failure. */
export const INTERNAL_MESSAGE =
  'Compass hit an internal problem. Nothing was changed by this step.';

const FIXED: Record<Exclude<CompassErrorCode, 'RateLimited' | 'PassError'>, string> = {
  FolderNotFound: 'That folder could not be found.',
  IdentifierRejected: 'One of the ids is not a valid session id.',
  UnknownSession:
    'That session is not in the catalog Compass has cached. Run refresh_catalog, then try again.',
  CatalogMissing: 'Run refresh_catalog first.',
  NotSignedIn: 'Run sign_in first.',
  Unauthorized: 'Your sign-in expired. Run sign_in.',
  Forbidden: 'Your account is not allowed to do that.',
  NotFound: 'The Events service could not find that.',
  Conflict: 'The Events service reports a conflict with your schedule.',
  BadRequest: 'The Events service did not accept that request.',
  Validation: 'The Events service sent data Compass could not read.',
  Server: 'The Events service had a problem. Compass did not retry.',
  UnexpectedResponse: 'The Events service sent an unexpected answer.',
  EventWindow: 'The event dates could not be read, so Compass will not guess them.',
  SpecWriteRefused: 'Compass could not write that file safely, so it wrote nothing.',
  MaxPerDayRange: 'maxPerDay must be a whole number from 1 to 8.',
  LayoverInvalid:
    'The layover times are not valid. Give a start and an end with time zone offsets, inside the event dates, with the end after the start.',
  NoPassesIssued: 'No boarding passes have been issued yet. Run issue_boarding_passes first.',
  Internal: INTERNAL_MESSAGE,
};

/** The plain-English message for a failure. */
export function messageFor(error: unknown): string {
  if (error instanceof FolderNotFoundError) {
    return FIXED.FolderNotFound;
  }
  if (error instanceof SpecWriteRefusedError) {
    return FIXED.SpecWriteRefused;
  }
  if (!(error instanceof CompassError)) {
    return INTERNAL_MESSAGE;
  }
  if (error.code === 'RateLimited') {
    const seconds = error.details.retryAfterSeconds;
    return seconds === undefined
      ? 'Too many requests. Wait a little while, then try again. Compass did not retry.'
      : `Too many requests. Wait ${Math.max(1, Math.ceil(seconds))} seconds, then try again. Compass did not retry.`;
  }
  if (error.code === 'PassError') {
    const summary = error.details.summary;
    return summary === undefined
      ? 'The pass service could not do that.'
      : `The pass service could not do that: ${redactText(summary)}`;
  }
  return FIXED[error.code];
}

/** The code used in log lines for a failure (never any message text). */
export function codeFor(error: unknown): string {
  if (error instanceof CompassError) {
    return error.code;
  }
  return 'unexpected';
}
