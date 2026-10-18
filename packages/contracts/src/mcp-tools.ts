// MCP tool input and output schemas (foundation-contracts, S0). Every tool in
// build plan section 8.1 has an input schema and an output schema, exported as a
// single mcpTools record keyed by tool name so S3 can iterate it to register the
// tools on the local stdio MCP server.
//
// Cross-cutting rules applied here (see design, Component 3, and product.md):
//   1. Every input and output is a zod OBJECT parsed defensively. Plain z.object
//      strips unknown fields, so a client or a future tool revision that sends an
//      extra field never breaks parsing and the extra never flows into logs.
//   2. No coercion. A present field with the wrong type is rejected, not coerced.
//   3. No secret material ever appears in a schema. sign_in reports only whether
//      the session is signed in and when it expires, never a token. issue and sync
//      report serials and session ids, never certificates or keys. The hand-off
//      url is typed as a plain string; the capability it carries lives in the URL
//      fragment and is never modelled as a field.
//   4. Shared shapes are reused, never redeclared. Read outputs reference the
//      NormalisedSession, ScheduleWire and Verdict schemas; write inputs reference
//      the domain and wire shapes (Commitment, PersonalTimeInput, BulkResult).
//   5. Reserve, standby and issue take 1 to 10 session ids (the Events API bound),
//      enforced with .min(1).max(10) and a local duplicate check so a client never
//      sends the same id twice. send_to_phone and sync_passes take an optional list
//      of up to 80 session ids to narrow the hand-off or the sync.
import { z } from 'zod';
import { NormalisedSessionSchema } from './domain/normalised-session.js';
import { CommitmentSchema } from './domain/commitment.js';
import { VerdictSchema } from './domain/verdict.js';
import { BulkResultSchema } from './wire/bulk-result.js';
import { PersonalTimeInputSchema } from './wire/personal-time.js';

/**
 * A session id array bounded to the Events API limit of 1 to 10 ids, with
 * duplicate ids rejected locally so the same session is never sent twice.
 */
const SessionIdBatch = z
  .array(z.string())
  .min(1)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'sessionIds must not contain duplicate ids',
  });

// sign_in: begin or confirm a local PKCE sign-in. No arguments are required; force
// re-runs the flow even when a valid session exists. The output reports only
// whether the session is signed in and when it expires, never a token value.
const SignInInput = z.object({
  force: z.boolean().optional(),
});
const SignInOutput = z.object({
  signedIn: z.boolean(),
  expiresAt: z.string().optional(),
});

// sign_out: revoke and clear the local session. No arguments.
const SignOutInput = z.object({});
const SignOutOutput = z.object({
  signedOut: z.boolean(),
});

// refresh_catalog: fetch every page of the catalog into the local cache. force
// ignores any cache freshness window.
const RefreshCatalogInput = z.object({
  force: z.boolean().optional(),
});
const RefreshCatalogOutput = z.object({
  sessionCount: z.number(),
  refreshedAt: z.string(),
});

// find_sessions: search and filter the cached catalog locally (the Events API has
// no server-side search). Filters are optional and narrow by service, level, type
// or day. The output carries normalised sessions and the total that matched.
const FindSessionsInput = z.object({
  query: z.string().optional(),
  filters: z
    .object({
      services: z.array(z.string()).optional(),
      level: z.string().optional(),
      type: z.string().optional(),
      day: z.string().optional(),
    })
    .optional(),
  limit: z.number().optional(),
});
const FindSessionsOutput = z.object({
  sessions: z.array(NormalisedSessionSchema),
  totalMatched: z.number(),
});

// scan_repo: scan a local workspace path. Only service names and a depth per
// service leave the scanner; file contents never do.
const ScanRepoInput = z.object({
  path: z.string(),
});
const ScanRepoOutput = z.object({
  services: z.array(z.string()),
  depthByService: z
    .array(
      z.object({
        service: z.string(),
        depth: z.number(),
      }),
    )
    .optional(),
});

// plan_week: suggest a week of commitments from goals, level and a per-day cap. The
// output is a list of itinerary commitments.
const PlanWeekInput = z.object({
  goals: z.array(z.string()).optional(),
  level: z.string().optional(),
  maxPerDay: z.number().optional(),
});
const PlanWeekOutput = z.object({
  commitments: z.array(CommitmentSchema),
});

// check_itinerary: run the guardrails over a proposed set of commitments without
// writing anything. This is the read side of the guardrail, so it returns a Verdict.
const CheckItineraryInput = z.object({
  commitments: z.array(CommitmentSchema),
});
const CheckItineraryOutput = z.object({
  verdict: VerdictSchema,
});

// reserve_with_guardrails: reserve 1 to 10 sessions after the guardrail passes. The
// output carries the guardrail verdict and, when the write was attempted, the
// per-session bulk result. The reservation is confirmed by a later GetSchedule.
const ReserveWithGuardrailsInput = z.object({
  sessionIds: SessionIdBatch,
});
const ReserveWithGuardrailsOutput = z.object({
  verdict: VerdictSchema,
  result: BulkResultSchema.optional(),
});

// cancel_reservation: cancel one reservation (and, via the safe swap, rebook a
// repeat). The output reports whether the cancellation was applied.
const CancelReservationInput = z.object({
  sessionId: z.string(),
});
const CancelReservationOutput = z.object({
  cancelled: z.boolean(),
});

