# Design Document

## Overview

The itinerary rules engine (stream S2) is a pure, browser-safe set of functions in `packages/core/src/rules`. It answers one question for a re:Invent attendee: can I get into this session on time and safely, given everything else on my week. It computes boarding times, walking connections between venues, clashes, layovers (personal time for meals and rest), a per-day energy budget, and rebooking options, and it packages all of these into one guardrail function, `checkReservation`, that returns a single `Verdict` of allow, warn or block with plain-English reasons.

The engine performs no input or output. It reads no files at runtime, imports nothing from Node built-in modules, and never reads the system clock. It is browser-safe because the showcase site (S7) runs it directly through the subpath export `@compass/core/rules`, the same code the MCP server (S3) and the Kiro hook call. The engine owns `packages/core/src/rules` and `data/venues.json` only.

It reuses the shared domain types `Verdict`, `Venue`, `NormalisedSession` and `Commitment` from `@compass/contracts` and never redefines them. Its own schedule shape is a `Commitment[]` plus a `Sessions_Lookup`, a map of `NormalisedSession` keyed by `sessionId`.

The engine follows the product voice: plain English, short sentences, and no em dash or en dash anywhere. It is honest about uncertainty: when a required field is missing it returns an "unknown" result with a reason and never invents a value. All times are interpreted in the event timezone supplied in `Context`, and all time arithmetic is DST-safe. The current instant always comes from `Context.now`, never from a system clock.

### Design goals

- **Purity and determinism.** Every exported function is a pure function of its inputs. Deeply equal inputs always produce deeply equal outputs (Req 10.5), and no input is ever mutated (Req 10.6).
- **Honesty about uncertainty.** Missing timezone, venue, start time, or end time yields an "unknown" result with a stated reason, never a substituted default (Req 1.5, 1.6, 1.8, 11.3, 11.4, 11.5).
- **One shared definition per concept.** "Tight", "clash", boarding, and venue resolution each have exactly one definition reused across all rules and the guardrail.
- **DST-safe time discipline.** Durations use absolute instants; day bucketing and meal windows use event-timezone local wall-clock time computed through `Intl` (Req 11.2).
- **One guardrail.** `checkReservation` combines every rule into a single `Verdict` with a stated precedence (block over warn over allow) (Req 8).

### Design decisions and rationale

- **Decision: a shared internal time toolkit (`time.ts`) splits instant arithmetic from wall-clock bucketing.** Rationale: Req 11.2 mandates two kinds of time work. Durations and elapsed minutes are computed on the absolute instants parsed from ISO 8601 strings with offset. Day bucketing and meal-window placement use `Intl.DateTimeFormat` with the `timeZone` option to read the local wall-clock fields. This keeps results stable across a DST transition inside the event window, because a duration between two offset-bearing instants does not change when the local offset changes.
- **Decision: the engine depends only on the `Intl` global and standard ECMAScript.** Rationale: Req 10.2 and 10.3 require zero Node built-in imports and no reference error for a missing runtime global in a browser. `Intl.DateTimeFormat` is a standard global available in Node 24 and every modern browser, so it is browser-safe. A test scans source and transitive imports for Node built-ins (Req 12.4).
- **Decision: every rule returns a typed result carrying either a value or an `unknown` status with reasons, rather than throwing.** Rationale: Req 11.5 and Req 8.7 require the engine to skip a rule it cannot judge and state why, not to fail. Throwing would break purity guarantees and the single-verdict contract.
- **Decision: `checkReservation` composes the lower-level rules and never re-implements them.** Rationale: the Glossary states "Tight" has one definition shared by the connection rules and the guardrail (Req 2.3, 8.4). Composition keeps that single source of truth.
- **Decision: the energy budget (Req 5, cut-list item 2) is built last and has a count-only fallback.** Rationale: Req 5.9 requires that if the full formula is cut, a count-only overload check still exists so the guardrail (Req 8.6) has a basis. The design keeps overload detection behind one interface so either implementation satisfies `checkReservation`.

## Architecture

The engine is a layered set of pure modules. The lower layers compute single facts (boarding time, a connection, a clash). The guardrail layer composes them into one `Verdict`. Nothing in any layer performs I/O or reads a clock.

```mermaid
flowchart TD
    subgraph inputs[Inputs from callers]
        CMT[Commitment array]
        LOOK[Sessions_Lookup map]
        CTX[Context now, mealWindow, thresholds, Event_Timezone, Venue_Data]
    end

    subgraph internal[Internal helpers pure, not exported]
        TIME[time.ts instants and Intl wall-clock]
        RES[resolve.ts venue, times, reservability]
        VD[venue-data.ts walking-time matrix lookup]
    end

    subgraph rules[Rule layer exported]
        BOARD[boarding.ts Boarding_Closes]
        CONN[connections.ts Connection classify]
        CLASH[clashes.ts overlap detect]
        LAY[layovers.ts meal window and stretch]
        ENERGY[energy.ts Energy_Budget and fallback]
        REBOOK[rebooking.ts repeats, standby, walk-up]
        SWAP[safe-swap.ts ordered steps]
    end

    GUARD[check-reservation.ts single Verdict]

    inputs --> internal
    internal --> rules
    rules --> GUARD
    CTX --> GUARD
    GUARD --> VERDICT[Verdict allow warn block]
```

### Module layout (owned files under packages/core/src/rules)

| File                   | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                  | Exported |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `index.ts`             | Subpath entry for `@compass/core/rules`; re-exports the public surface by name                                                                                                                                                                                                                                                                                                                                  | yes      |
| `context.ts`           | `Context` type, `ContextSchema`, and the documented defaults                                                                                                                                                                                                                                                                                                                                                    | yes      |
| `time.ts`              | Parse offset instants, compute duration minutes, bucket by event day, read wall-clock fields through `Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23" })`, convert wall-clock to instant with a two-pass offset correction (earlier offset wins on a fall-back overlap), read offsets from the `longOffset` part, validate IANA timezone and reject any value starting with `+` or `-`; no `Temporal` | internal |
| `resolve.ts`           | `Venue_Resolution`, time resolution from `NormalisedSession` plus `missingFields`, reservability resolution                                                                                                                                                                                                                                                                                                     | internal |
| `venue-data.ts`        | Load and validate the in-memory `Venue_Data`, look up a walking time for an ordered venue pair                                                                                                                                                                                                                                                                                                                  | internal |
| `boarding.ts`          | `computeBoarding` returns `Boarding_Closes` or an unknown or not-applicable result                                                                                                                                                                                                                                                                                                                              | yes      |
| `connections.ts`       | `classifyConnection` returns comfortable, tight, impossible, or unknown with a reason                                                                                                                                                                                                                                                                                                                           | yes      |
| `clashes.ts`           | `findClashes` detects overlaps and reports unknown for missing end times                                                                                                                                                                                                                                                                                                                                        | yes      |
| `layovers.ts`          | `checkLayovers` evaluates the meal window and unbroken stretch and suggests blocks                                                                                                                                                                                                                                                                                                                              | yes      |
| `energy.ts`            | `scoreEnergy` computes the `Energy_Budget` and the count-only fallback                                                                                                                                                                                                                                                                                                                                          | yes      |
| `rebooking.ts`         | `findRebookingOptions` returns repeats, standby, and walk-up options                                                                                                                                                                                                                                                                                                                                            | yes      |
| `safe-swap.ts`         | `planSafeSwap` returns the ordered three-step swap plan and outcome                                                                                                                                                                                                                                                                                                                                             | yes      |
| `check-reservation.ts` | `checkReservation` composes all rules into one `Verdict`                                                                                                                                                                                                                                                                                                                                                        | yes      |
| `reasons.ts`           | Plain-English reason builders; central place that guarantees no em or en dash                                                                                                                                                                                                                                                                                                                                   | internal |

### Owned data file

`data/venues.json` holds the `Venue_Data` wrapper: the venues list, the walking-time matrix, and a source note on every value. The engine does not read this file at runtime (Req 10.1). Callers load and parse it and pass the result in through `Context.venueData`. A test validates the file against the wrapper schema (Req 9.6).

### Time discipline (Req 11.2)

Two kinds of time work, kept separate in `time.ts`:

