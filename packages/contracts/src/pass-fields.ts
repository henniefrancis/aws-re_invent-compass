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
//      nextConnection.venue, attendeeName) are letters, digits, spaces and basic
//      punctuation only. Any value that looks like a URL or domain, any control
//      character and any bidirectional override character is rejected.
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
 * Control characters: the C0 range U+0000 to U+001F and U+007F (DEL).
 */
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;

/**
 * Bidirectional override and directional formatting characters: the explicit
 * embedding and override controls U+202A to U+202E, the isolates U+2066 to
 * U+2069, and the implicit marks U+200E and U+200F.
 */
const BIDI_PATTERN = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/;

/**
 * URL-like or domain-like text. Matches an explicit scheme (http:// or
 * https://), a leading www., or a bare host.tld token (a label, a dot and a
 * two-or-more-letter top-level label). This is deliberately broad: ambiguous
 * input is refused, never reinterpreted.
 */
const URL_OR_DOMAIN_PATTERN =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}\b)/i;

/**
 * True when value is safe free text: no control character, no bidirectional
 * override, and nothing that looks like a URL or a domain. Does not echo the
 * offending value.
 */
function isSafeText(value: string): boolean {
  if (CONTROL_CHAR_PATTERN.test(value)) {
    return false;
  }
  if (BIDI_PATTERN.test(value)) {
    return false;
  }
  if (URL_OR_DOMAIN_PATTERN.test(value)) {
    return false;
  }
  return true;
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
      message: `${opts.fieldName} contains disallowed text (a URL, a domain, a control character or a bidirectional override)`,
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
      minutes: z.number().min(0).max(90),
      fromVenue: safeText(40, { minLen: 0, fieldName: 'fromVenue' }),
    })
    .optional();

  const nextConnection = z
    .object({
      sessionCode,
      startsAt: isoWithOffset('nextConnection.startsAt'),
      venue: safeText(40, { minLen: 0, fieldName: 'nextConnection.venue' }),
      walkMinutes: z.number().min(0).max(90),
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
