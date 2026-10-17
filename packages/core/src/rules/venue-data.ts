// Venue data schema and walking-time lookup (itinerary-rules, S2). Internal.
//
// data/venues.json is a wrapper object (never a bare Venue array) with a venues list
// and a walking-time matrix. Every walking time and every coordinate carries a source
// note: "official" with a URL on an official AWS re:Invent host, or "estimate". The
// engine never reads the file at runtime. Callers parse it with VenueDataSchema and
// pass the result in through Context.venueData.
//
// Each venue entry reuses VenueSchema from @compass/contracts (Req 9.6).
import { z } from 'zod';
import { VenueSchema } from '@compass/contracts';
import type { SourceNote, VenueData } from './context.js';
import { isCalendarDate } from './time.js';

/**
 * The only places an "official" source note may point at: an exact host and the path prefixes
 * on it. A path matches a prefix when it equals it or continues it after a slash. A prefix of
 * "/" allows every path on that host.
 */
export const OFFICIAL_SOURCES: Readonly<Record<string, readonly string[]>> = {
  'aws.amazon.com': ['/events/reinvent', '/resources/analyst-summit'],
  'reinvent.awsevents.com': ['/'],
};

/** The hosts an official source note may name. */
export const OFFICIAL_HOSTS: readonly string[] = Object.keys(OFFICIAL_SOURCES);

// https, then a bare host (no user info, no port, no percent sign), then an optional path. A
// query, a fragment and percent encoding are all refused.
const HTTPS_URL_PATTERN = /^https:\/\/([^/?#:@\s%]+)(\/[^?#\s%]*)?$/i;

function isOfficialUrl(value: string): boolean {
  const match = HTTPS_URL_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const host = (match[1] as string).toLowerCase();
  const prefixes = Object.hasOwn(OFFICIAL_SOURCES, host)
    ? (OFFICIAL_SOURCES[host] as readonly string[])
    : [];
  const path = match[2] ?? '/';
  // A path segment of . or .. could point somewhere else, so it is refused.
  const climbs = path.split('/').some((segment) => segment === '.' || segment === '..');
  return (
    !climbs &&
    prefixes.some((prefix) => prefix === '/' || path === prefix || path.startsWith(`${prefix}/`))
  );
}

/** The longest text and the most items the venue data accepts, so a huge file cannot be loaded. */
export const VENUE_LIMITS = {
  name: 100,
  url: 300,
  basis: 2000,
  aliases: 10,
  venues: 50,
  walkingTimes: 2500,
} as const;

/** The raw walking minutes between two places inside one venue. It is always an estimate. */
export const SAME_VENUE_WALK_MINUTES = 5;
const SAME_VENUE_BASIS = 'room to room inside one venue, estimate';

/** Minutes of every estimated walk that already cover leaving one building and entering the next. */
export const BUILDING_ALLOWANCE_MINUTES = 15;

/**
 * The buffer that is really added to a walk. An estimate already includes the building allowance,
 * so only the buffer above it counts (the default 10 minute buffer adds nothing). An official
 * walking time gets the whole buffer.
 */
export function extraBufferMinutes(source: SourceNote, bufferMinutes: number): number {
  return source.kind === 'estimate'
    ? Math.max(0, bufferMinutes - BUILDING_ALLOWANCE_MINUTES)
    : bufferMinutes;
}

/** Match venue names after trimming and lowercasing, by exact name only. */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

const SourceNoteSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('official'),
    url: z
      .string()
      .max(VENUE_LIMITS.url)
      .refine(isOfficialUrl, 'an official source needs an https URL on an official AWS page'),
    retrievedOn: z
      .string()
      .refine(isCalendarDate, 'an official source needs the date it was read, as YYYY-MM-DD'),
  }),
  z.object({ kind: z.literal('estimate'), basis: z.string().max(VENUE_LIMITS.basis).optional() }),
]);

