// Wire schemas for the Events API Session, SessionTime and SeatAvailability
// (foundation-contracts, S0). These mirror the official Events API OpenAPI document
// (packages/contracts/events-api.openapi.json) exactly.
//
// Cross-cutting rules applied here (see design, Data Models):
//   1. Defensive parsing by stripping. These use zod's default object behaviour,
//      which strips unknown fields. Fields the Events API adds over time are ignored
//      rather than carried into logs, and never break parsing. No passthrough, no
//      loose object, no strict (strict would reject unknown fields).
//   2. No coercion. A present field with the wrong type is rejected, not coerced.
//   3. Enum forward-compatibility. A known seatAvailability value parses to its
//      literal; an unknown string is preserved as the sentinel "unknown"; a wrong
//      type (number, boolean, object) is rejected before the mapping runs.
import { z } from 'zod';

// The five known seat availability bands from the Events API SeatAvailability enum.
const SEAT_AVAILABILITY_VALUES = [
  'available',
  'limited',
  'veryLimited',
  'unavailable',
  'walkUp',
] as const;

const KNOWN_SEAT_AVAILABILITY = new Set<string>(SEAT_AVAILABILITY_VALUES);

/**
 * The inferred output type for a parsed seatAvailability value: one of the five
 * known bands, or the sentinel "unknown" when the wire carries a string the client
 * does not recognise yet.
 */
export type SeatAvailability = (typeof SEAT_AVAILABILITY_VALUES)[number] | 'unknown';

/**
 * Forward-compatible seatAvailability schema.
 *
 * The input schema is z.string(), so a non-string input (number, boolean, object)
 * is rejected before the transform runs: there is no coercion. A known string maps
 * to its own literal; any other string maps to the sentinel "unknown", so a value
 * the Events API adds later never fails the whole response.
 */
export const SeatAvailabilitySchema = z
  .string()
  .transform((value): SeatAvailability =>
    KNOWN_SEAT_AVAILABILITY.has(value) ? (value as SeatAvailability) : 'unknown',
  );

/**
 * When and for how long a session runs. Every field is optional on the wire: the
 * Events API SessionTime has date, time, length and timezone all optional, and
 * sessionTime itself is optional on Session. Unknown fields are stripped.
 */
export const SessionTimeSchema = z.object({
  date: z.string().optional(),
  time: z.string().optional(),
  length: z.string().optional(),
  timezone: z.string().optional(),
});

export type SessionTime = z.infer<typeof SessionTimeSchema>;

// A speaker presenting a session. name is optional on the wire. Unknown fields on
// the speaker object are stripped.
const SpeakerSchema = z.object({
  name: z.string().optional(),
});

// A plain optional array of strings, used for the many taxonomy fields on Session.
const optionalStringArray = () => z.array(z.string()).optional();

/**
 * One catalog session, exactly as the Events API returns it. Only sessionId and
 * title are required; every other field is optional. The session code is the
 * abbreviation field, which carries the -R repeat suffix when present. Unknown
 * fields are stripped (zod's default object behaviour).
 */
export const SessionWireSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  abbreviation: z.string().optional(),
  abstract: z.string().optional(),
  type: z.string().optional(),
  level: z.string().optional(),
  venue: z.string().optional(),
  room: z.string().optional(),
  isAllDaySession: z.boolean().optional(),
  isReservable: z.boolean().optional(),
  seatAvailability: SeatAvailabilitySchema.optional(),
  sessionTime: SessionTimeSchema.optional(),
  speakers: z.array(SpeakerSchema).optional(),
  tracks: optionalStringArray(),
  topics: optionalStringArray(),
  industries: optionalStringArray(),
  areasOfInterest: optionalStringArray(),
  roles: optionalStringArray(),
  services: optionalStringArray(),
  segments: optionalStringArray(),
  features: optionalStringArray(),
  customerPersonas: optionalStringArray(),
  experiences: optionalStringArray(),
  additionalActivities: optionalStringArray(),
  focusAreas: optionalStringArray(),
});

export type SessionWire = z.infer<typeof SessionWireSchema>;
