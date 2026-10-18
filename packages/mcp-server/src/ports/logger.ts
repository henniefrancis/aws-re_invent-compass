// The logger seam. Implementations write to stderr only, never stdout, and pass every
// line through redaction (see logging/stderr-logger.ts).

/** Values a log line may carry besides its message. Strings are redacted before writing. */
export type LogFields = Readonly<Record<string, string | number | boolean>>;

/** A redacting stderr logger. */
export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}
