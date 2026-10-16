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
//   2. Structural patterns. Independently of any registration, the logger removes
//      values that are shaped like the secrets we care about: JWT-like compact
//      serializations (three base64url segments separated by dots), the value
//      following an Authorization/Bearer prefix, and email addresses.
//
// The placeholder written in place of every removed value is a single fixed token
// so logs stay readable and no length or content of the secret leaks.

const REDACTED = '[REDACTED]';

// A JWT compact serialization: three base64url segments separated by dots. Access
// and ID tokens are JWTs; this catches any of them even if not registered. The
// segments are required to be reasonably long so ordinary dotted identifiers (for
// example a.b.c) are not mistaken for a token.
const JWT_PATTERN = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

// An Authorization header value, including the Bearer and ApplePass schemes and a
// bare token. The prefix is an "authorization:" (or "=") header name optionally
// followed by a scheme word, OR a bare "bearer"/"applepass" scheme. Whatever
// credential follows on the same line is the captured value to redact. Capturing
// the optional scheme inside the prefix means "Authorization: Bearer <token>"
// removes the token, not the scheme word.
const AUTHORIZATION_PATTERN =
  /\b(authorization\s*[:=]\s*(?:bearer\s+|applepass\s+)?|bearer\s+|applepass\s+)([^\s"',]+)/gi;

// An email address. The refresh token is opaque and registered as a needle; email
// addresses are removed structurally so an address in a response body or error can
// never reach a log line.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Escape a string for safe inclusion in a RegExp source.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A logger whose output is guaranteed to contain no registered secret, no JWT-like
 * token, no Authorization credential and no email address.
 */
export interface RedactingLogger {
  /**
   * Register an exact secret value to scrub from every subsequent logged line.
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
    let out = line;
    // Registered needles, longest first so overlapping values collapse cleanly.
    const needles = [...secrets].sort((a, b) => b.length - a.length);
    for (const needle of needles) {
      out = out.replace(new RegExp(escapeRegExp(needle), 'g'), REDACTED);
    }
    // Structural patterns. Authorization first so its credential is replaced as a
    // unit (scheme kept, credential removed), then standalone JWTs and emails.
    out = out.replace(AUTHORIZATION_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`);
    out = out.replace(JWT_PATTERN, REDACTED);
    out = out.replace(EMAIL_PATTERN, REDACTED);
    return out;
  }

  return {
    addSecret(secret) {
      if (secret !== undefined && secret.length > 0) {
        secrets.add(secret);
      }
    },
    removeSecret(secret) {
      if (secret !== undefined && secret.length > 0) {
        secrets.delete(secret);
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
