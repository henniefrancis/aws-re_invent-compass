// SP2 ID token redaction logic (foundation-contracts, S0).
//
// The SP2 spike verifies a Builder ID ID token with aws-jwt-verify. When it
// reports what it saw, it must never leak a claim VALUE, with a small allowlist of
// non-identifying metadata fields whose values are safe to show:
//   alg, kid, iss, aud, token_use, exp.
// Everything else (sub, email, name, cognito:username, custom claims, and so on)
// is reported by NAME only, never by value. This module holds the pure redaction
// logic so it can be unit tested without a live token (Requirement 9.7).
//
// No value other than the six allowlisted fields ever appears in the output.
// This file contains no em dash or en dash.

// The only token fields whose values are safe to display. They identify the key
// and the token kind, not the person. aud is the public shared client id, iss is
// the public issuer URL, and exp is a timestamp.
export const SAFE_VALUE_FIELDS = ['alg', 'kid', 'iss', 'aud', 'token_use', 'exp'] as const;

export type SafeValueField = (typeof SAFE_VALUE_FIELDS)[number];

const SAFE_SET = new Set<string>(SAFE_VALUE_FIELDS);

/**
 * A redacted view of a decoded JWT. safeValues carries only the allowlisted
 * fields (from the header and payload together); claimNames lists the names of
 * every OTHER claim present, so a reader can see the token shape without any
 * identifying value.
 */
export interface RedactedToken {
  safeValues: Record<string, string>;
  claimNames: string[];
}

/**
 * True when a field name is on the safe-value allowlist.
 */
export function isSafeValueField(name: string): name is SafeValueField {
  return SAFE_SET.has(name);
}

/**
 * Coerce an allowlisted value to a display string without revealing anything
 * beyond the field itself. Numbers (for example exp) become their decimal string;
 * strings pass through; anything else becomes its JSON type name so no structured
 * value is printed.
 */
function displaySafeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  // A non-string, non-number allowlisted field is unexpected; show only its type.
  return `<${value === null ? 'null' : typeof value}>`;
}

/**
 * Redact a decoded token's header and payload into a safe view.
 *
 * @param header the decoded JWT header object (may be empty)
 * @param payload the decoded JWT payload object (may be empty)
 * @returns the safe values and the names of all other claims
 */
export function redactDecodedToken(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): RedactedToken {
  // A null-prototype object so inherited names like "constructor" or "toString"
  // can never resolve to an inherited value when a claim happens to use that name.
  const safeValues: Record<string, string> = Object.create(null) as Record<string, string>;
  const claimNames: string[] = [];

  // The header contributes alg and kid (both safe). Any other header field is
  // reported by name only.
  for (const name of Object.keys(header).sort()) {
    if (isSafeValueField(name)) {
      safeValues[name] = displaySafeValue(header[name]);
    } else {
      claimNames.push(name);
    }
  }

  // The payload contributes iss, aud, token_use and exp (safe). Every other claim
  // (sub, email, and so on) is reported by name only, never by value.
  for (const name of Object.keys(payload).sort()) {
    if (isSafeValueField(name)) {
      safeValues[name] = displaySafeValue(payload[name]);
    } else {
      claimNames.push(name);
    }
  }

  // Sort and de-duplicate claim names for a stable report.
  const uniqueNames = Array.from(new Set(claimNames)).sort();
  return { safeValues, claimNames: uniqueNames };
}

/**
 * Decode a JWT into its header and payload objects without verifying the
 * signature. Used only to build the redacted view; verification is done
 * separately by aws-jwt-verify in the wrapper. Returns empty objects for a
 * malformed token rather than throwing, so the redactor never crashes on bad
 * input. No value is logged here.
 *
 * @param jwt a compact JWS string (three base64url parts)
 * @returns the decoded header and payload (empty objects if undecodable)
 */
export function decodeJwtParts(jwt: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  // Split into at most three parts: header, payload and the rest (the signature,
  // which is not decoded). Limiting the split to 3 means a malformed token with
  // extra dots still yields a defined third element, and a token with too few
  // parts yields an undefined payload, which the guard below rejects.
  const dot1 = jwt.indexOf('.');
  if (dot1 < 0) {
    return { header: {}, payload: {} };
  }
  const dot2 = jwt.indexOf('.', dot1 + 1);
  if (dot2 < 0) {
    return { header: {}, payload: {} };
  }
  const dot3 = jwt.indexOf('.', dot2 + 1);
  // A valid compact JWS has exactly two dots. A third dot means too many parts.
  if (dot3 >= 0) {
    return { header: {}, payload: {} };
  }
  const headerPart = jwt.slice(0, dot1);
  const payloadPart = jwt.slice(dot1 + 1, dot2);

  const decodePart = (part: string): Record<string, unknown> => {
    try {
      const json = Buffer.from(part, 'base64url').toString('utf8');
      const parsed: unknown = JSON.parse(json);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  };
  return { header: decodePart(headerPart), payload: decodePart(payloadPart) };
}

/**
 * Render a redacted token as human-readable lines for the spike's stdout. Only the
 * safe values and the claim NAMES appear. No other value is ever printed.
 *
 * @param redacted the redacted view
 * @returns the report lines
 */
export function formatRedactedReport(redacted: RedactedToken): string[] {
  const lines: string[] = [];
  lines.push('Safe metadata (values shown):');
  for (const name of SAFE_VALUE_FIELDS) {
    if (name in redacted.safeValues) {
      lines.push(`  ${name}: ${redacted.safeValues[name]}`);
    }
  }
  lines.push('Other claims (names only, values hidden):');
  if (redacted.claimNames.length === 0) {
    lines.push('  (none)');
  } else {
    for (const name of redacted.claimNames) {
      lines.push(`  ${name}: <hidden>`);
    }
  }
  return lines;
}
