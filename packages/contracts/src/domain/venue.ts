// Domain schema for a Venue (foundation-contracts, S0). Used by S2's walking-time
// data. Defined here in contracts so every stream shares it.
//
// Rules applied here (see design, Data Models, Venue):
//   1. Name required, coordinates optional.
//   2. Unknown fields are stripped (plain z.object).
import { z } from 'zod';

/**
 * A venue with its name and optional coordinates. Name is required; the
 * coordinates object (with numeric lat and lon) is optional. Unknown fields are
 * stripped.
 */
export const VenueSchema = z.object({
  name: z.string(),
  coordinates: z
    .object({
      lat: z.number(),
      lon: z.number(),
    })
    .optional(),
});

export type Venue = z.infer<typeof VenueSchema>;