- **Durations and elapsed time** use the absolute instants. The engine parses each ISO 8601 string with offset to an absolute epoch value and subtracts. A connection's spare minutes, a clash overlap, and the 10-minute boarding offset are all instant arithmetic. This is why a DST offset change inside the event window does not shift boarding, connection, or clash results by any minutes.
- **Day bucketing and meal-window placement** use event-timezone local wall-clock time. `time.ts` uses `Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23" })` to read the local year, month, day, hour, and minute for an instant, and always passes a `Date` object to `formatToParts`. Day grouping compares the local calendar day. Meal-window checks compare local wall-clock minutes against `mealWindow`.

Further time rules in `time.ts`:

- Converting a wall-clock time to an instant uses a two-pass offset correction. When two offsets are possible, as in a daylight saving fall-back overlap, the earlier offset wins.
- Output offsets come from the `timeZoneName` `longOffset` part.
- The timezone validator rejects any `timeZone` value that starts with `+` or `-`.
- The engine does not use `Temporal`.

## Components and Interfaces

All interfaces below are described in TypeScript-flavoured shapes. The four shared types (`Verdict`, `Venue`, `NormalisedSession`, `Commitment`) are imported from `@compass/contracts` and never redefined (Req 10.4). Result types below are engine-local and do not redefine the shared four.

### Context

```ts
import type { Venue } from '@compass/contracts';

interface MealWindow {
  start: string; // local wall-clock HH:mm, default "11:30"
  end: string; // local wall-clock HH:mm, default "14:00"
  requiredFreeMinutes: number; // default 30
}

interface SourceNote {
  kind: 'official' | 'estimate';
  url?: string; // present and required when kind is "official"
}

interface WalkingEdge {
  from: string; // venue name
  to: string; // venue name, distinct from "from"
  minutes: number; // whole minutes 0..240
  source: SourceNote;
}

interface VenueEntry {
  venue: Venue; // reuses VenueSchema from contracts
  coordinatesSource?: SourceNote; // present when coordinates are present
}

interface VenueData {
  venues: VenueEntry[];
  walkingTimes: WalkingEdge[];
}

interface Context {
  now: string; // ISO 8601 with offset, required, no default
  eventTimezone?: string; // IANA name, e.g. "America/Los_Angeles"
  venueData: VenueData;
  mealWindow: MealWindow; // default 11:30 to 14:00 needing 30 free minutes
  maxStretchMinutes: number; // default 180
  overloadThreshold: number; // default 100
  overloadCountThreshold: number; // default 6, used by the count-only fallback
  tightMarginMinutes: number; // default 5
  bufferMinutes: number; // default 10
}
```

`context.ts` exports `ContextSchema` (a Zod schema whose name ends in `Schema`) and a `withContextDefaults` helper that fills every tuning value except `now` with its documented default, including `overloadCountThreshold` with a default of 6. `now` has no default; the caller always supplies it (Glossary, Context). `eventTimezone` is intentionally optional so the engine can return "unknown" when it is absent (Req 11.3) and "unknown" when it is present but not a recognised IANA name (Req 11.4).

### Sessions_Lookup and Schedule_Input

```ts
import type { Commitment, NormalisedSession } from '@compass/contracts';

type SessionsLookup = Readonly<Record<string, NormalisedSession>>;

interface ScheduleInput {
  commitments: readonly Commitment[];
  sessions: SessionsLookup;
}
```

### Resolved view (resolve.ts, internal)

`resolve.ts` turns one `Commitment` plus the `Sessions_Lookup` into a single resolved view used by every rule, so venue, time, and reservability resolution live in one place.

```ts
type Missing = 'venue' | 'startsAt' | 'endsAt' | 'reservability';

interface ResolvedCommitment {
  ref: string; // human label naming the commitment for reasons
  venue?: string; // Venue_Resolution result
  startsAt?: string; // ISO instant, absent when unusable
  endsAt?: string; // ISO instant, absent when unusable
  isAllDay: boolean;
  isReservable?: boolean; // absent when the flag is missing
  missing: Missing[]; // names every field left absent
}
```

`Venue_Resolution` order (Req 2.5, 9.x): `NormalisedSession.venue` when present, otherwise for a `reservedSession` `Commitment.venue`, otherwise for a `personalTime` `Commitment.location`. A time is "usable" only when the `NormalisedSession` field is present and the field name is not listed in `NormalisedSession.missingFields` (Req 1.5, 3.7, 5.7).

Time resolution by commitment kind:

- For a `personalTime`, the start and end times come from `Commitment.startsAt` and `Commitment.endsAt`.
- For a `reservedSession`, the times come from the `NormalisedSession` times when usable, otherwise the resolved time is absent (unknown).
- A `sessionId` that is missing from the `Sessions_Lookup` yields unknown for venue, start time, end time, and reservability.
- A time value is usable only when it matches ISO 8601 with a `Z` or a `+/-HH:MM` offset; any other string is treated as unknown.
- Reservability is treated as missing when `isReservable` appears in `missingFields`, or when the `sessionId` is absent from the lookup.

### Boarding (boarding.ts)

```ts
type BoardingResult =
  | { status: 'closes'; at: string; reason: string } // ISO instant, reservable
  | { status: 'notApplicable'; reason: string } // not reservable
  | { status: 'unknown'; reason: string }; // missing data

function computeBoarding(session: NormalisedSession, context: Context): BoardingResult;
```

Returns `closes` at start minus 10 minutes when reservable and all data is present (Req 1.1). Returns `notApplicable` when `isReservable` is false (Req 1.2). Returns `unknown` when the start time is missing (Req 1.5), the reservability flag is missing (Req 1.6), or the timezone is missing or unrecognised (Req 1.8, 11.3, 11.4). The 10-minute subtraction is instant arithmetic; the result is expressed in the event timezone for display (Req 1.1, 1.7).

### Connections (connections.ts)

```ts
type ConnectionClass = 'comfortable' | 'tight' | 'impossible' | 'unknown';

interface ConnectionResult {
  classification: ConnectionClass;
  walkingMinutes?: number; // matrix value plus buffer, absent when unknown
  reason: string; // names both venues and the walking minutes
}

function classifyConnection(
  from: ResolvedCommitment,
  to: ResolvedCommitment,
  toBoarding: BoardingResult,
  context: Context,
): ConnectionResult;
```

Walking minutes are the matrix value plus `bufferMinutes` (Req 2.1). When both commitments resolve to the same venue, the raw walk is 0 plus `bufferMinutes`, and the reason labels this walking time as an estimate. Venue names match after trimming and lowercasing, by exact name only, with no fuzzy matching. The next item's due time is its `Boarding_Closes` when reservable, otherwise its start time (Req 2.2, 2.8). Spare time of `tightMarginMinutes` or more is comfortable (Req 2.2); fewer is tight (Req 2.3); arrival after due time is impossible (Req 2.4). Returns unknown when either venue is missing (Req 2.5), a venue is absent from the matrix (Req 2.6, 9.8, 9.9), or a reservable next item has no boarding time (Req 2.7). Every reason names both venues and the walking minutes (Req 2.9), and states "estimate" when the walking-time source is an estimate.

### Clashes (clashes.ts)

```ts
interface ClashPair {
  a: string; // commitment ref
  b: string; // commitment ref
  overlap: string; // plain-English overlapping range in the event timezone
  reason: string;
}

type ClashReport = { status: 'ok'; clashes: ClashPair[] } | { status: 'unknown'; reason: string }; // missing end time or missing timezone

function findClashes(schedule: ScheduleInput, context: Context): ClashReport;
```

Two commitments clash when they overlap by one second or more (Req 3.1). An all-day item occupies 00:00:00 to 23:59:59 of its event day in the event timezone (Req 3.2). Cross-midnight commitments are evaluated on their instants (Req 3.3). Identical start and end instants clash (Req 3.4); touching at a single instant does not (Req 3.5). A missing end time yields `unknown` for any pair including that commitment (Req 3.7). A missing timezone yields `unknown` (Req 3.8). Every clash reason names both commitments and the overlapping range (Req 3.9).

### Layovers (layovers.ts)

