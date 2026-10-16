// Domain schema for a Verdict (foundation-contracts, S0): the guardrail outcome.
// Defined here in contracts so every stream shares it.
//
// Rules applied here (see design, Data Models, Verdict):
//   1. A discriminated union over allow, warn and block, each carrying a reasons
//      array of human-readable strings.
//   2. warn and block always carry at least one reason; allow may carry zero or
//      more.
//   3. Unknown fields are stripped within each variant (plain z.object).
import { z } from 'zod';

/**
 * The reservation is allowed. reasons may be empty or carry explanatory context.
 */
const AllowSchema = z.object({
  decision: z.literal('allow'),
  reasons: z.array(z.string()),
});

/**
 * The reservation is allowed with a warning. At least one reason is always
 * carried so the attendee understands the risk.
 */
const WarnSchema = z.object({
  decision: z.literal('warn'),
  reasons: z.array(z.string()).min(1),
});

/**
 * The reservation is blocked. At least one reason is always carried so the
 * attendee understands why.
 */
const BlockSchema = z.object({
  decision: z.literal('block'),
  reasons: z.array(z.string()).min(1),
});

/**
 * The guardrail outcome, discriminated on decision. warn and block always carry
 * at least one reason; allow may carry zero or more.
 */
export const VerdictSchema = z.discriminatedUnion('decision', [
  AllowSchema,
  WarnSchema,
  BlockSchema,
]);

export type Verdict = z.infer<typeof VerdictSchema>;
