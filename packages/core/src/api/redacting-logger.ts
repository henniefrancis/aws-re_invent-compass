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

/**
 * The longest line the redactor looks at with its structural patterns. The registered
 * secrets are removed from the FULL input first (each is a plain literal search, linear
 * in the input), and only then is the line cut to this length, so a secret that sits
 * across or beyond the cut is already gone and a hostile 100 KB line can never make the
 * patterns take quadratic time (finding N4). If the cut would leave the beginning of a
 * registered secret at its very end, that fragment is dropped as well, so not even a
 * prefix of a secret survives. Every pattern below is bounded to this size too.
 */
export const MAX_REDACT_INPUT_LENGTH = 8192;
const TRUNCATED_MARK = '[TRUNCATED]';

// A JWT compact serialization: three (or, for an encrypted token, up to six) base64url
// segments separated by dots. Access
// and ID tokens are JWTs; this catches any of them even if not registered. The
// segments are required to be reasonably long so ordinary dotted identifiers (for
// example a.b.c) are not mistaken for a token.
const JWT_PATTERN =
  /(?<![A-Za-z0-9_.-])[A-Za-z0-9_-]{8,8192}(?:\.[A-Za-z0-9_-]{8,8192}){2,5}(?![A-Za-z0-9_-])/g;

// An Authorization header value, including the Bearer and ApplePass schemes and a
// bare token. The prefix is an "authorization:" (or "=") header name optionally
// followed by a scheme word, OR a bare "bearer"/"applepass" scheme. Whatever
// credential follows on the same line is the captured value to redact. Capturing
// the optional scheme inside the prefix means "Authorization: Bearer <token>"
// removes the token, not the scheme word.
const AUTHORIZATION_PATTERN =
  /\b((?:proxy-)?authorization\s{0,16}[:=]\s{0,16}(?:bearer\s{1,16}|applepass\s{1,16}|basic\s{1,16})?|bearer\s{1,16}|applepass\s{1,16})([^\s"',]{1,8192})/gi;

// A bare Basic credential (base64 of user:password). To avoid redacting ordinary
// words after "basic", the value must look like base64 data: it must contain a digit
// or one of + / =.
const BASIC_PATTERN =
  /\b(basic\s{1,16})(?=[A-Za-z0-9+/_-]{0,8192}[0-9+/=])([A-Za-z0-9+/_-]{8,8192}={0,2})/gi;

// Form and query keys that carry a secret: refresh_token=, code_verifier=, code=,
// access_token=, id_token=. The key is kept, the value removed.
const FORM_KEY_PATTERN =
  /\b(refresh_token|code_verifier|access_token|id_token|code)=([^&\s"',]{1,8192})/gi;

// The same keys in a JSON body: "refresh_token":"...". The key is kept, the value removed.
const JSON_KEY_PATTERN =
  /("(?:refresh_token|code_verifier|access_token|id_token)"\s{0,16}:\s{0,16}")([^"]{0,8192})(")/gi;

// An email address. The refresh token is opaque and registered as a needle; email
// addresses are removed structurally so an address in a response body or error can
// never reach a log line.
const EMAIL_PATTERN =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,8192}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,63}/g;

/**
 * Cut the line to MAX_REDACT_INPUT_LENGTH and mark it. A trailing fragment that is the
 * beginning of a registered needle is dropped too, so no prefix of a secret is left at
 * the cut.
 */
function cutAtLimit(text: string, needles: readonly string[]): string {
  if (text.length <= MAX_REDACT_INPUT_LENGTH) {
    return text;
  }
  const kept = text.slice(0, MAX_REDACT_INPUT_LENGTH);
  let drop = 0;
  for (const needle of needles) {
    for (let length = Math.min(needle.length - 1, kept.length); length > drop; length -= 1) {
      if (kept.endsWith(needle.slice(0, length))) {
        drop = length;
        break;
      }
    }
  }
  return `${kept.slice(0, kept.length - drop)}${TRUNCATED_MARK}`;
}

/**
 * Escape a string for safe inclusion in a RegExp source.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every form a secret can take in a log line: as given, percent-encoded as in a URL
 * query, and encoded as in a form body (where a space becomes +). Registering or
 * removing a secret always covers all of them (finding M4).
 */
function variantsOf(secret: string): Set<string> {
  return new Set([
    secret,
    encodeURIComponent(secret),
    new URLSearchParams({ k: secret }).toString().slice(2),
  ]);
}

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
    let out = line;
    // Registered needles over the whole input, longest first so overlapping values
    // collapse cleanly.
    const needles = [...secrets].sort((a, b) => b.length - a.length);
    for (const needle of needles) {
      out = out.replace(new RegExp(escapeRegExp(needle), 'g'), REDACTED);
    }
    out = cutAtLimit(out, needles);
    // Structural patterns. Authorization first so its credential is replaced as a
    // unit (scheme kept, credential removed), then standalone JWTs and emails.
    out = out.replace(AUTHORIZATION_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`);
    out = out.replace(BASIC_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`);
    out = out.replace(FORM_KEY_PATTERN, (_match, key: string) => `${key}=${REDACTED}`);
    out = out.replace(
      JSON_KEY_PATTERN,
      (_match, open: string, _value: string, close: string) => `${open}${REDACTED}${close}`,
    );
    out = out.replace(JWT_PATTERN, REDACTED);
    out = out.replace(EMAIL_PATTERN, REDACTED);
    return out;
  }

  return {
    addSecret(secret) {
      if (secret !== undefined && secret.length > 0) {
        for (const form of variantsOf(secret)) {
          secrets.add(form);
        }
      }
    },
    removeSecret(secret) {
      if (secret !== undefined && secret.length > 0) {
        for (const form of variantsOf(secret)) {
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