```ts
interface SuggestedBlock {
  start: string; // ISO instant
  end: string; // ISO instant
  reason: string;
}

interface LayoverReport {
  mealLayoverMissing: boolean;
  longStretchMinutes?: number; // present when a stretch exceeds the max
  suggestions: SuggestedBlock[];
  noPlacementReason?: string; // present when no clash-free gap exists
}

function checkLayovers(schedule: ScheduleInput, context: Context): LayoverReport;
```

Reports a missing meal layover when free minutes inside the meal window fall below the required free minutes (Req 4.1, 4.2). Reports a long stretch over `maxStretchMinutes` (Req 4.3, 4.4). Produces suggested blocks in clash-free gaps (Req 4.5, 4.6), or states that none could be placed (Req 4.7). Meal windows and stretches use event-timezone wall-clock time (Req 4.8).

### Energy (energy.ts)

Energy is implemented last (Req 5 is cut-list item 2). `checkReservation` never branches on which implementation exists: it calls a single `isOverloaded(day, context)` interface, and either the full formula or the count-only fallback stands behind that one interface.

```ts
interface EnergyResult {
  score: number;
  commitmentCount: number;
  totalWalkingMinutes: number;
  venueChangeCount: number;
  overloaded: boolean;
  explanation: string; // names the three inputs and the formula
  missingDataNotes: string[]; // names commitments excluded from walk and venue totals
}

function scoreEnergy(dayCommitments: readonly ResolvedCommitment[], context: Context): EnergyResult;

// The one overload interface the guardrail calls. It never branches on which
// implementation exists: the full formula or the count-only fallback stands
// behind it.
function isOverloaded(
  dayCommitments: readonly ResolvedCommitment[],
  context: Context,
): { overloaded: boolean; explanation: string };
```

Score is `(commitmentCount * 10) + totalWalkingMinutes + (venueChangeCount * 15)` (Req 5.1). Days with fewer than two commitments have zero walking and zero venue changes (Req 5.2). The threshold comes from `Context.overloadThreshold` (Req 5.3). A score strictly greater than the threshold is overloaded (Req 5.4); equal or less is not (Req 5.5). A commitment missing a venue or usable time is counted but excluded from walking and venue totals, and named in the explanation (Req 5.7).

Owner decision on the fallback: if cut-list item 2 (the full formula) is cut, `isOverloaded` uses a count-only fallback that flags a day with more than `overloadCountThreshold` commitments, default 6, as overloaded. `overloadCountThreshold` is a separate `Context` value from `overloadThreshold`, so the fallback has its own tuning knob (Req 5.9).

### Rebooking (rebooking.ts)

```ts
interface RebookOption {
  kind: 'repeat' | 'standby' | 'walkUp';
  sessionId: string;
  startsAt: string;
  reason: string; // 1 to 200 characters, names why the option is offered
}

type RebookResult =
  | { status: 'ok'; options: RebookOption[]; message: string }
  | { status: 'unknown'; options: []; message: string }; // timezone missing

function findRebookingOptions(
  baseCode: string,
  candidates: readonly NormalisedSession[],
  favorites: readonly NormalisedSession[],
  context: Context,
): RebookResult;
```

Finds repeats by matching the base code with a `-R` suffix and by `NormalisedSession.repeatOf`, so a repeat is found whether it carries the `-R` code suffix or points back through `repeatOf`, including only sessions starting after `Context.now` in the event timezone (Req 6.1). Lists standby favorites sharing the base code and starting after now (Req 6.2). A walk-up option is a session for the base code starting after now whose `isReservable` is false or that is full (Req 6.3). Each option carries a 1 to 200 character reason (Req 6.4). Zero options returns a plain-English "no alternative found" message (Req 6.5). A missing timezone returns zero options with a timezone message and leaves the input unchanged (Req 6.7).

### Safe swap (safe-swap.ts)

```ts
interface SwapStep {
  order: 1 | 2 | 3;
  action: 'reserveRepeat' | 'confirmHeld' | 'cancelOriginal';
  blockedUntilConfirmed: boolean;
  reason: string;
}

interface SwapPlan {
  outcome: 'safe' | 'unsafe' | 'failed';
  steps: SwapStep[];
  clashesWith: string[]; // commitment refs when unsafe
  reason: string;
}

function planSafeSwap(
  original: Commitment,
  repeat: NormalisedSession,
  confirmationSchedule: ScheduleInput, // caller obtained this from GetSchedule
  context: Context,
): SwapPlan;
```

Produces three ordered steps: reserve the repeat, confirm by inspecting the confirmation schedule, then cancel the original (Req 7.1). The cancel step is blocked until the confirmation schedule shows the repeat held (Req 7.2). A clash with the original or any other commitment yields `unsafe`, names each clashing commitment, and leaves the original unchanged (Req 7.3). No clash yields `safe` (Req 7.4). A confirmation schedule that does not show the repeat held yields `failed` and leaves the original unchanged (Req 7.5). Every step and the outcome carry a plain-English reason (Req 7.6). All clash checks use the event timezone and `Context.now` (Req 7.7). The engine does no I/O; it only inspects the schedule it is given.

### Guardrail (check-reservation.ts)

```ts
import type { Verdict } from '@compass/contracts';

function checkReservation(
  candidate: NormalisedSession,
  schedule: ScheduleInput,
  context: Context,
): Verdict;
```

`checkReservation` composes the rules above and returns exactly one `Verdict` (Req 8.1). The candidate `NormalisedSession` is first turned into a `reservedSession` `Commitment` before any rule is evaluated, so every rule sees the candidate in the same shape as the rest of the schedule. The neighbours used for the connection checks are the nearest earlier commitment and the nearest later commitment on the same event day. A candidate that is already present in the schedule is ignored for the clash checks, so a session is never treated as clashing with itself.

It blocks on a clash (Req 8.2) or an impossible connection to or from an adjacent commitment (Req 8.3). It warns on a tight connection (Req 8.4), on removing the day's only meal layover (Req 8.5), or on raising the day's energy budget above the overload threshold (Req 8.6). The meal rule and the overload rule both compare the schedule without the candidate against the schedule with the candidate: the meal rule warns only when the meal layover goes from present to missing, and the overload rule warns only when overload goes from false to true. When a rule cannot be judged for missing data, it skips that rule, states which rule and that data was missing, and the overall decision is at least warn (Req 8.7, 8.9). Decision precedence is block if any block rule applies, otherwise warn if any warn rule or missing-data case applies, otherwise allow, with one reason per applied rule (Req 8.8). Every reason is plain English with no em or en dash (Req 8.10, 11.6). Tests parse every returned result with `VerdictSchema`.

### Reasons (reasons.ts, internal)

A single module builds every reason and warning string. It is the one place that guarantees no em dash and no en dash reach output, and that each sentence stays within 20 words (Req 11.6). Centralising reason text makes the no-dash test (Req 12.3) and the plain-English rule checkable in one place.

## Data Models

### Shared types from @compass/contracts (reused, never redefined)

- **`NormalisedSession`**: `sessionId`, `code`, `title`, optional `type`, `level`, `venue`, `room`, `startsAt`, `endsAt`, `isAllDay`, `isReservable`, `seatAvailability`, `repeatOf`, and `missingFields`. The engine treats a time as usable only when present and not named in `missingFields`.
- **`Commitment`**: a discriminated union on `kind`. `reservedSession` carries `sessionId`, `startsAt`, `endsAt`, optional `title` and `venue`. `personalTime` carries `title`, `startsAt`, `endsAt`, optional `personalTimeId` and `location`.
- **`Venue`**: required `name`, optional `coordinates` with numeric `lat` and `lon`.
- **`Verdict`**: a discriminated union on `decision` (`allow`, `warn`, `block`); `warn` and `block` carry at least one reason.

### Venue_Data (data/venues.json, owned by S2)

A wrapper object, not a bare `Venue` array (Req 9.1). Its schema reuses `VenueSchema` from `@compass/contracts` for each venue entry (Req 9.6).

```jsonc
{
  "venues": [
    {
      "venue": { "name": "Venetian", "coordinates": { "lat": 36.121, "lon": -115.169 } },
      "coordinatesSource": { "kind": "estimate" },
    },
  ],
  "walkingTimes": [
    {
      "from": "Venetian",
      "to": "Caesars Forum",
      "minutes": 15,
      "source": { "kind": "estimate" },
    },
  ],
}
```