const VenueEntrySchema = z
  .object({
    venue: VenueSchema,
    coordinatesSource: SourceNoteSchema.optional(),
    nameSource: SourceNoteSchema.optional(),
    // Spelling variants of the venue name, each with its own source note.
    aliases: z
      .array(z.object({ name: z.string(), source: SourceNoteSchema }))
      .max(VENUE_LIMITS.aliases)
      .optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.venue.name.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['venue', 'name'], message: 'the name is empty' });
    }
    if (entry.venue.name.length > VENUE_LIMITS.name) {
      ctx.addIssue({ code: 'custom', path: ['venue', 'name'], message: 'the name is too long' });
    }
    (entry.aliases ?? []).forEach((alias, index) => {
      if (alias.name.trim() === '' || alias.name.length > VENUE_LIMITS.name) {
        ctx.addIssue({
          code: 'custom',
          path: ['aliases', index, 'name'],
          message: 'an alias must have a name of 1 to 100 characters',
        });
      }
    });
    const coordinates = entry.venue.coordinates;
    if (coordinates === undefined) {
      return;
    }
    if (coordinates.lat < -90 || coordinates.lat > 90) {
      ctx.addIssue({
        code: 'custom',
        path: ['venue', 'coordinates', 'lat'],
        message: 'the latitude must be from -90 to 90',
      });
    }
    if (coordinates.lon < -180 || coordinates.lon > 180) {
      ctx.addIssue({
        code: 'custom',
        path: ['venue', 'coordinates', 'lon'],
        message: 'the longitude must be from -180 to 180',
      });
    }
    if (entry.coordinatesSource === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['coordinatesSource'],
        message: 'coordinates need a source note',
      });
    }
  });

const WalkingEdgeSchema = z
  .object({
    from: z.string().max(VENUE_LIMITS.name),
    to: z.string().max(VENUE_LIMITS.name),
    minutes: z.number().int().min(1).max(240),
    source: SourceNoteSchema,
  })
  .refine((edge) => normaliseName(edge.from) !== normaliseName(edge.to), {
    path: ['to'],
    message: 'a walking time must join two distinct venues',
  });

/**
 * The whole data/venues.json wrapper. Beyond the shape of each entry it checks that the
 * matrix only names listed venues, has no duplicate ordered pair, and covers every ordered
 * pair of distinct listed venues.
 */
export const VenueDataSchema = z
  .object({
    venues: z.array(VenueEntrySchema).max(VENUE_LIMITS.venues),
    walkingTimes: z.array(WalkingEdgeSchema).max(VENUE_LIMITS.walkingTimes),
  })
  .superRefine((data, ctx) => {
    // Every name and alias (trimmed, lower case) maps to its venue's own name.
    const canon = new Map<string, string>();
    data.venues.forEach((entry, index) => {
      const name = normaliseName(entry.venue.name);
      if (canon.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['venues', index, 'venue', 'name'],
          message: 'the venue is listed twice',
        });
      }
      canon.set(name, name);
    });
    data.venues.forEach((entry, index) => {
      const name = normaliseName(entry.venue.name);
      (entry.aliases ?? []).forEach((alias, aliasIndex) => {
        const spelling = normaliseName(alias.name);
        if (canon.has(spelling)) {
          ctx.addIssue({
            code: 'custom',
            path: ['venues', index, 'aliases', aliasIndex, 'name'],
            message: 'the alias is already used by a venue or another alias',
          });
        } else {
          canon.set(spelling, name);
        }
      });
    });
    const venues = new Set(canon.values());
    const seen = new Set<string>();
    data.walkingTimes.forEach((edge, index) => {
      const from = canon.get(normaliseName(edge.from));
      const to = canon.get(normaliseName(edge.to));
      if (from === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['walkingTimes', index, 'from'],
          message: 'the venue is not in the venues list',
        });
      }
      if (to === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['walkingTimes', index, 'to'],
          message: 'the venue is not in the venues list',
        });
      }
      const pair = `${from}\n${to}`;
      if (seen.has(pair)) {
        ctx.addIssue({
          code: 'custom',
          path: ['walkingTimes', index],
          message: 'the ordered pair is listed twice',
        });
      }
      seen.add(pair);
    });
    for (const from of venues) {
      for (const to of venues) {
        if (from !== to && !seen.has(`${from}\n${to}`)) {
          ctx.addIssue({
            code: 'custom',
            path: ['walkingTimes'],
            message: `there is no walking time from ${from} to ${to}`,
          });
        }
      }
    }
  });

