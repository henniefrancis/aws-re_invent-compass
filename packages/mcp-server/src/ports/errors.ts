// The one error class that crosses the port seams (design, Error Handling).
//
// Adapters map S1 typed errors and S4 pass errors onto a CompassError code. The class
// carries no free text from upstream: the message is the code, and the only optional
// payloads are a wait in seconds and an already redacted pass summary. Nothing the
// model supplied can ride on it, so a handler can never echo input through an error.

/** Every failure a handler or adapter can raise, one fixed message per code. */
export type CompassErrorCode =
  | 'FolderNotFound'
  | 'IdentifierRejected'
  | 'UnknownSession'
  | 'CatalogMissing'
  | 'NotSignedIn'
  | 'RateLimited'
  | 'Unauthorized'
  | 'Forbidden'
  | 'NotFound'
  | 'Conflict'
  | 'BadRequest'
  | 'Validation'
  | 'Server'
  | 'UnexpectedResponse'
  | 'EventWindow'
  | 'PassError'
  | 'SpecWriteRefused'
  | 'MaxPerDayRange'
  | 'LayoverInvalid'
  | 'LimitInvalid'
  | 'NoPassesIssued'
  | 'BulkVoidRefused'
  | 'Network'
  | 'ScanTimeout'
  | 'ScanOutsideWorkspace'
  | 'InputTooLarge'
  | 'LevelInvalid'
  | 'InputInvalid'
  | 'UnsafePath'
  | 'Internal';

/** Optional, non-sensitive details a code may carry. */
export interface CompassErrorDetails {
  /** Seconds to wait, for RateLimited. */
  retryAfterSeconds?: number;
  /** A pass-side summary that S4 already redacted, for PassError. */
  summary?: string;
}

/** A typed error with a fixed code and no upstream free text. */
export class CompassError extends Error {
  readonly code: CompassErrorCode;
  readonly details: CompassErrorDetails;

  constructor(code: CompassErrorCode, details: CompassErrorDetails = {}) {
    super(code);
    this.name = 'CompassError';
    this.code = code;
    this.details = details;
  }
}
