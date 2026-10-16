// PassFields factory (foundation-contracts, S0): the single source for pass
// content, applying build plan section 5.3. It lives directly under src/, not
// under src/domain/ (build plan 5.3). It is a factory, not a fixed schema:
// createPassFieldsSchema({ start, end, timezone }) returns a zod schema, where
// the event window (start, end, timezone) comes from GetEvent at runtime. No
// dates are hard-coded in the contract or the schema; the startsAt and endsAt
// "inside the event window" rule is enforced against the window passed into the
// factory.
//
// Rules applied here (see design, Data Models, PassFields, and build plan 5.3):
//   1. sessionCode matches ^[A-Z0-9]{2,12}(-R[0-9]?)?$ (inherently safe, so the
//      text-safety checks below are not applied to it).
//   2. title is 1 to 80 characters; venue and room are 0 to 40 characters each
//      (empty venue means "Venue not published"); attendeeName, when present, is
//      1 to 40 characters.
//   3. startsAt and endsAt are ISO 8601 with offset. endsAt is after startsAt,
//      both are inside the event window [start, end] passed to the factory, and
//      endsAt is at most 10 hours after startsAt. These cross-field rules are
//      enforced with superRefine over parsed Date values. No coercion is used.
//   4. All free-text fields (title, venue, room, walkFromPrevious.fromVenue,
//      nextConnection.venue, attendeeName) must pass a character ALLOWLIST:
//      every character is a Unicode letter, combining mark or digit, a space, or
//      one of a small set of basic punctuation marks. Anything else (zero-width
//      characters, C0 and C1 controls, line and paragraph separators,
//      bidirectional override and formatting characters, emoji and other symbols)
//      is rejected because it is not in the allowed set. In addition, any value
//      that looks like a URL (contains "://"), a www host, or a bare domain token
//      is rejected, with a short allowlist of technology tokens (for example
//      Node.js, ASP.NET) that contain a dot but are not domains.
//   5. Server-derived fields (boardingClosesAt, disclaimer, expirationDate,
//      relevantDates, transitType, sharingProhibited, and there are no barcodes)
//      are NOT accepted from the client. They are set server-side by S5 and are
//      intentionally absent from this schema. Because the schema uses plain
//      z.object, a client that sends a server-derived field has it stripped
//      rather than honored.
import { z } from 'zod';

/**
 * sessionCode pattern. Uppercase letters and digits, 2 to 12 long, with an
 * optional repeat marker (-R or -R<digit>). sessionCode is inherently safe, so
 * the free-text safety checks are not applied to it.
 */
const SESSION_CODE_PATTERN = /^[A-Z0-9]{2,12}(-R[0-9]?)?$/;

/**
 * ISO 8601 date-time that requires an explicit timezone offset (Z or +/-HH:MM).
 * A matching string is additionally parsed with Date.parse to confirm it is a
 * real instant (NaN is rejected). No coercion is performed.
 */
const ISO_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The character ALLOWLIST for free text. A value passes only when every
 * character is one of:
 *   - a Unicode letter (\p{L}), combining mark (\p{M}) or digit (\p{N}), with
 *     the 'u' flag so astral and accented letters and combining marks count;
 *   - a plain ASCII space (U+0020);
 *   - one of the basic punctuation marks . , : ; ' " ! ? ( ) & / + # @ -
 *     (the hyphen is escaped at the end of the class).
 * Because the set is an allowlist, every disallowed character is rejected
 * without being enumerated: zero-width characters (U+200B to U+200D, U+2060,
 * U+FEFF), C0 controls and DEL (U+0000 to U+001F, U+007F), C1 controls
 * (U+0080 to U+009F), the line and paragraph separators (U+2028, U+2029) and
 * all bidirectional override and formatting characters (U+202A to U+202E,
 * U+2066 to U+2069, U+200E, U+200F) all fall outside it. The empty string
 * passes the character allowlist (length rules are enforced separately).
 */
