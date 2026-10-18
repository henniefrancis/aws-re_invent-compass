// The one redactor (release gate, CTO review M1).
//
// Every log line and every error message in the project passes through this module: the
// core API logger, the S4 pass errors and the MCP server logger all call it, so there is one
// set of rules, one bound and one test suite. It removes:
//   1. registered needles (exact secret values and their URL and form encodings),
//   2. URLs of any scheme (a hand-off URL holds its capability in the fragment),
//   3. Authorization, Bearer, ApplePass and Basic credentials,
//   4. form, query and JSON keys that carry a secret (the key stays, the value goes),
//   5. key=value and key: value pairs with a credential-like key (the key stays),
//   6. JWT shaped tokens, email addresses and long opaque tokens (22 or more base64 or
//      base64url characters, the shortest rendering of 128 bits).
//
// Time is bounded. Registered needles are removed from the whole input first (each is a plain
// literal search, linear in the input), and only then is the text cut to
// MAX_REDACT_INPUT_LENGTH, so a secret that sits across or beyond the cut is already gone. A
// trailing fragment that starts a registered needle, or a partial token left at the cut, is
// dropped as well. Every pattern has a bounded quantifier and a lookbehind (or a fixed
// anchor), so no pattern backtracks quadratically on a hostile 100 KB line.
//
// The placeholder is one fixed token so no length or content of a secret leaks.

/** The text written in place of every removed value. */
export const REDACTED = '[REDACTED]';

/** The longest text the structural patterns look at. Longer text is cut (see redact). */
export const MAX_REDACT_INPUT_LENGTH = 8192;

const TRUNCATED_MARK = '[TRUNCATED]';

// A URL of any scheme. The scheme is bounded and cannot start inside a longer word, so a long
// run of scheme characters is scanned once, not once per start position.
const URL_PATTERN = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s"'<>]{1,8192}/g;

// An Authorization header value, including the Bearer, ApplePass and Basic schemes and a
// bare token. The credential that follows on the same line is the captured value to remove;
// the header name and scheme word stay.
const AUTHORIZATION_PATTERN =
  /\b((?:proxy-)?authorization\s{0,16}[:=]\s{0,16}(?:bearer\s{1,16}|applepass\s{1,16}|basic\s{1,16})?|bearer\s{1,16}|applepass\s{1,16})([^\s"',;]{1,8192})/gi;

// A bare Basic credential (base64 of user:password). To avoid redacting ordinary words after
// "basic", the value must look like base64 data: it must contain a digit or one of + / =.
const BASIC_PATTERN =
  /\b(basic\s{1,16})(?=[A-Za-z0-9+/_-]{0,8192}[0-9+/=])([A-Za-z0-9+/_-]{8,8192}={0,2})/gi;

// Form and query keys that carry a secret. The key is kept, the value removed.
const FORM_KEY_PATTERN =
  /\b(refresh_token|code_verifier|access_token|id_token|code)=([^&\s"',]{1,8192})/gi;

// The same keys in a JSON body: "refresh_token":"...". The key is kept, the value removed.
const JSON_KEY_PATTERN =
  /("(?:refresh_token|code_verifier|access_token|id_token)"\s{0,16}:\s{0,16}")([^"]{0,8192})(")/gi;

// A credential-like key followed by = or : and a value, as in password: hunter2 or
// api_key=abc. The key and the separator stay, the value goes.
const KEY_VALUE_PATTERN =
  /\b((?:access_token|id_token|refresh_token|token|secret|password|passwd|api[_-]?key|key|signature|sig|credential)s?\s{0,16}[=:]\s{0,16})([^\s"',;&]{1,8192})/gi;

// A JWT compact serialization: three (or, for an encrypted token, up to six) base64url
// segments separated by dots. The segments must be reasonably long so ordinary dotted
// identifiers (a.b.c) are not mistaken for a token.
const JWT_PATTERN =
  /(?<![A-Za-z0-9_.-])[A-Za-z0-9_-]{8,8192}(?:\.[A-Za-z0-9_-]{8,8192}){2,5}(?![A-Za-z0-9_-])/g;

// An email address, removed whole so neither the local part nor the domain survives.
const EMAIL_PATTERN =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,8192}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,63}/g;

// A long opaque token: a run of 22 or more base64 or base64url characters, with optional
// padding. This catches a bare hand-off id, capability or refresh token outside a URL.
const OPAQUE_PATTERN = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{22,8192}={0,2}/g;

/** Escapes a string for use inside a RegExp source. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every form a secret can take in a line: as given, percent-encoded as in a URL query, and
 * encoded as in a form body (where a space becomes +). Registering or removing a secret
 * always covers all of them.
 */
export function secretVariants(secret: string): string[] {
  return [
    ...new Set([
      secret,
      encodeURIComponent(secret),
      new URLSearchParams({ k: secret }).toString().slice(2),
    ]),
  ];
}

/**
 * Cuts the text to MAX_REDACT_INPUT_LENGTH and marks it. A trailing fragment that begins a
 * registered needle is dropped, and so is a partial token at the cut (back to the last
 * whitespace), so no prefix of a secret is left at the end.
 */
function cutAtLimit(text: string, needles: readonly string[]): string {
  if (text.length <= MAX_REDACT_INPUT_LENGTH) {
    return text;
  }
  let kept = text.slice(0, MAX_REDACT_INPUT_LENGTH);
  let drop = 0;
  for (const needle of needles) {
    for (let length = Math.min(needle.length - 1, kept.length); length > drop; length -= 1) {
      if (kept.endsWith(needle.slice(0, length))) {
        drop = length;
        break;
      }
    }
  }
  kept = kept.slice(0, kept.length - drop);
  let end = kept.length;
  while (end > 0 && !/\s/.test(kept.charAt(end - 1))) {
    end -= 1;
  }
  return `${end > 0 ? kept.slice(0, end) : kept}${TRUNCATED_MARK}`;
}

/**
 * Returns text that is safe to log or to put in an error message. `needles` are exact secret
 * values (the caller's registered secrets); they are removed first, longest first, from the
 * whole input. The result never contains a needle, a URL, a credential, a JWT, an email
 * address or a long opaque token. Redacting twice gives the same result as once.
 */
export function redact(text: string, needles: readonly string[] = []): string {
  let out = text;
  const ordered = [...needles].filter((n) => n.length > 0).sort((a, b) => b.length - a.length);
  for (const needle of ordered) {
    out = out.replace(new RegExp(escapeRegExp(needle), 'g'), REDACTED);
  }
  out = cutAtLimit(out, ordered);
  return out
    .replace(URL_PATTERN, REDACTED)
    .replace(AUTHORIZATION_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(BASIC_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(FORM_KEY_PATTERN, (_m, key: string) => `${key}=${REDACTED}`)
    .replace(
      JSON_KEY_PATTERN,
      (_m, open: string, _value: string, close: string) => `${open}${REDACTED}${close}`,
    )
    .replace(KEY_VALUE_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(OPAQUE_PATTERN, REDACTED);
}
