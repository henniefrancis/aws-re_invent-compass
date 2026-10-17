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
  /** The day an official page was read, YYYY-MM-DD. Required when kind is "official". */
  retrievedOn?: string;
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
  /** Spelling variants of the venue name, each with its own source note. */
  aliases?: VenueAlias[];
}

/** A spelling variant of a venue name, such as "Venetian" for "The Venetian". */
export interface VenueAlias {
  name: string;
  source: SourceNote;
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

/** The accepted range for each tuning value. Values outside it make a Context invalid. */
export const CONTEXT_LIMITS = {
  /** Minutes added to a raw walk. */
  bufferMinutes: { min: 0, max: 120 },
  /** Spare minutes below which a connection is tight. */
  tightMarginMinutes: { min: 0, max: 60 },
  /** Longest unbroken stretch, in minutes. */
  maxStretchMinutes: { min: 1, max: 1440 },
  /** Free minutes the meal window needs. */
  requiredFreeMinutes: { min: 0, max: 1440 },
} as const;

const minutesOf = (clock: string): number =>
  Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

const MealWindowSchema = z
  .object({
    start: z.string().regex(CLOCK_PATTERN),
    end: z.string().regex(CLOCK_PATTERN),
    requiredFreeMinutes: z
      .number()
      .finite()
      .min(CONTEXT_LIMITS.requiredFreeMinutes.min)
      .max(CONTEXT_LIMITS.requiredFreeMinutes.max),
  })
  .refine((window) => minutesOf(window.end) > minutesOf(window.start), {
    path: ['end'],
    message: 'the meal window must end after it starts',
  });

/** Zod schema for a complete Context. now is required; eventTimezone is optional. */
export const ContextSchema: z.ZodType<Context> = z.object({
  now: z.string(),
  eventTimezone: z.string().optional(),
  venueData: VenueDataSchema,
  mealWindow: MealWindowSchema,
  maxStretchMinutes: z
    .number()
    .finite()
    .min(CONTEXT_LIMITS.maxStretchMinutes.min)
    .max(CONTEXT_LIMITS.maxStretchMinutes.max),
  overloadThreshold: z.number().finite().gt(0),
  overloadCountThreshold: z.number().finite().gt(0),
  tightMarginMinutes: z
    .number()
    .finite()
    .min(CONTEXT_LIMITS.tightMarginMinutes.min)
    .max(CONTEXT_LIMITS.tightMarginMinutes.max),
  bufferMinutes: z
    .number()
    .finite()
    .min(CONTEXT_LIMITS.bufferMinutes.min)
    .max(CONTEXT_LIMITS.bufferMinutes.max),
});

/**
 * Fill every tuning value the caller left out with its documented default. now and
 * venueData come from the caller. eventTimezone is passed through untouched (it may be
 * absent, and the engine then answers "unknown").
 *
 * A value that is present but undefined counts as left out, so an undefined never replaces
 * a default (and never turns into NaN later). Values that are present are kept exactly as
 * given, even when invalid: ContextSchema is what rejects them.
 */
export function withContextDefaults(input: ContextInput): Context {
  const merged: Record<string, unknown> = { ...CONTEXT_DEFAULTS };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as unknown as Context;
}
