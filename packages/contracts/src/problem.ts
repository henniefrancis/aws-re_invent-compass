// Problem schema (foundation-contracts, S0): the application/problem+json body
// returned by the Compass API on error. Defined once here in contracts and
// mirrored from the single-source Compass API OpenAPI error component (build plan
// 5.2). Every stream shares this shape.
//
// Rules applied here (see design, Component 4, and build plan 5.2):
//   1. The body is exactly { type, title, status, code }, all four required.
//   2. type is a URI reference identifying the problem kind: a plain string here
//      (the contract documents the URI semantics; the schema only types the shape).
//   3. status is an integer HTTP status code: z.number().int(), no coercion.
//   4. Input is never echoed back in a Problem. This schema deliberately has no
//      field that carries request input (no "detail", "instance" or offending
//      value), so a malformed request can never be reflected to the caller. Using
//      plain z.object means any extra field a caller or server adds is stripped,
//      not carried through.
import { z } from 'zod';

/**
 * The application/problem+json error body. All four fields are required. type is a
 * URI reference naming the problem kind; title is a short human-readable summary;
 * status is the integer HTTP status code; code is the stable machine-readable
 * Compass error code. No field echoes request input, and unknown fields are
 * stripped.
 */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
});

export type Problem = z.infer<typeof ProblemSchema>;