const ALLOWED_TEXT = /^[\p{L}\p{M}\p{N} .,:;'"!?()&/+#@\-]*$/u;

/**
 * Technology tokens that contain a dot but are not domains. They are neutralised
 * before the bare-domain check so a title like "Node.js on AWS" is not mistaken
 * for a host. Matched case-insensitively and only as whole tokens (see
 * TECH_TOKEN_PATTERN), so "mynode.js" or "node.jsx" is not treated as the token.
 */
const ALLOWED_TECH_TOKENS = [
  'Node.js',
  'Vue.js',
  'Next.js',
  'Nuxt.js',
  'Express.js',
  'Three.js',
  'D3.js',
  'ASP.NET',
  'ADO.NET',
  'VB.NET',
] as const;

/**
 * Escape a literal string for use inside a regular expression.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A single case-insensitive, global pattern matching any allowed tech token as a
 * whole token. The lookbehind and lookahead forbid an adjacent word character or
 * dot, so only standalone occurrences match (not substrings like "mynode.js").
 */
const TECH_TOKEN_PATTERN = new RegExp(
  `(?<![\\w.])(?:${ALLOWED_TECH_TOKENS.map(escapeRegExp).join('|')})(?![\\w.])`,
  'gi',
);

/**
 * A bare domain token: one or more dot-separated labels ending in a two-or-more
 * letter alphabetic top-level label, treated as a whole token with boundaries so
 * for example "example.com", "evil.co.za" and "foo.bar.io" match. Case-insensitive.
 */
const BARE_DOMAIN_PATTERN = /(?<![\w.])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?![\w.])/i;

/**
 * True when value is safe free text. The checks run in order: (a) every character
 * is in the allowlist; (b) the allowed tech tokens are neutralised in a working
 * copy; (c) the working copy contains no "://" scheme; (d) it contains no "www."
 * host; (e) it contains no bare domain token. Does not echo the offending value.
 */
function isSafeText(value: string): boolean {
  if (!ALLOWED_TEXT.test(value)) {
    return false;
  }
  // Neutralise allowed tech tokens so they cannot trip the bare-domain rule. The
  // "://" and "www." checks are independent (a tech token never contains either),
  // so they are applied to the neutralised copy as well with no loss.
  const neutralised = value.replace(TECH_TOKEN_PATTERN, ' ');
  if (neutralised.includes('://')) {
    return false;
  }
  if (/www\./i.test(neutralised)) {
    return false;
  }
  if (BARE_DOMAIN_PATTERN.test(neutralised)) {
    return false;
  }
  return true;
}

/**
 * Normalise raw free text before PassFields validation. This is a pre-pass used
 * by the S4 pass builder: it maps typographic punctuation to ASCII and collapses
 * whitespace so a human-friendly title (with curly quotes, a long dash or an
 * ellipsis) can pass the allowlist. It does NOT validate; a value that still
 * fails after normalisation is handled by the caller (S4 falls back to a generic
 * title). Typographic characters are referenced by escape sequence so this source
 * file contains no raw em or en dash.
 */
export function normalisePassText(value: string): string {
  return (
    value
      // En dash (U+2013) and em dash (U+2014) both become an ASCII hyphen.
      .replace(/[\u2013\u2014]/g, '-')
      // Curly single quotes (U+2018, U+2019) and the prime (U+2032) become a
      // straight apostrophe.
      .replace(/[\u2018\u2019\u2032]/g, "'")
      // Curly double quotes (U+201C, U+201D) and the double prime (U+2033) become
      // a straight double quote.
      .replace(/[\u201C\u201D\u2033]/g, '"')
      // The horizontal ellipsis (U+2026) becomes three ASCII dots.
      .replace(/\u2026/g, '...')
      // Any run of whitespace, including the non-breaking space (U+00A0) and other
      // Unicode spaces, collapses to a single ASCII space.
      .replace(/[\s\u00A0]+/g, ' ')
      // Trim leading and trailing whitespace.
      .trim()
  );
}

/**
 * A free-text zod string of a given length range that also applies the text
 * safety checks. The message references the field by name and never echoes the
 * offending value.
 */