Rules enforced by `VenueDataSchema` and the file-validation test:

- Every source note value defaults to `{ kind: "estimate" }`; a value is only `official` when a cited URL is supplied.
- The venues list holds only main re:Invent 2026 venues named on official AWS pages; each venue name is non-empty; coordinates are `lat` in -90 to 90 and `lon` in -180 to 180 (Req 9.2).
- The walking-time matrix covers all ordered pairs of the listed venues, giving for each ordered pair of distinct named venues whole minutes from 0 to 240 (Req 9.3).
- Every walking time and every coordinate carries a source note that is either `official` with a URL or `estimate` (Req 9.4). A value with no official source is marked `estimate` (Req 9.5).
- A source note of `official` requires a URL whose host is `reinvent.awsevents.com` or `aws.amazon.com`; any other host is rejected, so only official AWS re:Invent pages back an `official` note.
- A test validates the whole file against the wrapper schema (Req 9.6). An entry that fails `VenueSchema` is rejected with a statement of which entry failed and why (Req 9.7).
- A connection using a venue absent from the venues list, or an ordered pair with no matrix value, is treated as unknown with a stated reason (Req 9.8, 9.9).

### Result types

Each rule returns a small result type (`BoardingResult`, `ConnectionResult`, `ClashReport`, `LayoverReport`, `EnergyResult`, `RebookResult`, `SwapPlan`) carrying either a value or an `unknown`/`notApplicable` status with reasons. These are engine-local and do not redefine any of the four shared types.

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system, essentially a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

This engine is a pure set of functions over structured inputs: boarding math, connection classification, overlap detection, timezone discipline, and composition into one verdict. That is a strong fit for property-based testing, and Req 12.1 mandates property-style tests over generated inputs. The properties below were derived from the prework analysis, with redundant criteria consolidated so each property carries unique validation value. All sample data is self-made under `packages/core/test/rules` (Req 12.5).

### Property 1: Boarding closes at start minus ten minutes

_For any_ reservable session with a usable start time and a valid event timezone, `computeBoarding` returns status "closes" at an instant exactly ten minutes before the session start, computed on the absolute instants.

**Validates: Requirements 1.1, 1.7**

### Property 2: Reservability comes from the flag, not the type name

_For any_ session whose `isReservable` is false, `computeBoarding` returns status "notApplicable" with a reason stating no reservation is needed and never returns a boarding instant; and _for any_ session, changing only its `type` string while holding `isReservable` fixed does not change whether boarding is applicable or not applicable.

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 3: Missing required field yields unknown with a reason and no value

_For any_ input missing a required field (venue, start time, end time, or reservability flag), the affected result has status "unknown", states the reason naming the missing field, and substitutes no default value.

**Validates: Requirements 1.5, 1.6, 2.5, 3.7, 11.5**

### Property 4: Missing or unrecognised timezone yields unknown for every time-dependent result

_For any_ time-dependent call, when the event timezone is absent or is not a recognised IANA name, the result has status "unknown", states that the timezone is missing or unrecognised, substitutes no default timezone, and leaves the input unchanged.

**Validates: Requirements 1.8, 3.8, 6.7, 11.3, 11.4**

### Property 5: Connection classification follows spare time against the due time, with walking minutes and a naming reason

_For any_ pair of consecutive commitments with resolvable venues and a known due time, `classifyConnection` computes walking minutes as the matrix value plus `Context.bufferMinutes`, returns comfortable when spare time is at least `tightMarginMinutes`, tight when spare time is below `tightMarginMinutes`, and impossible when arrival is after the due time, where the due time is the next item's boarding instant when reservable and its start instant otherwise; and the reason names both venues and the computed walking minutes.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.8, 2.9**

### Property 6: Missing venue, matrix value, or missing boarding yields an unknown connection

_For any_ pair where a venue is unresolved, a named venue is absent from the venues list, the ordered pair has no matrix value, or a reservable next commitment has no available boarding instant, `classifyConnection` returns "unknown" and the reason names the offending venue or commitment or states that the next item's boarding time is missing.

**Validates: Requirements 2.6, 2.7, 9.8, 9.9**

### Property 7: Clash overlap semantics with all-day expansion and a naming reason

_For any_ two commitments with usable times, `findClashes` reports a clash exactly when their event-timezone intervals overlap by one second or more, reports a clash for identical intervals, reports no clash when one ends at the instant the next starts, treats an all-day item as spanning 00:00:00 to 23:59:59 of its event day, and names both commitments and their overlapping range in the event timezone in every clash reason.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.9**

### Property 8: Meal layover reported exactly when free minutes fall short

_For any_ day schedule and meal window, `checkLayovers` reports the meal layover as missing exactly when the free minutes inside the window are below the required free minutes.

**Validates: Requirements 4.1, 4.2**

### Property 9: Long stretch reported exactly when an unbroken run exceeds the max

_For any_ day schedule and maximum stretch, `checkLayovers` reports a long stretch exactly when an unbroken run of commitments exceeds `maxStretchMinutes`.

**Validates: Requirements 4.3, 4.4**

### Property 10: Suggested blocks are complete and clash-free, or none is reported

_For any_ report that triggers suggestions, every suggested block carries a start, an end, and a reason, and does not overlap any existing commitment; and when no clash-free gap exists, the report states that none could be placed and offers zero suggestions.

**Validates: Requirements 4.5, 4.6, 4.7**

### Property 11: Energy budget formula, overload threshold and count-only fallback, and explanation

_For any_ day schedule, `scoreEnergy` returns a score equal to `(commitmentCount * 10) + totalWalkingMinutes + (venueChangeCount * 15)`, with zero walking minutes and zero venue changes for a day of fewer than two commitments; `isOverloaded` flags the day overloaded exactly when the score is strictly greater than `Context.overloadThreshold`, and its count-only fallback flags overloaded exactly when the commitment count alone is strictly greater than `Context.overloadCountThreshold`; and the explanation names the commitment count, the total walking minutes, the venue change count, and the formula, while any commitment lacking a resolvable venue or usable time is counted, excluded from the walking and venue-change totals, and named in the explanation.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9**

### Property 12: Every rebooking option matches the base code and starts after now

_For any_ base code, candidate set, and favorites, every option `findRebookingOptions` returns matches the base code for its kind (a repeat found by the `-R` suffix or by `repeatOf`, a standby favorite, or a walk-up whose `isReservable` is false or that is full), starts strictly after `Context.now` in the event timezone, and carries a reason of 1 to 200 characters; and when no candidate matches, the result has zero options and a plain-English no-alternative message.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

### Property 13: Safe swap produces the three gated steps and an outcome that matches clash and confirmation state

_For any_ swap request, `planSafeSwap` returns exactly three steps in the order reserve repeat, confirm held, cancel original, with the cancel-original step marked blocked until the confirmation schedule shows the repeat held; and the outcome is "unsafe" naming every clashing commitment when the repeat clashes with the original or any other commitment, "failed" when the confirmation schedule does not show the repeat held, and "safe" otherwise, leaving the original reservation and all inputs unchanged in every case.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

### Property 14: checkReservation returns one valid Verdict by severity precedence and never blocks on missing data

_For any_ candidate, schedule, and context, `checkReservation` returns exactly one valid `Verdict` whose decision is block if any block rule applies (a clash or an impossible connection), otherwise warn if any warn rule or missing-data case applies (a tight connection, a lost meal layover, an overload, or a rule skipped for missing data), otherwise allow; the verdict carries exactly one reason for every rule that applied; and for any candidate or schedule missing the data a rule needs, that rule is skipped rather than blocked on, the decision is at least warn, and the reasons state that the data was missing and name the rule that could not be judged.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9**

### Property 15: Invalid venue entries are rejected with a naming reason

_For any_ venue entry that violates `VenueSchema`, validating the `Venue_Data` rejects it and the error states which entry failed and why.

**Validates: Requirements 9.7**

### Property 16: Inputs are never mutated

_For any_ exported function, every input value is deeply equal to its pre-call snapshot after the call returns.

