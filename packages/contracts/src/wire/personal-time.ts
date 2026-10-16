// Wire schemas for the Events API PersonalTime and PersonalTimeInput
// (foundation-contracts, S0). These mirror the official Events API OpenAPI document
// (packages/contracts/events-api.openapi.json) exactly.
//
// Cross-cutting rules applied here (see design, Data Models):
//   1. Defensive parsing by stripping. Plain z.object strips unknown fields, so
//      fields the Events API adds over time are ignored rather than carried into
//      logs, and never break parsing.
//   2. No coercion. A present field with the wrong type is rejected, not coerced.
//   3. These wire schemas mirror the shape, not the server validation: the date-time
//      strings are plain z.string() with no regex or pattern constraints.
import { z } from 'zod';

/**
 * A personal time entry on the caller's schedule: a block of the caller's own time,
 * not a session. personalTimeId identifies the entry for update and removal; it is
 * present on every entry the server returns. All fields are plain strings and every
 * field except location is required. Unknown fields are stripped.
 */
export const PersonalTimeSchema = z.object({
  personalTimeId: z.string(),
  startDateTime: z.string(),
  endDateTime: z.string(),
  title: z.string(),
  description: z.string(),
  location: z.string().optional(),
});

export type PersonalTime = z.infer<typeof PersonalTimeSchema>;

/**
 * The values of a personal time entry on create or update, identical to PersonalTime
 * but without personalTimeId: the server assigns the id. startDateTime, endDateTime,
 * title and description are required; location is optional. Unknown fields are
 * stripped.
 */
export const PersonalTimeInputSchema = z.object({
  startDateTime: z.string(),
  endDateTime: z.string(),
  title: z.string(),
  description: z.string(),
  location: z.string().optional(),
});

export type PersonalTimeInput = z.infer<typeof PersonalTimeInputSchema>;