function safeText(
  maxLen: number,
  opts: { minLen: number; fieldName: string },
): z.ZodString {
  return z
    .string()
    .min(opts.minLen)
    .max(maxLen)
    .refine(isSafeText, {
      message: `${opts.fieldName} contains disallowed text (a disallowed character, a URL or a domain)`,
    });
}

/**
 * An ISO 8601 with offset string that is also confirmed to be a real instant.
 * The field name is used only to build a clear message; no value is echoed.
 */
function isoWithOffset(fieldName: string): z.ZodString {
  return z
    .string()
    .regex(ISO_OFFSET_PATTERN, {
      message: `${fieldName} must be ISO 8601 with a timezone offset`,
    })
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: `${fieldName} must be a real timestamp`,
    });
}

/**
 * The options for the factory. start and end are the event window as ISO 8601
 * strings (from GetEvent), and timezone is the event timezone, carried for
 * completeness (it is used by the pass rendering). The window bounds are
 * instants, so "inside the event window" is an instant comparison; timezone does
 * not further constrain startsAt or endsAt beyond the offset-required format.
 */
export interface CreatePassFieldsSchemaOptions {
  start: string;
  end: string;
  timezone: string;
}

/**
 * At most ten hours, in milliseconds, between startsAt and endsAt.
 */
const MAX_SESSION_MS = 10 * 60 * 60 * 1000;

/**
 * Build the PassFields schema for a given event window. The returned schema
 * validates the client-supplied pass content and enforces the cross-field time
 * rules against the window passed in here. Unknown fields are stripped.
 */
export function createPassFieldsSchema(opts: CreatePassFieldsSchemaOptions) {
  const windowStartMs = Date.parse(opts.start);
  const windowEndMs = Date.parse(opts.end);

  const sessionCode = z.string().regex(SESSION_CODE_PATTERN, {
    message: 'sessionCode must match the session code pattern',
  });

  const walkFromPrevious = z
    .object({
      minutes: z.number().int().min(0).max(90),
      fromVenue: safeText(40, { minLen: 0, fieldName: 'fromVenue' }),
    })
    .optional();

  const nextConnection = z
    .object({
      sessionCode,
      startsAt: isoWithOffset('nextConnection.startsAt'),
      venue: safeText(40, { minLen: 0, fieldName: 'nextConnection.venue' }),
      walkMinutes: z.number().int().min(0).max(90),
    })
    .optional();

  return z
    .object({
      sessionCode,
      title: safeText(80, { minLen: 1, fieldName: 'title' }),
      venue: safeText(40, { minLen: 0, fieldName: 'venue' }),
      room: safeText(40, { minLen: 0, fieldName: 'room' }),
      startsAt: isoWithOffset('startsAt'),
      endsAt: isoWithOffset('endsAt'),
      walkFromPrevious,
      nextConnection,
      attendeeName: safeText(40, {
        minLen: 1,
        fieldName: 'attendeeName',
      }).optional(),
    })
    .superRefine((value, ctx) => {
      // The field-level isoWithOffset refinement on startsAt and endsAt rejects any
      // value that is not a real ISO 8601 instant, so when a field is well-formed its
      // Date.parse is a real number here. If a field was malformed, its own refinement
      // already failed the parse; Date.parse then yields NaN, and every comparison below
      // is false, so no spurious cross-field issue is added. No extra NaN guard is needed.
      const startMs = Date.parse(value.startsAt);
      const endMs = Date.parse(value.endsAt);

      if (endMs <= startMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsAt'],
          message: 'endsAt must be after startsAt',
        });
      }

      if (endMs - startMs > MAX_SESSION_MS) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsAt'],
          message: 'endsAt must be at most 10 hours after startsAt',
        });
      }

      if (startMs < windowStartMs || startMs > windowEndMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['startsAt'],
          message: 'startsAt must be inside the event window',
        });
      }

      if (endMs < windowStartMs || endMs > windowEndMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsAt'],
          message: 'endsAt must be inside the event window',
        });
      }
    });
}

/**
 * The inferred PassFields type, taken from a representative schema instance. The
 * field shape does not depend on the window, so any instance yields the same
 * type.
 */
export type PassFields = z.infer<ReturnType<typeof createPassFieldsSchema>>;