**Validates: Requirements 10.6, 6.7, 7.3, 7.5**

### Property 17: The same instants give identical results across an offset change

_For any_ schedule, the same absolute instants give identical boarding, connection, and clash results across a change in the event timezone offset (the results do not shift by any number of minutes), while day bucketing and meal-window placement use event-timezone local wall-clock time.

**Validates: Requirements 1.7, 2.10, 3.6, 4.8, 5.8, 6.6, 7.7, 11.1, 11.2**

### Property 18: Every produced string is plain English with no em dash or en dash

_For any_ reason or warning string the engine can produce, the string contains no em dash and no en dash, and every sentence in it is 20 words or fewer.

**Validates: Requirements 8.10, 11.6, 12.3**

## Error Handling

The engine never throws for an expected uncertainty. Expected uncertainty (missing timezone, missing venue, missing start or end time, a venue absent from the matrix, a reservable item with no boarding) is a first-class result, not an exception. This keeps purity guarantees intact and lets `checkReservation` always return one `Verdict`.

- **Missing or invalid timezone.** Every time-dependent function returns an "unknown" result stating the timezone is missing or unrecognised, substituting no default (Req 11.3, 11.4). `time.ts` validates the IANA name once by attempting an `Intl.DateTimeFormat` construction inside a guard and treating a thrown `RangeError` as "unrecognised"; this is the single place a platform error is caught and converted to a result.
- **Missing required field.** Boarding, connections, clashes, and energy each return "unknown" for the affected result with a reason naming the field, and never substitute a default (Req 1.5, 1.6, 2.5, 3.7, 5.7, 11.5).
- **Missing matrix value or unknown venue.** Connections return "unknown" naming the offending venue (Req 2.6, 9.8, 9.9). Energy excludes that commitment from walking and venue totals but still counts it, and names it (Req 5.7).
- **Invalid venue data.** `VenueDataSchema` (reusing `VenueSchema`) rejects an invalid entry with a `ZodError` whose message names the failing entry and reason; the file-validation test asserts this (Req 9.7). The engine does not parse the file at runtime; callers parse it and pass `VenueData` in through `Context`.
- **Guardrail composition.** `checkReservation` treats any lower-level "unknown" as a skipped rule: it never blocks on it, it raises the decision to at least warn, and it adds a reason naming the rule (Req 8.7). It throws nothing.
- **Reason text safety.** All reason text flows through `reasons.ts`, the single place that keeps output free of em and en dashes and within the 20-word sentence limit (Req 8.10, 11.6). A test asserts this across every producible string (Req 12.3).

## Testing Strategy

The engine is pure logic over structured inputs, so property-based testing is the primary strategy, complemented by targeted example tests for specific defaults and edge shapes, and smoke tests for the data file and the purity guarantees. Tests live in `packages/core/test/rules/**`, mirroring `src`, with files named `<module>.test.ts`. All sample data is self-made in those test files; tests never read `fixtures/synthetic` (Req 12.5, ADR-025).

### Property-based tests

