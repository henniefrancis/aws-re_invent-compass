// Local redaction (task 1.2). Task 26 layers S1's redacting logger and S4 redact on
// top; this function is the floor that always applies, so a log line or error text can
// never carry a token, an email, an Authorization value or a URL.

const REDACTED = '[redacted]';

// Order matters: URLs first (a hand-off URL holds its capability in the fragment), then
// header values, JWTs, emails and long opaque strings such as refresh tokens.
const PATTERNS: readonly RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi,
  /\b(?:authorization|bearer|basic)\s*[:=]?\s*[^\s"',;]+(?:\s+[^\s"',;]+)?/gi,
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g,
  /[A-Za-z0-9_+/=-]{22,}/g,
];

/** Replaces token-shaped, email-shaped, header-shaped and URL-shaped values. */
export function redactText(text: string): string {
  let result = text;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}
