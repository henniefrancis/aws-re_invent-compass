// Domain schema for the normalised, internal view of a session
// (foundation-contracts, S0). Produced by S1's normaliser and shared by every
// stream, so it is defined here in contracts.
//
// Rules applied here (see design, Data Models, NormalisedSession):
//   1. type and level are optional. When the wire omits a value the normaliser
//      leaves the field absent and lists its name in missingFields. It never
//      substitutes a default.
//   2. startsAt and endsAt are ISO 8601 with offset, computed from the wire
//      sessionTime by the normaliser, and absent when the wire has no usable time.
//   3. seatAvailability reuses the same forward-compatible enum as the wire.
//   4. These are internal domain fields, so no regex constraints: plain string,
//      boolean and array fields. Unknown fields are stripped (plain z.object).
import { z } from 'zod';
import { SeatAvailabilitySchema } from '../wire/session.js';

/**
 * The normalised, internal view of a session. The normaliser computes startsAt
 * and endsAt from the wire sessionTime, reuses the wire abbreviation as the code,
 * and records every absent wire field in missingFields so downstream code can be
 * honest about uncertainty. Unknown fields are stripped.
 */
export const NormalisedSessionSchema = z.object({
  sessionId: z.string(),
  code: z.string(),
  title: z.string(),
  type: z.string().optional(),
  level: z.string().optional(),
  venue: z.string().optional(),
  room: z.string().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  isAllDay: z.boolean(),
  isReservable: z.boolean(),
  seatAvailability: SeatAvailabilitySchema,
  repeatOf: z.string().optional(),
  missingFields: z.array(z.string()),
});

export type NormalisedSession = z.infer<typeof NormalisedSessionSchema>;