- **Library.** Use `fast-check` with `vitest 4` (the project's test runner). The engine does not implement property-based testing from scratch. `fast-check` is already present at the repo root, so no install is requested. `zod` is now declared in `packages/core` (integrator commit b5c22cd), so `ContextSchema` and `VenueDataSchema` import it directly.
- **Iterations.** Each property test runs a minimum of 100 iterations.
- **Tagging.** Each property test carries a comment referencing its design property in the format: `// Feature: itinerary-rules, Property {number}: {property_text}`.
- **One test per property.** Each of the 18 correctness properties is implemented by a single property-based test.
- **Generators.** Self-made arbitraries build `NormalisedSession`, `Commitment`, `SessionsLookup`, `VenueData`, and `Context` values. Generators deliberately cover the Req 12.1 edge cases: a commitment that crosses midnight, an all-day item, a missing venue, a missing end time, identical start and end instants, and date arithmetic across a daylight saving time change. Each edge-case property asserts the exact verdict or result the engine returns.

### Example and edge-case tests

- The default meal window is 11:30 to 14:00 needing 30 free minutes (Req 4.2) and the default maximum stretch is 180 minutes (Req 4.3); concrete example tests assert these defaults, while the override behavior is covered by Properties 8 and 9 driving the values from `Context`.
- Concrete worked examples anchor boarding (Property 1), one comfortable, one tight, and one impossible connection (Property 5), and a clash across midnight and a touching-at-one-instant no-clash pair (Property 7), so a reader can see representative outputs.
- Determinism (Req 10.5) is asserted by an example test that calls each exported function twice on deeply equal inputs and checks the results are deeply equal. It is an example test, not a property test, because the behavior does not vary with input.

### Smoke and static tests

- **Venue data validation (Req 9.1 to 9.6).** A single test parses `data/venues.json` with `VenueDataSchema` and asserts it is a wrapper object (not a bare array), every venue name is non-empty, coordinates are within range, every matrix value is a whole number from 0 to 240, and every value carries a valid source note.
- **Node built-in import scan (Req 10.2, 12.4).** A single test scans the owned source files and their transitive imports and fails if any Node built-in import is found.
- **Impurity static scan (Req 10.1, 10.2).** A static scan fails if the engine source under `packages/core/src/rules` contains any of: `node:`, `fs`, `path`, `process`, `Buffer`, `Date.now(`, `new Date()`, or `Math.random`. This proves the engine performs no I/O, reads no clock, and imports nothing from Node built-ins.
- **Browser-safe execution (Req 10.1, 10.3).** A single test imports through `@compass/core/rules` and invokes every exported function, asserting no reference error for a missing runtime global and no I/O.
- **Shared-type usage (Req 10.4).** A structural test asserts the four shared types are imported from `@compass/contracts` and not redefined locally.
- **Test-data policy (Req 12.5).** A guard asserts no test under `test/rules` reads from `fixtures/synthetic`.

### Coverage

- `vitest` v8 coverage is configured to require 100 percent of lines, branches, functions, and statements over the files this spec owns, with the only permitted exclusions being the generated types named in the build plan. The run fails if any owned file falls below 100 percent on any of the four measures (Req 12.2).

## Requirements Mapping

| Requirement                            | Addressed by                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Boarding time                        | `boarding.ts` (`computeBoarding`); Properties 1, 2, 3, 4, 17; boarding example test                                                                                  |
| 2 Connections                          | `connections.ts` (`classifyConnection`), `venue-data.ts`; Properties 3, 5, 6, 17; connection example tests                                                           |
| 3 Clashes                              | `clashes.ts` (`findClashes`); Properties 3, 4, 7, 17; midnight and touching example tests                                                                            |
| 4 Layovers and personal time           | `layovers.ts` (`checkLayovers`); Properties 8, 9, 10; default-window example tests                                                                                   |
| 5 Energy budget                        | `energy.ts` (`scoreEnergy`, `isOverloaded`); Property 11                                                                                                             |
| 6 Rebooking options                    | `rebooking.ts` (`findRebookingOptions`); Properties 4, 12, 16                                                                                                        |
| 7 Safe swap                            | `safe-swap.ts` (`planSafeSwap`); Properties 13, 16, 17                                                                                                               |
| 8 checkReservation guardrail           | `check-reservation.ts` (`checkReservation`), `reasons.ts`; Properties 14, 18                                                                                         |
| 9 Venue data file                      | `data/venues.json`, `venue-data.ts` (`VenueDataSchema`); Properties 6, 15; venue-data validation smoke test                                                          |
| 10 Purity and browser safety           | module structure, `context.ts`; Property 16; determinism example test (Req 10.5); Node-import scan, impurity static scan, browser-safe, shared-type structural tests |
| 11 Timezone and uncertainty discipline | `time.ts`, `resolve.ts`, `reasons.ts`; Properties 3, 4, 17, 18                                                                                                       |
| 12 Testing and coverage                | Testing Strategy; property tests at 100 iterations, coverage gate, no-dash test, Node-import scan, self-made-data guard                                              |

## Implementation deviations and clarifications

Recorded by the implementer (Claude, after the owner's Kiro credits ran out). Each item is a change from, or a clarification of, the design above.

1. `SourceNote` gains an optional `basis` string. An estimate may state its plain-English basis, so an estimate is traceable. It is ignored by every rule.
2. `ContextSchema` is first built on a structural venue data shape (`VenueDataShapeSchema` in `context.ts`). The strict `VenueDataSchema` arrives with `venue-data.ts` and then replaces it inside `ContextSchema`.
3. `time.ts` converts wall-clock time to an instant with `instantAt(day, minutesOfDay, seconds, zone)`. It reads the offset a day before and a day after, keeps only candidates whose own wall-clock time matches, and takes the earlier one on a fall-back overlap. This is a robust form of the two-pass correction. In a spring-forward gap, where the local time does not exist, the time moves forward by the gap. `toZonedIso` and `formatLocal` work in whole seconds. `dayBounds` gives the instants where a local day and the next local day start, so a day on a daylight saving change is 23 or 25 hours long.
4. `reasons.ts` caps every caller-supplied name at four words and 30 characters (`label`) and every time or day stamp at two words (`stamp`), and replaces any em dash, en dash or horizontal bar with a hyphen (`clean`). This is how the 20-word sentence rule and the no-dash rule hold even for odd input. A commitment is named in reasons by its session code (or its title for personal time), not its full title.
5. `VenueEntry` gains an optional `nameSource` note, so the official page where a venue name was found is recorded. The `official` URL check is a pattern on `https://<host>` with no user info and no port, because `core` is compiled without the `URL` type (browser and Node type libraries are not part of its lib set). The host must be exactly `reinvent.awsevents.com` or `aws.amazon.com`.
6. `VenueDataSchema` also rejects a matrix that names an unlisted venue, repeats an ordered pair, or leaves an ordered pair of listed venues without a value, and rejects duplicate venue names. `validateVenueData` returns every problem as `path: reason`, for example `venues[2].venue.coordinates.lat: the latitude must be from -90 to 90`. `ContextSchema` now uses `VenueDataSchema`.
7. `data/venues.json` holds the six properties named on the official AWS re:Invent FAQ (Caesars Forum, Caesars Palace, Encore, MGM Grand, The Venetian, Wynn), each with a `nameSource` pointing at that page. No official page publishes coordinates or a walking time for any pair of venues, so no coordinates are given and all 30 walking times are `estimate` notes. Each estimate is 30 minutes, the low end of the official guidance to allow 30 to 45 minutes between or within venues (Analyst Summit page), and its `basis` says so. The owner should replace these with measured values.
8. `resolve.ts` also exports `SessionsLookup`, `ScheduleInput`, `usableTime`, `sessionReservability`, `sessionRef` and `sessionToCommitment`. A session absent from the lookup still resolves its venue from `Commitment.venue` (the Venue_Resolution order), but has unknown times and reservability. A personal time resolves with `isReservable` false, because it needs no reservation, so its due time is its start. A commitment is named in reasons by its session code, then title, then the commitment title, then its id. Shared test helpers live in `packages/core/test/rules/helpers.ts`.
9. `boarding.ts` also exports `boardingFor(input, context)`, which works on already resolved facts and is shared with the connection layer and the guardrail, and `BOARDING_OFFSET_MINUTES` (10). Checks run in a fixed order: timezone, reservation flag, then start time. So a session flagged not reservable is "notApplicable" even when its start time is missing, because the flag is certain and needs no start.
10. `ConnectionResult` also carries `spareMinutes` (negative when the attendee would be late). Both `walkingMinutes` and `spareMinutes` are absent when the connection is unknown. `classifyConnection` also returns "unknown" when the first commitment has no usable end time, or when a non-reservable next commitment has no usable start time, and the reason names that commitment. The timezone check comes first, then venues, then the matrix, then times.
11. `ClashReport` is `{ status: 'ok'; clashes; unknown } | { status: 'unknown'; reason }`. Status "unknown" is only for a missing or unrecognised timezone. A commitment with a missing end (or start) time goes in the `unknown` list with a reason naming it, and takes part in no pair, so one bad item does not hide every other clash (Req 3.7). `ClashPair` also carries `aIndex` and `bIndex` (positions in the input) so the guardrail can tell which commitment is the candidate. An all-day item needs only a start time: it occupies the whole event day of that start. A zero-length item clashes only with an item that has the identical start and end (Req 3.4), because it overlaps nothing by a second. `intervalOf` and `intervalsClash` are exported for reuse by the layover and swap code.
12. `LayoverReport` is reported per event day: `{ status: 'ok'; days: DayLayover[]; skipped } | { status: 'unknown'; reason }`. Each `DayLayover` carries `mealLayoverMissing`, `freeMealMinutes`, an optional `longStretchMinutes` (the longest unbroken stretch, only when over the maximum), `reasons`, `suggestions` and an optional `noPlacementReason`. `checkLayovers(schedule, context, onlyDay?)` takes an optional local day so the guardrail can ask about one day. Only days that have a commitment are reported. All-day items are left out of the meal and stretch checks, and commitments with no usable start or end are listed in `skipped`. Stretches are built from the commitments that start on that day, and touching commitments form one stretch.
13. Meal block placement differs from the design wording. If free time in the meal window is below the need, no single gap inside the window can be long enough, so the meal block is placed in the clash-free gap of the day that lies nearest the window (the block is as long as the required free minutes). A rest block is `REST_BREAK_MINUTES` (15) long and goes right after the longest long stretch, or right before it when the gap after is not clear or runs past the day. Only the longest long stretch gets a rest block. Placed blocks never overlap each other. `noPlacementReason` joins the reason for each block that could not be placed.
14. `findRebookingOptions` takes a base code with or without a `-R` suffix (`baseCodeOf` strips it). A repeat is a candidate whose code is the base code plus `-R`, or whose `repeatOf` equals the base code. A walk-up option is a candidate for the base code whose reservation flag is present and false, or whose `seatAvailability` is `unavailable` or `walkUp` ("full"). A session that fits several kinds is listed once, under the first of repeat, standby, walk-up. Options are sorted by start time. An unusable `Context.now` also gives status "unknown" with zero options and a message.
15. `SwapPlan.outcome` has a fourth value, `unknown`, used when the timezone is missing or unrecognised or the repeat has no usable start or end time (the swap cannot be checked; the original is still left unchanged). Clash checks reuse `findClashes` on the repeat plus every commitment in the confirmation schedule (except the repeat's own entry) plus the original, added when the confirmation schedule leaves it out. A clash is checked before the held check, so a clashing repeat is `unsafe` even when it is not held yet. `blockedUntilConfirmed` is true only on the cancel step, and stays true unless the outcome is `safe`. `safe` therefore needs a call made after the repeat was reserved and read back; before that the outcome is `failed`.
16. `checkReservation` composes `findClashes`, `classifyConnection`, `checkLayovers` and `isOverloaded`. Clash and connection reasons come from those rules (a connection reason is prefixed "Tight connection." or "Impossible connection."). A neighbour that already clashes with the candidate is reported once, as a clash, and is not judged again as a connection. The meal rule and the overload rule compare the schedule without the candidate against the schedule with it, and warn only on a change from fine to bad. A missing timezone, or a candidate with no usable start or end, skips all four rules, each named. A schedule commitment with no usable end or start skips the clash rule; one with no usable start also skips the energy rule; a commitment with no usable times skips the meal rule. An all-day candidate is checked for clashes only. Rule names in reasons are "clash check", "connection check", "meal break check" and "energy check".
17. `energy.ts` is created in task 14 holding only `isOverloaded`, backed by the count-only fallback (more than `overloadCountThreshold` commitments). Task 16 adds the full formula behind the same interface.
18. The public surface in `index.ts` lists these by name. Values: `checkReservation`, `computeBoarding`, `boardingFor`, `classifyConnection`, `findClashes`, `checkLayovers`, `isOverloaded`, `findRebookingOptions`, `planSafeSwap`, `resolveCommitment`, `withContextDefaults`, `ContextSchema`, `CONTEXT_DEFAULTS`, `VenueDataSchema`, `validateVenueData`. Types: `Context`, `ContextInput`, `MealWindow`, `SourceNote`, `VenueData`, `VenueEntry`, `WalkingEdge`, `ResolvedCommitment`, `ScheduleInput`, `SessionsLookup`, `BoardingInput`, `BoardingResult`, `ConnectionClass`, `ConnectionResult`, `ClashPair`, `ClashReport`, `DayLayover`, `LayoverReport`, `SuggestedBlock`, `OverloadResult`, `RebookOption`, `RebookResult`, `SwapPlan`, `SwapStep`, `VenueDataValidation`. Beyond the original list, `resolveCommitment` and `withContextDefaults` are exported at the integrator's request (the S3 and S7 specs build the resolved view that `classifyConnection` takes, and a complete Context). `boardingFor` is exported because `classifyConnection` also takes the next commitment's boarding result, `VenueDataSchema` and `validateVenueData` because callers parse `data/venues.json`, and `CONTEXT_DEFAULTS` so the defaults have one public home. `scoreEnergy` joins in task 16. Time, reason and lookup helpers stay internal.
19. The impurity static scan matches `fs`, `path` and `process` as Node module imports and `process.` or `Buffer` global use, not as bare words, because zod issue objects legitimately have a field named `path`. It also forbids `console.`, timer calls and network globals. The Node built-in scan follows relative imports and the `@compass/contracts` source, and checks that the only third-party package reached is `zod`.
20. `energy.ts` now holds the full formula. `scoreEnergy(dayCommitments, context)` returns `EnergyResult` with `missingDataNotes`. `isOverloaded` is backed by it (score strictly above `overloadThreshold`), and the count-only fallback lives on as `isOverloadedByCount` (count strictly above `overloadCountThreshold`). `checkReservation` is unchanged and still calls only `isOverloaded`, so its overload warning now names the full energy explanation. A commitment is "placeable" when it has a venue, a start, and (unless all-day) an end. Unplaceable commitments are counted and named. All-day items are counted but not sequenced. A consecutive pair whose walking time is unknown (a venue not in the list, or no matrix value) adds no minutes, still counts as a venue change when the names differ, and is named. `scoreEnergy` is exported from the index with the `EnergyResult` type.
21. Two per-day helpers are exported from the index at the integrator's request, in `day-view.ts`, so the MCP server and the site never rebuild the internal commitment resolution. `connectionsForDay(schedule, context, day?)` returns `{ status: 'ok'; connections; skipped } | { status: 'unknown'; reason }`, where each connection is `{ from, to, result }` between consecutive commitments in time order, using `classifyConnection` with `boardingFor`. `energyForDay(schedule, context, day?)` returns `{ status: 'ok'; energy; skipped } | { status: 'unknown'; reason }`, where `energy` is the `scoreEnergy` result. The optional `day` is a local day (YYYY-MM-DD). With a day, only commitments that start on that event day are used. Without one, the whole schedule is treated as one day. All-day items are left out of the connection list. A commitment with no usable start cannot be placed on a day and is listed in `skipped` with a reason. Types `DayConnection`, `DayConnections`, `DayEnergy` and `DaySkipped` are exported too. `resolveCommitment` and `withContextDefaults` stay exported (note 18).

## Review fixes (security and QA)

Changes made after the security and QA reviews. Each item changes behaviour described above.

22. **Context validation (security H1).** `withContextDefaults` ignores undefined values, so an undefined never replaces a default. `ContextSchema` is strict: finite numbers, `bufferMinutes` 0 to 120, `tightMarginMinutes` 0 to 60, `maxStretchMinutes` 1 to 1440, `requiredFreeMinutes` 0 to 1440, overload thresholds finite and above 0, a meal window that ends after it starts, and a text `eventTimezone`. The limits are exported as `CONTEXT_LIMITS`. `checkReservation` validates the whole Context, venue data included, and on failure returns `warn` with a reason naming the setting (or "context"), never `allow`. `classifyConnection` returns `unknown` when the spare time is not finite.
23. **Bad time order (security H2).** A non-all-day commitment whose end is not after its start resolves with the `order` marker. `intervalOf` returns `{ missing: 'order' }` for it, so it is "unknown" in the clash check, skipped in the layover check, not placeable for energy and unknown as the start of a connection, and a candidate like that gives `warn` on all four rules. This supersedes the earlier rule that identical zero-length items clash (note 11): such items are now bad data. `intervalsClash` still treats a zero-length point strictly inside another interval as a clash when called on raw intervals.
24. **Venue data trust (security H3).** `VenueDataSchema` requires at least 1 minute for each pair of distinct venues. An `official` source note needs an https URL whose host and path prefix are allowlisted (`OFFICIAL_SOURCES`: `aws.amazon.com` under `/events/reinvent` and `/resources/analyst-summit`, and any path on `reinvent.awsevents.com`), no port and no user info, and a `retrievedOn` date. `SourceNote` gains `retrievedOn`.
25. **Fail closed (security H3).** `checkReservation` never throws. Any unexpected error gives `block` with the fixed reason "An internal error stopped the check. The reservation is blocked to be safe." Consumers must still treat a throw from their own call path as a block.
26. **Performance (security H4).** One `Intl.DateTimeFormat` per zone and purpose is cached in a bounded module-level map (memoisation only, same input gives the same output). `findClashes` sweeps by sorted start time instead of testing every pair, and still reports clashes in input order. `checkReservation` returns `warn` ("schedule too large") above `MAX_COMMITMENTS` (200). A test checks that 200 commitments take under 500 ms.
27. **Safe swap and unchecked commitments (security M1).** `planSafeSwap` returns `unknown` when `findClashes` lists any commitment other than the repeat as unknown (bad or missing times), because a clash cannot be ruled out. A known clash is still `unsafe` first. The reason names the commitment that could not be checked.
28. **Caller text (security M2).** `label()` drops control characters, line and paragraph separators (turned into spaces) and format characters (removed), replaces a double quote with a single quote, caps the name at four words and 30 code points (counted with `Array.from`, so an emoji is never split), and treats anything that is not text as missing ("unnamed item"). Every template shows names in double quotes through `q()`. `resolve.ts` treats non-text venue, code, title, time and reservation values, and a `missingFields` that is not a list, as missing instead of throwing. Reasons are plain text and consumers must render them as plain text only, never as HTML or markup.
29. **Dates and timezones (security low L2 and L3, QA M9).** `parseInstant` accepts only a real calendar date in the years 2000 to 2100 (2026-02-31 is refused, not rolled forward), an hour 0 to 23, a minute and second 0 to 59 and an offset hour 0 to 23 and minute 0 to 59, and anything that is not text is not a time. `isCalendarDate` is exported from `time.ts` (internal) and also checks the `retrievedOn` date of venue data. `checkZone` takes any value: absent, null or empty is "missing", and a value that is not text, or starts with + or -, is "unrecognised".
30. **Purity scans (security low L1).** The static scans walk `src/rules` recursively, so a future subfolder is covered. A runtime test makes `Date.now`, `Math.random`, `performance` and `fetch` throw and then runs `checkReservation` and every other exported function, proving none of them is called.
31. **Estimated walks never block (QA H1).** `ConnectionResult` carries `estimate` (true when the walking time is an estimate). In `checkReservation`, an impossible connection on an estimate is a warning ("Likely impossible connection", with a note to check it), and only an impossible connection on an official walking time blocks, as does a clash. Two places in one venue are a 5 minute room-to-room estimate (`SAME_VENUE_WALK_MINUTES`), never 0. Connection reasons state the walk, the buffer and the total in separate sentences, for example "The walk from A to B is 30 minutes, an estimate. With a 10 minute buffer, you need 40 minutes." The energy explanation adds "The walking minutes are estimates." when any walk it used is an estimate (every same-venue walk is). Spare time is shown rounded down and lateness rounded up (QA L1), so the words match the class.
32. **Repeats and the original (QA M1, L4).** A repeat suffix is `-R`, `-R1`, `-R2` and so on, in any case, and base codes are compared without regard to case. `baseCodeOf` strips only the last suffix and treats a value that is not text as empty. A blank base code matches nothing (status "ok", zero options). `findRebookingOptions` takes an optional fifth argument `originalSessionId`, and that session is never offered as its own alternative.
33. **Timing and seats (QA M2).** `checkReservation` reads `Context.now`. It warns when the candidate has already ended ("in the past"), and when boarding has closed (now is at or after start minus 10 minutes, for a reservable session; a session that needs no reservation has no boarding to miss). It warns when the session has no seats left or is walk-up only (`isSeatFull`: `seatAvailability` is `unavailable` or `walkUp` and the session is not known to need no reservation). An unusable `now` is reported as missing data for a "timing check" rule, so the verdict is at least `warn`. These checks come after the four original rules, so existing reason order is unchanged.
34. **Neighbours (QA M3, M4, M6).** The connection rule judges the nearest earlier and later commitment within 12 hours (`NEIGHBOUR_WINDOW_HOURS`), across midnight, instead of the same event day. A reserved commitment whose session is not in the lookup falls back to the commitment's own `startsAt` and `endsAt` (its reservability stays unknown); a session that is in the lookup is never second-guessed. Personal time with no location means "stay put": it is no longer missing data (`ResolvedCommitment.stayPut`, no `venue` in `missing`), `inheritStayPutVenues` gives it the venue of the commitment before it in time order, no connection is drawn into it, and a stay-put item with nothing before it has no venue to leave from, so its connection is skipped with no "unknown". `connectionsForDay` follows the same rule, and the energy score counts stay-put time but neither sequences it nor names it as missing data.
35. **Safe swap and time (QA M10).** `safe` means only that nothing overlaps (no clash and the repeat is held). It does not say the walks are comfortable or that seats are available. `planSafeSwap` returns `unknown` when `Context.now` is unusable, and when the repeat has already ended relative to `Context.now`.
36. **Researched walking times (owner decision).** This replaces the uniform 30 minute estimates in note 7. All 30 ordered pairs in `data/venues.json` now carry a researched per-pair estimate, symmetric in both directions: OSRM foot distance on OpenStreetMap data (FOSSGIS routing matrix, with Nominatim venue coordinates), minutes = round up to 5 of (distance in metres / 66.7 metres per minute + 15 minutes for getting out of one building and into the next), using the longer of the Venetian hotel and Venetian Expo distances for The Venetian. A floor of 30 minutes is applied to every cross-venue pair to match the official AWS guidance to allow 30 to 45 minutes between or within venues, so Encore and Wynn is 30 (the formula gave 25). Each `estimate` note carries a `basis` with the distance, the OSRM URL, the arithmetic, the floor and, for the direct routes AWS lists (Forum to Venetian, Encore to Wynn, Wynn to Venetian, Encore to Venetian through Wynn), the AWS page. Coordinates stay absent because no official source publishes them. AWS publishes no per-pair times, so every value stays an `estimate`. The venue names still come from the official FAQ, with a retrieval date of 2026-10-17. The values are planning estimates and a guardrail that relies on them only warns (note 31).

## Final follow-ups (integrator policy rulings)

37. **Walk policy.** An estimated walk already includes a 15 minute building allowance (`BUILDING_ALLOWANCE_MINUTES`), so for an estimate edge, including the 5 minute same-venue estimate, the connection total is `walk + max(0, bufferMinutes - 15)` (`extraBufferMinutes`). The default 10 minute buffer therefore adds nothing on estimates. An official edge keeps `walk + buffer`. Reasons say "It includes time to leave and enter buildings." and either "With a N minute buffer, you need T." or "No extra buffer is added, so you need T." `classifyConnection` returns `certain` on an impossible result: true for an official walk, and for an estimate when the attendee would still be late at half of the total (that is, the gap is under half the walk plus the 10 minute boarding rule). `checkReservation` blocks on a certain impossible connection ("Impossible connection") and warns on one that is only late at the full estimate ("Likely impossible connection"). The energy score uses the same totals. This refines note 31 (an impossible connection on an estimate no longer always warns).
38. **Venue data integrity and aliases.** A test pins the SHA-256 of `data/venues.json` (line endings normalised to LF); changing the data means updating the pin in the same commit. Official URLs refuse `?`, `#`, `%` and `.` or `..` path segments, and the host is compared in lower case. `VENUE_LIMITS` caps names (100 characters), URLs (300), notes (2000), aliases per venue (10), venues (50) and walking times (2500). `VenueEntry.aliases` is an optional list of `{ name, source }` spelling variants. A name or alias is matched case-insensitively after trimming, must be unique across all venue names and aliases, and an edge may use an alias. `lookupWalk` and the energy score treat two spellings of one venue as the same venue (`sameVenue`). The data has aliases for The Venetian ("Venetian", official from the AWS analyst summit page, plus the estimate-marked variants "The Venetian Expo" and "Venetian Expo") and for Wynn ("Wynn Las Vegas", official from the same page). "Caesars Forum Conference Center" is not added because no AWS page that was read uses it. Mandalay Bay stays unknown.
39. **Fail-closed flag, limits and names (security N3 to N6).** `checkReservation` returns `CheckedVerdict`, a `Verdict` that also carries `internal: true` on the one verdict that means the check itself failed (the fixed internal-error block), so a consumer can tell it apart from a verdict about the reservation. The other exported functions trust their typed inputs and may throw on malformed ones: consumers call `checkReservation`, or wrap them in a try/catch and treat a throw as "block" or "unknown". A name with no letter or number (`\p{L}` or `\p{N}`) is shown as "unnamed item". The guardrail returns `warn` when the sessions lookup has more than 2000 keys (`MAX_SESSIONS`). A stay-put item with nothing before it gives an unknown connection with the reason "The venue before this is unknown" in the guardrail, and an entry in `skipped` in `connectionsForDay`, instead of a silent skip. The neighbour logic now lives in the internal `neighbours.ts` (`connectionsAround`), shared by the guardrail and the swap check.
40. **Safe swap, original and reachability (QA N3).** `planSafeSwap` now returns `unknown` instead of `safe` when the original reservation is missing from the confirmation schedule (the read-back may be the wrong schedule), or when the repeat has a certainly impossible connection (an official walk, or late even at half an estimated walk) to its nearest earlier or later commitment within 12 hours. The original is not counted as a neighbour, because it is about to be cancelled. These two checks run last, so a known clash is still `unsafe` and a repeat that is not held is still `failed`. Only a stay-put commitment with no known venue produces no certain impossibility, so it does not block `safe`. This refines notes 15 and 35.

## Real catalog shape (SP5)

41. **Repeat groups and -S codes.** The SP5 spike (`docs/spikes-results.md`) found that in the real catalog a repeated session never has an unsuffixed code: the first offering is `<code>-R` and later ones are `-R1` to `-R4`. The rules already matched repeats by base code, so siblings are found without an original. `sameRepeatGroup(a, b)` (exported from `rebooking.ts`, internal to the package) makes that rule explicit: two codes are in one group when they have the same non-empty base code, in any case. An `-S` code is not a repeat marker (SP5: 297 real codes end in `-S`, none has an unsuffixed sibling, and `-S-R`, `-S-R1` repeat the `-S` code). So `ABC123-S` has the base `ABC123-S`, is never offered as a repeat of `ABC123`, and `ABC123-S-R1` is a repeat of `ABC123-S` only. `planSafeSwap` refuses (`unknown`, reason "The repeat is not another offering of the original session") when the repeat is the same session as the original (checked first), or, in the place where it would otherwise say `safe`, when the original's session is in the lookup, both codes are known, and they are not in the same group. A known clash is still `unsafe` and a repeat that is not held is still `failed`. A held `ABC123-R2` can swap to `ABC123-R4`. With no original code to compare (a personal time, or a session not in the lookup) there is no refusal.
42. **Missing seat availability.** The real API leaves `seatAvailability` out of sessions that cannot be reserved (780 of 2245 on 18 October). `isSeatUnknown` is true for a session that may need a reservation when the value is missing, `unknown` or not a known band. `checkReservation` skips a "seat check" for it with a reason (so the verdict is at least `warn`), and never reads it as available. A session known to need no reservation (`isReservable` false) is never "unknown" for this purpose. `isSeatFull` and the rebooking rules already treated a missing value as neither full nor available, and none of them crash on it. Nothing in the rules reads `sessionTime.timezone`, which is never present in the real data: times come from `startsAt` and `endsAt` and the event timezone from Context.
