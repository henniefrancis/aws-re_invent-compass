// Wire schemas for the Events API Schedule and the list and get response wrappers
// (foundation-contracts, S0). These mirror the official Events API OpenAPI document
// (packages/contracts/events-api.openapi.json) exactly.
//
// Cross-cutting rules applied here (see design, Data Models):
//   1. Defensive parsing by stripping. Plain z.object strips unknown fields, so
//      fields the Events API adds over time are ignored rather than carried into
//      logs, and never break parsing.
//   2. No coercion. A present field with the wrong type is rejected, not coerced.
//   3. Cross-file reuse. The session and personal time wire schemas are imported and
//      reused rather than redeclared, so there is one definition of each shape.
import { z } from 'zod';
import { SessionWireSchema } from './session.js';
import { PersonalTimeSchema } from './personal-time.js';

/**
 * One attendee's schedule for an event. All three lists are required and present,
 * empty rather than absent when they have no entries. reserved and favorites carry
 * session id strings; personalTime carries full PersonalTime entries. Unknown fields
 * are stripped.
 */
export const ScheduleWireSchema = z.object({
  reserved: z.array(z.string()),
  favorites: z.array(z.string()),
  personalTime: z.array(PersonalTimeSchema),
});

export type ScheduleWire = z.infer<typeof ScheduleWireSchema>;

/**
 * The ListSessions response envelope. items is this page of sessions (empty when the
 * event has none); totalCount is the size of the catalog; nextToken is present only
 * when there is a following page. Unknown fields are stripped.
 */
export const ListSessionsSchema = z.object({
  items: z.array(SessionWireSchema),
  totalCount: z.number(),
  nextToken: z.string().optional(),
});

export type ListSessions = z.infer<typeof ListSessionsSchema>;

/**
 * The GetSession response envelope: a single session under session. Unknown fields
 * are stripped.
 */
export const GetSessionSchema = z.object({
  session: SessionWireSchema,
});

export type GetSession = z.infer<typeof GetSessionSchema>;

/**
 * The GetSchedule response envelope: the attendee's schedule under schedule. Unknown
 * fields are stripped.
 */
export const GetScheduleSchema = z.object({
  schedule: ScheduleWireSchema,
});

export type GetSchedule = z.infer<typeof GetScheduleSchema>;