function formatPath(path: readonly PropertyKey[]): string {
  const text = path
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`))
    .join('');
  return text.startsWith('.') ? text.slice(1) : text;
}

/** The result of validating venue data. */
export type VenueDataValidation = { ok: true; data: VenueData } | { ok: false; errors: string[] };

/**
 * Validate venue data. A failure lists every problem as "path: reason", where the path
 * names the failing entry, for example "venues[2].venue.coordinates.lat: the latitude
 * must be from -90 to 90" (Req 9.7).
 */
export function validateVenueData(input: unknown): VenueDataValidation {
  const result = VenueDataSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`),
  };
}

/** The outcome of looking up a walking time for an ordered pair of venues. */
export type WalkLookup =
  | { found: true; minutes: number; source: SourceNote }
  | { found: false; reason: 'venueNotListed'; venue: string }
  | { found: false; reason: 'pairMissing' };

/**
 * Look up the walking time from one venue to another. A venue absent from the venues list
 * and an ordered pair with no matrix value are both "not found" (Req 9.8, 9.9), so the
 * connection layer can call the connection unknown. Two names that match after trimming and
 * lowercasing are the same venue: zero raw walking minutes, labelled an estimate.
 */
export function lookupWalk(data: VenueData, from: string, to: string): WalkLookup {
  const canon = canonicalNames(data);
  const a = canon.get(normaliseName(from));
  const b = canon.get(normaliseName(to));
  if (a === undefined) {
    return { found: false, reason: 'venueNotListed', venue: from };
  }
  if (b === undefined) {
    return { found: false, reason: 'venueNotListed', venue: to };
  }
  if (a === b) {
    return {
      found: true,
      minutes: SAME_VENUE_WALK_MINUTES,
      source: { kind: 'estimate', basis: SAME_VENUE_BASIS },
    };
  }
  const edge = data.walkingTimes.find(
    (candidate) =>
      canon.get(normaliseName(candidate.from)) === a &&
      canon.get(normaliseName(candidate.to)) === b,
  );
  return edge
    ? { found: true, minutes: edge.minutes, source: edge.source }
    : { found: false, reason: 'pairMissing' };
}

/**
 * Every venue name and alias, trimmed and lower case, mapped to its venue's own name (also trimmed
 * and lower case). The first venue to claim a spelling keeps it, so odd data cannot reassign one.
 */
function canonicalNames(data: VenueData): Map<string, string> {
  const canon = new Map<string, string>();
  for (const entry of data.venues) {
    const name = normaliseName(entry.venue.name);
    if (!canon.has(name)) {
      canon.set(name, name);
    }
  }
  for (const entry of data.venues) {
    for (const alias of entry.aliases ?? []) {
      const spelling = normaliseName(alias.name);
      if (!canon.has(spelling)) {
        canon.set(spelling, normaliseName(entry.venue.name));
      }
    }
  }
  return canon;
}

/**
 * Are two names the same venue, counting aliases? Names that are not in the venue list are only
 * the same when they match exactly after trimming and lowercasing.
 */
export function sameVenue(data: VenueData, a: string, b: string): boolean {
  const canon = canonicalNames(data);
  const first = canon.get(normaliseName(a)) ?? normaliseName(a);
  const second = canon.get(normaliseName(b)) ?? normaliseName(b);
  return first === second;
}
