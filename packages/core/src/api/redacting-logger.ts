// Redacting logger for @compass/core (events-client, S1).
//
// Component 8 in the design: the single logging mechanism for every component in
// this stream. It scrubs any access token, refresh token, ID token, email value
// and Authorization header value from every line before it is written, so that
// Requirements 2.5, 7.7 and 20 hold: no secret ever reaches a log line.
//
// Redaction works in two complementary ways:
//   1. Registered needles. A caller (the auth and api layers) registers each exact
//      secret value it holds (a token string) through addSecret. Every registered
//      value is replaced wherever it appears in a logged line, including as a
//      substring, so a token embedded in a URL or a header dump is removed too.
//   2. Structural patterns. Independently of any registration, the shared redactor removes
//      values that are shaped like the secrets we care about (URLs, credentials, JWTs, emails,
//      long opaque tokens).
//
// The rules live in one place, ../redact/redact.ts (release gate, CTO review M1); this logger
// only owns the registered needles and the sink.
import { redact as redactText, secretVariants } from '../redact/redact.js';

export { MAX_REDACT_INPUT_LENGTH } from '../redact/redact.js';

/**
 * A logger whose output is guaranteed to contain no registered secret, no JWT-like
 * token, no Authorization credential and no email address.
 */
export interface RedactingLogger {
  /**
   * Register an exact secret value (and its URL-encoded and form-encoded forms) to
   * scrub from every subsequent logged line.
   * Empty strings are ignored so an unset token never turns into a match-all.
   */
  addSecret(secret: string | undefined): void;
  /**
   * Remove the given secret from the registered set, if present.
   */
  removeSecret(secret: string | undefined): void;
  /** Redact a single string without writing it, for building safe error messages. */
  redact(line: string): string;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * The sink a RedactingLogger writes redacted lines to. Injected so tests can
 * capture output and production can point it at the process streams.
 */
export interface LogSink {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

/**
 * Minimal console shape, read from globalThis so the package builds without
 * @types/node in its lib set (matching the other packages in this monorepo). The
 * runtime always provides console; this only describes the three methods used.
 */
interface ConsoleLike {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

const runtimeConsole = (globalThis as unknown as { console: ConsoleLike }).console;

/**
 * The default sink writes to the console. Kept tiny so the redaction logic, not the
 * transport, is what the tests exercise.
 */
export const consoleSink: LogSink = {
  info: (line) => {
    runtimeConsole.info(line);
  },
  warn: (line) => {
    runtimeConsole.warn(line);
  },
  error: (line) => {
    runtimeConsole.error(line);
  },
};

/**
 * Create a redacting logger over the given sink (the console by default).
 *
 * The returned logger owns a private set of registered secret needles. Redaction
 * applies the registered needles first (longest first, so a token that contains a
 * shorter registered value is fully removed), then the structural patterns.
 */
export function createRedactingLogger(sink: LogSink = consoleSink): RedactingLogger {
  const secrets = new Set<string>();

  function redact(line: string): string {
    return redactText(line, [...secrets]);
  }

  return {
    addSecret(secret) {
      if (secret !== undefined && secret.length > 0) {
        for (const form of secretVariants(secret)) {
          secrets.add(form);
        }
      }
    },
    removeSecret(secret) {
      if (secret !== undefined && secret.length > 0) {
        for (const form of secretVariants(secret)) {
          secrets.delete(form);
        }
      }
    },
    redact,
    info(message) {
      sink.info(redact(message));
    },
    warn(message) {
      sink.warn(redact(message));
    },
    error(message) {
      sink.error(redact(message));
    },
  };
}
