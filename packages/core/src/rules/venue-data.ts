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

// https, then a bare host (no user info, no port), then the rest (path, query, fragment).
const HTTPS_URL_PATTERN = /^https:\/\/([^/?#:@\s]+)(\/[^?#\s]*)?(?:[?#]\S*)?$/i;

function isOfficialUrl(value: string): boolean {
  const match = HTTPS_URL_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const prefixes = Object.hasOwn(OFFICIAL_SOURCES, (match[1] as string).toLowerCase())
    ? (OFFICIAL_SOURCES[(match[1] as string).toLowerCase()] as readonly string[])
    : [];
  const path = match[2] ?? '/';
  return prefixes.some(
    (prefix) => prefix === '/' || path === prefix || path.startsWith(`${prefix}/`),
  );
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
      .refine(isOfficialUrl, 'an official source needs an https URL on an official AWS page'),
    retrievedOn: z
      .string()
      .refine(isCalendarDate, 'an official source needs the date it was read, as YYYY-MM-DD'),
  }),
  z.object({ kind: z.literal('estimate'), basis: z.string().optional() }),
]);

const VenueEntrySchema = z
  .object({
    venue: VenueSchema,
    coordinatesSource: SourceNoteSchema.optional(),
    nameSource: SourceNoteSchema.optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.venue.name.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['venue', 'name'], message: 'the name is empty' });
    }
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
    from: z.string(),
    to: z.string(),
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
    venues: z.array(VenueEntrySchema),
    walkingTimes: z.array(WalkingEdgeSchema),
  })
  .superRefine((data, ctx) => {
    const listed = new Set<string>();
    data.venues.forEach((entry, index) => {
      const name = normaliseName(entry.venue.name);
      if (listed.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['venues', index, 'venue', 'name'],
          message: 'the venue is listed twice',
        });
      }
      listed.add(name);
    });
    const seen = new Set<string>();
    data.walkingTimes.forEach((edge, index) => {
      const from = normaliseName(edge.from);
      const to = normaliseName(edge.to);
      if (!listed.has(from)) {
        ctx.addIssue({
          code: 'custom',
          path: ['walkingTimes', index, 'from'],
          message: 'the venue is not in the venues list',
        });
      }
      if (!listed.has(to)) {
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
    for (const from of listed) {
      for (const to of listed) {
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
  const a = normaliseName(from);
  const b = normaliseName(to);
  const listed = new Set(data.venues.map((entry) => normaliseName(entry.venue.name)));
  if (!listed.has(a)) {
    return { found: false, reason: 'venueNotListed', venue: from };
  }
  if (!listed.has(b)) {
    return { found: false, reason: 'venueNotListed', venue: to };
  }
  if (a === b) {
    return {
      found: true,
      minutes: 0,
      source: { kind: 'estimate', basis: 'Both places are in the same venue.' },
    };
  }
  const edge = data.walkingTimes.find(
    (candidate) => normaliseName(candidate.from) === a && normaliseName(candidate.to) === b,
  );
  return edge
    ? { found: true, minutes: edge.minutes, source: edge.source }
    : { found: false, reason: 'pairMissing' };
}
