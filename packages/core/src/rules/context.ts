// Rules engine Context (itinerary-rules, S2).
//
// Context is the runtime input every rule receives. It carries the current instant,
// the event timezone, the venue data and the tuning values. The engine never reads a
// clock, a file or the environment: callers source Context from GetEvent and from
// data/venues.json and pass it in. Every tuning value has one documented default,
// filled by withContextDefaults. now has no default: the caller always supplies it.
//
// The four shared domain types (Verdict, Venue, NormalisedSession, Commitment) live in
// @compass/contracts and are only imported here, never redefined.
import { z } from 'zod';
import type { Venue } from '@compass/contracts';
import { VenueDataSchema } from './venue-data.js';

/** The daily window in which the attendee should have some free minutes to eat. */
export interface MealWindow {
  /** Local wall-clock start, HH:mm. Default "11:30". */
  start: string;
  /** Local wall-clock end, HH:mm. Default "14:00". */
  end: string;
  /** Free minutes needed inside the window. Default 30. */
  requiredFreeMinutes: number;
}

/** Where a venue data value came from: an official AWS page, or an estimate. */
export interface SourceNote {
  kind: 'official' | 'estimate';
  /** Present and required when kind is "official". */
  url?: string;
  /** Optional plain-English basis for an estimate, so the estimate is traceable. */
  basis?: string;
}

/** Walking minutes between one ordered pair of distinct venues. */
export interface WalkingEdge {
  from: string;
  to: string;
  /** Whole minutes, 0 to 240. */
  minutes: number;
  source: SourceNote;
}

/** A venue plus the source notes for its coordinates and for its name. */
export interface VenueEntry {
  venue: Venue;
  /** Required when the venue has coordinates. */
  coordinatesSource?: SourceNote;
  /** Where the venue name was found, for example an official AWS re:Invent page. */
  nameSource?: SourceNote;
}

/** The wrapper object held by data/venues.json. */
export interface VenueData {
  venues: VenueEntry[];
  walkingTimes: WalkingEdge[];
}

/** The runtime input passed to every rule. */
export interface Context {
  /** The current instant, ISO 8601 with offset. Required, no default. */
  now: string;
  /** IANA timezone name, for example "America/Los_Angeles". Optional on purpose. */
  eventTimezone?: string;
  venueData: VenueData;
  mealWindow: MealWindow;
  maxStretchMinutes: number;
  overloadThreshold: number;
  /** Count-only fallback threshold used when the full energy formula is not in use. */
  overloadCountThreshold: number;
  tightMarginMinutes: number;
  bufferMinutes: number;
}

/** What a caller must supply: everything except the tuning values is optional. */
export type ContextInput = Pick<Context, 'now' | 'venueData'> &
  Partial<Omit<Context, 'now' | 'venueData'>>;

/** The documented defaults for every tuning value (everything except now). */
export const CONTEXT_DEFAULTS = {
  mealWindow: { start: '11:30', end: '14:00', requiredFreeMinutes: 30 },
  maxStretchMinutes: 180,
  overloadThreshold: 100,
  overloadCountThreshold: 6,
  tightMarginMinutes: 5,
  bufferMinutes: 10,
} as const;

const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const MealWindowSchema = z.object({
  start: z.string().regex(CLOCK_PATTERN),
  end: z.string().regex(CLOCK_PATTERN),
  requiredFreeMinutes: z.number().min(0),
});

/** Zod schema for a complete Context. now is required; eventTimezone is optional. */
export const ContextSchema: z.ZodType<Context> = z.object({
  now: z.string(),
  eventTimezone: z.string().optional(),
  venueData: VenueDataSchema,
  mealWindow: MealWindowSchema,
  maxStretchMinutes: z.number().min(0),
  overloadThreshold: z.number(),
  overloadCountThreshold: z.number(),
  tightMarginMinutes: z.number().min(0),
  bufferMinutes: z.number().min(0),
});

/**
 * Fill every tuning value the caller left out with its documented default. now and
 * venueData come from the caller. eventTimezone is passed through untouched (it may be
 * absent, and the engine then answers "unknown").
 */
export function withContextDefaults(input: ContextInput): Context {
  return { ...CONTEXT_DEFAULTS, ...input };
}
