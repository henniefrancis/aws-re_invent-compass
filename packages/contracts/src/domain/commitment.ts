// Domain schema for a Commitment (foundation-contracts, S0). A commitment is one
// entry on the attendee's itinerary: either a reserved session or personal time
// (a layover). Produced and consumed by other streams, so it is defined here in
// contracts.
//
// Rules applied here (see design, Data Models, Commitment):
//   1. A discriminated union over a kind field. The discriminant makes exhaustive
//      handling checkable by the rules engine later.
//   2. The reservedSession variant carries a session reference and timing.
//   3. The personalTime variant (a layover) carries a free-text title and timing.
//   4. Unknown fields are stripped within each variant (plain z.object).
import { z } from 'zod';

/**
 * A reserved session on the itinerary: a session reference with its timing. title
 * and venue are optional context carried for display.
 */
const ReservedSessionSchema = z.object({
  kind: z.literal('reservedSession'),
  sessionId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  title: z.string().optional(),
  venue: z.string().optional(),
});

/**
 * Personal time on the itinerary (a layover): a free-text title with its timing.
 * personalTimeId and location are optional context.
 */
const PersonalTimeCommitmentSchema = z.object({
  kind: z.literal('personalTime'),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  personalTimeId: z.string().optional(),
  location: z.string().optional(),
});

/**
 * One itinerary commitment, discriminated on kind so exhaustive handling is
 * checkable by the rules engine later.
 */
export const CommitmentSchema = z.discriminatedUnion('kind', [
  ReservedSessionSchema,
  PersonalTimeCommitmentSchema,
]);

export type Commitment = z.infer<typeof CommitmentSchema>;