// add_standby: favorite 1 to 10 sessions as backups (favorites are standby). The
// output carries the per-session bulk result.
const AddStandbyInput = z.object({
  sessionIds: SessionIdBatch,
});
const AddStandbyOutput = z.object({
  result: BulkResultSchema,
});

// remove_standby: remove one favorite. The output reports whether it was removed.
const RemoveStandbyInput = z.object({
  sessionId: z.string(),
});
const RemoveStandbyOutput = z.object({
  removed: z.boolean(),
});

// add_layover: create, update or delete a personal time block (a layover) for meals, water
// or rest, so all three personal time operations of the Events API are reachable. The input is
// a union on `action`: create and update carry the wire PersonalTimeInput shape, update and
// delete carry the id of the entry (bounded, so an id can never be a path hazard or a flood).
// The output says which action was asked for and whether the confirmed schedule shows it done.
const PersonalTimeId = z.string().min(1).max(256);
const AddLayoverInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), personalTime: PersonalTimeInputSchema }),
  z.object({
    action: z.literal('update'),
    personalTimeId: PersonalTimeId,
    personalTime: PersonalTimeInputSchema,
  }),
  z.object({ action: z.literal('delete'), personalTimeId: PersonalTimeId }),
]);
const AddLayoverOutput = z.object({
  action: z.enum(['create', 'update', 'delete']),
  done: z.boolean(),
  personalTimeId: z.string().optional(),
});

// issue_boarding_passes: issue passes for 1 to 10 reserved sessions. The output
// lists the session ids issued and their serials. No secret material is returned.
const IssueBoardingPassesInput = z.object({
  sessionIds: SessionIdBatch,
});
const IssueBoardingPassesOutput = z.object({
  issued: z.array(z.string()),
  serials: z.array(z.string()).optional(),
});

// send_to_phone: open a 15-minute hand-off to the phone. sessionIds optionally
// narrows the hand-off to specific passes. The output carries the hand-off url (the
// capability lives in the url fragment, typed here as a plain string) and its
// expiry.
const SendToPhoneInput = z.object({
  sessionIds: z.array(z.string()).max(80).optional(),
});
const SendToPhoneOutput = z.object({
  handoffUrl: z.string(),
  expiresAt: z.string(),
});

// sync_passes: reconcile issued passes against the live schedule. sessionIds
// optionally narrows the sync. The output lists what was issued, updated and voided.
const SyncPassesInput = z.object({
  sessionIds: z.array(z.string()).max(80).optional(),
});
const SyncPassesOutput = z.object({
  issued: z.array(z.string()),
  updated: z.array(z.string()),
  voided: z.array(z.string()),
});

// export_calendar: produce an .ics for the itinerary. commitments optionally scopes
// the export; when absent the whole itinerary is exported. The output carries the
// .ics text.
const ExportCalendarInput = z.object({
  commitments: z.array(CommitmentSchema).optional(),
});
const ExportCalendarOutput = z.object({
  ics: z.string(),
});

// forget_me: delete everything for the caller. confirm must be true, so the
// deletion can never happen by accident. The output reports whether it was done.
const ForgetMeInput = z.object({
  confirm: z.literal(true),
});
const ForgetMeOutput = z.object({
  forgotten: z.boolean(),
});

/**
 * The seventeen MCP tools (build plan section 8.1), each with its input and output
 * zod object schema. S3 iterates this record by key to register the tools. The
 * record is frozen with `as const` so the key set is fixed and McpToolName is exact.
 */
export const mcpTools = {
  sign_in: { input: SignInInput, output: SignInOutput },
  sign_out: { input: SignOutInput, output: SignOutOutput },
  refresh_catalog: { input: RefreshCatalogInput, output: RefreshCatalogOutput },
  find_sessions: { input: FindSessionsInput, output: FindSessionsOutput },
  scan_repo: { input: ScanRepoInput, output: ScanRepoOutput },
  plan_week: { input: PlanWeekInput, output: PlanWeekOutput },
  check_itinerary: { input: CheckItineraryInput, output: CheckItineraryOutput },
  reserve_with_guardrails: {
    input: ReserveWithGuardrailsInput,
    output: ReserveWithGuardrailsOutput,
  },
  cancel_reservation: {
    input: CancelReservationInput,
    output: CancelReservationOutput,
  },
  add_standby: { input: AddStandbyInput, output: AddStandbyOutput },
  remove_standby: { input: RemoveStandbyInput, output: RemoveStandbyOutput },
  add_layover: { input: AddLayoverInput, output: AddLayoverOutput },
  issue_boarding_passes: {
    input: IssueBoardingPassesInput,
    output: IssueBoardingPassesOutput,
  },
  send_to_phone: { input: SendToPhoneInput, output: SendToPhoneOutput },
  sync_passes: { input: SyncPassesInput, output: SyncPassesOutput },
  export_calendar: { input: ExportCalendarInput, output: ExportCalendarOutput },
  forget_me: { input: ForgetMeInput, output: ForgetMeOutput },
} as const;

/**
 * The name of an MCP tool: the exact set of keys on mcpTools.
 */
export type McpToolName = keyof typeof mcpTools;

/**
 * The inferred input type for a given tool name.
 */
export type McpToolInput<K extends McpToolName> = z.infer<(typeof mcpTools)[K]['input']>;

/**
 * The inferred output type for a given tool name.
 */
export type McpToolOutput<K extends McpToolName> = z.infer<(typeof mcpTools)[K]['output']>;
