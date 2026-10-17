# Implementation Plan: Itinerary Rules Engine (S2)

## Overview

Convert the itinerary rules design into incremental coding steps for `packages/core/src/rules` (stream S2). The engine is a pure, browser-safe set of functions reused by the site, the MCP server, and the Kiro hook through the `@compass/core/rules` subpath export, which already exists in `packages/core/package.json`.

Each task builds on the previous ones: internal helpers first (`context.ts`, `time.ts`, `reasons.ts`, `venue-data.ts`, `resolve.ts`), then the exported rule functions, then the `checkReservation` guardrail that composes them, and finally `index.ts` wiring and the cross-cutting static and purity tests. The full energy budget formula is built last, as the design and cut-list require. No step leaves orphaned code; every module is re-exported or consumed by a later step.

All code is TypeScript 6 strict (the design is written in TypeScript, so no language choice is needed). Files are kebab-case under `packages/core/src/rules`. The owned data file is `data/venues.json`. Tests live in `packages/core/test/rules/**` mirroring `src`, named `<module>.test.ts`, with vitest 4 and `fast-check`, at least 100 iterations per property, and 100 percent coverage over owned files. All sample data is self-made under `packages/core/test/rules`; tests never read `fixtures/synthetic` (Req 12.5, ADR-025). No em dash or en dash anywhere, including comments and test names.

Shared types `Verdict`, `Venue`, `NormalisedSession`, and `Commitment` are imported from `@compass/contracts` and never redefined (Req 10.4). Dependencies `zod` and `fast-check` are already available; do not run `npm install` (see workflow.md).

## Execution rules for this plan

- **Do the work in this chat.** Each task is implemented directly here, saving files after each step. Do not delegate tasks to a task-execution subagent.
- **Sequential only.** Run tasks in numeric order, one at a time. There is no parallel wave execution.
- **No optional tasks.** Every task, including every test, is required. S2's definition of done needs 100 percent coverage.
- **File ownership boundary.** Only these paths may be touched: `packages/core/src/rules/**`, `packages/core/test/rules/**`, `data/venues.json`, and `.kiro/specs/itinerary-rules/`. Never edit `packages/contracts/**`, `contracts/**`, `package.json`, or `package-lock.json`. If a dependency or a contract change is needed, stop and tell the owner; do not run `npm install`.
- **Commit at the end of every top-level task.** After that task's tests pass, make one local commit. Use Conventional Commits with scope `itinerary-rules`, supplying the subject and body through separate `-m` flags (never a commit message file). No em dash or en dash in any commit message. Never push, merge, tag, or open a PR. The first commit (task 1) also includes `.kiro/specs/itinerary-rules/`.

## Tasks

- [x] 1. Establish the context, schema, and defaults foundation
  - [x] 1.1 Implement `context.ts` with `Context`, `MealWindow`, `SourceNote`, `WalkingEdge`, `VenueEntry`, and `VenueData` types, `ContextSchema` (zod), and `withContextDefaults`
    - Define the engine-local types exactly as in the design, importing `Venue` from `@compass/contracts` for `VenueEntry.venue`
    - `withContextDefaults` fills every tuning value with its documented default: mealWindow 11:30 to 14:00 needing 30 free minutes, maxStretchMinutes 180, overloadThreshold 100, overloadCountThreshold 6, tightMarginMinutes 5, bufferMinutes 10; `now` has no default and is always supplied by the caller
    - `ContextSchema` name ends in `Schema`; do not redefine any shared type
    - _Requirements: 4.2, 4.3, 5.3, 10.4, Glossary Context_
  - [x] 1.2 Write example tests for context defaults
    - Assert `withContextDefaults` produces the documented defaults and that `now` is required
    - _Requirements: 4.2, 4.3, 5.3_
  - [x] 1.3 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push. This first commit also stages `.kiro/specs/itinerary-rules/`

- [ ] 2. Implement the internal time toolkit
  - [ ] 2.1 Implement `time.ts` instant arithmetic and `Intl` wall-clock bucketing
    - Parse ISO 8601 strings with offset to absolute instants; compute duration and elapsed minutes on instants
    - Read local wall-clock fields through `Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23" })`, always passing a `Date` to `formatToParts`; bucket by event day and place meal windows on local wall-clock minutes
    - Convert wall-clock to instant with a two-pass offset correction where the earlier offset wins on a fall-back overlap; read offsets from the `longOffset` part
    - Validate the IANA timezone by guarded `Intl.DateTimeFormat` construction, treating a thrown `RangeError` as unrecognised, and reject any value starting with `+` or `-`; do not use `Temporal`
    - Use only the `Intl` global and standard ECMAScript; no Node built-in imports, no `Date.now()`, no `new Date()` for current time, no `Math.random`
    - _Requirements: 1.7, 3.6, 11.1, 11.2, 11.3, 11.4, 10.1, 10.2_
  - [ ] 2.2 Write property test for offset-change stability
    - **Property 17: The same instants give identical results across an offset change**
    - **Validates: Requirements 1.7, 2.10, 3.6, 4.8, 5.8, 6.6, 7.7, 11.1, 11.2**
  - [ ] 2.3 Write property test for missing or unrecognised timezone handling in time helpers
    - **Property 4: Missing or unrecognised timezone yields unknown for every time-dependent result**
    - **Validates: Requirements 1.8, 3.8, 6.7, 11.3, 11.4**
  - [ ] 2.4 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 3. Implement the plain-English reason builders
  - [ ] 3.1 Implement `reasons.ts` as the single source of reason and warning strings
    - Centralise every reason and warning string so no em dash or en dash reaches output and each sentence stays within 20 words
    - Provide builders that name venues, commitments, walking minutes, overlapping ranges, and missing fields as required by the rule layers
    - _Requirements: 8.10, 11.6, 12.3_
  - [ ] 3.2 Write property test for plain-English, no-dash strings
    - **Property 18: Every produced string is plain English with no em dash or en dash**
    - **Validates: Requirements 8.10, 11.6, 12.3**
  - [ ] 3.3 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 4. Implement venue data loading, validation, and matrix lookup
  - [ ] 4.1 Create the owned `data/venues.json` wrapper file
    - A wrapper object (not a bare `Venue` array) with `venues` and `walkingTimes`, covering only main re:Invent 2026 venues named on official AWS pages
    - Each venue carries a non-empty name and optional in-range coordinates; the matrix covers every ordered pair of distinct named venues with whole minutes 0 to 240; every value carries a source note defaulting to estimate, with official requiring a URL on `reinvent.awsevents.com` or `aws.amazon.com`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ] 4.2 Implement `venue-data.ts` with `VenueDataSchema` and matrix lookup
    - `VenueDataSchema` reuses `VenueSchema` from `@compass/contracts` for each venue entry and rejects an invalid entry with a message naming which entry failed and why
    - Provide an in-memory ordered-pair walking-time lookup that returns a not-found signal when a venue is absent from the list or the pair has no matrix value (for the connection layer to treat as unknown)
    - Match venue names after trimming and lowercasing, by exact name only, with no fuzzy matching
    - _Requirements: 9.6, 9.7, 9.8, 9.9_
  - [ ] 4.3 Write venue-data validation smoke test
    - Parse `data/venues.json` with `VenueDataSchema`; assert wrapper shape, non-empty names, in-range coordinates, whole-minute matrix values 0 to 240, and a valid source note on every value
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [ ] 4.4 Write property test for invalid venue entry rejection
    - **Property 15: Invalid venue entries are rejected with a naming reason**
    - **Validates: Requirements 9.7**
  - [ ] 4.5 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 5. Implement commitment resolution
  - [ ] 5.1 Implement `resolve.ts` for venue, time, and reservability resolution
    - Turn one `Commitment` plus the `Sessions_Lookup` into a `ResolvedCommitment` with `ref`, optional `venue`, `startsAt`, `endsAt`, `isAllDay`, optional `isReservable`, and a `missing` list
    - `Venue_Resolution` order: `NormalisedSession.venue`, then `Commitment.venue` for a reservedSession, then `Commitment.location` for a personalTime
    - A time is usable only when present, not named in `missingFields`, and matching ISO 8601 with `Z` or `+/-HH:MM`; a `sessionId` absent from the lookup yields unknown venue, times, and reservability; reservability is missing when `isReservable` is in `missingFields` or the session is absent
    - _Requirements: 1.5, 2.5, 3.7, 5.7, 11.5_
  - [ ] 5.2 Write property test for missing-field resolution yielding unknown with no default
    - **Property 3: Missing required field yields unknown with a reason and no value**
    - **Validates: Requirements 1.5, 1.6, 2.5, 3.7, 11.5**
  - [ ] 5.3 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 6. Checkpoint - internal foundation
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement boarding time
  - [ ] 7.1 Implement `boarding.ts` `computeBoarding`
    - Return `closes` at start minus 10 minutes (instant arithmetic, expressed in the event timezone) when reservable with usable start and valid timezone
    - Return `notApplicable` when `isReservable` is false; return `unknown` when start time, reservability flag, or timezone is missing or unrecognised; never substitute a default and never decide reservability from the type name
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [ ] 7.2 Write property test for boarding closes at start minus ten minutes
    - **Property 1: Boarding closes at start minus ten minutes**
    - **Validates: Requirements 1.1, 1.7**
  - [ ] 7.3 Write property test for reservability coming from the flag, not the type name
    - **Property 2: Reservability comes from the flag, not the type name**
    - **Validates: Requirements 1.2, 1.3, 1.4**
  - [ ] 7.4 Write boarding example test
    - Assert one concrete reservable session returns `closes` ten minutes before start in the event timezone
    - _Requirements: 1.1, 1.7_
  - [ ] 7.5 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 8. Implement connection classification
  - [ ] 8.1 Implement `connections.ts` `classifyConnection`
    - Compute walking minutes as the matrix value plus `bufferMinutes`; same-venue walk is 0 plus buffer with an estimate label in the reason
    - Due time is the next item's boarding instant when reservable, otherwise its start time; classify comfortable at `tightMarginMinutes` or more spare, tight below that, impossible when arrival is after due time
    - Return unknown when a venue is missing, a venue is absent from the matrix, or a reservable next item has no boarding; every reason names both venues and the walking minutes, and states estimate when the source is an estimate
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 9.8, 9.9_
  - [ ] 8.2 Write property test for connection classification by spare time
    - **Property 5: Connection classification follows spare time against the due time, with walking minutes and a naming reason**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.8, 2.9**
  - [ ] 8.3 Write property test for unknown connections
    - **Property 6: Missing venue, matrix value, or missing boarding yields an unknown connection**
    - **Validates: Requirements 2.6, 2.7, 9.8, 9.9**
  - [ ] 8.4 Write connection example tests
    - Assert one comfortable, one tight, and one impossible connection with representative outputs
    - _Requirements: 2.2, 2.3, 2.4_
  - [ ] 8.5 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 9. Implement clash detection
  - [ ] 9.1 Implement `clashes.ts` `findClashes`
    - Report a clash when two commitments overlap by one second or more in the event timezone; identical intervals clash; touching at a single instant does not
    - Expand an all-day item to 00:00:00 to 23:59:59 of its event day; evaluate cross-midnight commitments on their instants
    - Return `unknown` for any pair including a commitment with a missing end time, and `unknown` when the timezone is missing; every clash reason names both commitments and the overlapping range
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_
  - [ ] 9.2 Write property test for clash overlap semantics
    - **Property 7: Clash overlap semantics with all-day expansion and a naming reason**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.9**
  - [ ] 9.3 Write clash example tests
    - Assert a clash across midnight and a touching-at-one-instant no-clash pair
    - _Requirements: 3.3, 3.5_
  - [ ] 9.4 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 10. Implement layovers and personal time
  - [ ] 10.1 Implement `layovers.ts` `checkLayovers`
    - Report a missing meal layover when free minutes inside the meal window fall below the required free minutes; report a long stretch over `maxStretchMinutes`
    - Produce suggested blocks in clash-free gaps, each with start, end, and reason, or state that none could be placed; use event-timezone wall-clock time for windows and stretches
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [ ] 10.2 Write property test for the meal layover report
    - **Property 8: Meal layover reported exactly when free minutes fall short**
    - **Validates: Requirements 4.1, 4.2**
  - [ ] 10.3 Write property test for the long stretch report
    - **Property 9: Long stretch reported exactly when an unbroken run exceeds the max**
    - **Validates: Requirements 4.3, 4.4**
  - [ ] 10.4 Write property test for suggested blocks
    - **Property 10: Suggested blocks are complete and clash-free, or none is reported**
    - **Validates: Requirements 4.5, 4.6, 4.7**
  - [ ] 10.5 Write default meal-window and stretch example tests
    - Assert the default meal window 11:30 to 14:00 needing 30 free minutes and the default maximum stretch of 180 minutes
    - _Requirements: 4.2, 4.3_
  - [ ] 10.6 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 11. Checkpoint - core fact rules
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement rebooking options
  - [ ] 12.1 Implement `rebooking.ts` `findRebookingOptions`
    - Find repeats by the `-R` base-code suffix and by `repeatOf`, list standby favorites sharing the base code, and list walk-up options whose `isReservable` is false or that are full, including only sessions starting strictly after `Context.now` in the event timezone
    - Attach a 1 to 200 character reason to each option; return zero options with a plain-English no-alternative message when none match; a missing timezone returns zero options with a timezone message and leaves the input unchanged
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [ ] 12.2 Write property test for rebooking options
    - **Property 12: Every rebooking option matches the base code and starts after now**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
  - [ ] 12.3 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 13. Implement safe swap
  - [ ] 13.1 Implement `safe-swap.ts` `planSafeSwap`
    - Produce three ordered steps (reserve repeat, confirm held, cancel original) with the cancel step blocked until the confirmation schedule shows the repeat held
    - Outcome is unsafe naming every clashing commitment when the repeat clashes, failed when the confirmation schedule does not show it held, and safe otherwise, leaving the original and all inputs unchanged; all clash checks use the event timezone and `Context.now`; no I/O
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ] 13.2 Write property test for safe swap steps and outcome
    - **Property 13: Safe swap produces the three gated steps and an outcome that matches clash and confirmation state**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
  - [ ] 13.3 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 14. Implement the checkReservation guardrail with the count-only overload interface
  - [ ] 14.1 Implement `check-reservation.ts` `checkReservation`
    - Turn the candidate `NormalisedSession` into a `reservedSession` `Commitment`, find the nearest earlier and later commitments on the same event day, and ignore a candidate already in the schedule for clash checks
    - Compose the lower-level rules (never re-implement them): block on a clash or an impossible adjacent connection; warn on a tight connection, on a meal layover going from present to missing, or on overload going from false to true; skip any rule that cannot be judged, raise the decision to at least warn, and name the skipped rule
    - Call overload only through the single `isOverloaded` interface. For now `isOverloaded` uses the count-only fallback (a day with more than `overloadCountThreshold` commitments is overloaded), so the guardrail works before the full energy formula exists (Req 5.9); do not re-implement it when the full formula lands
    - Return exactly one `Verdict` by precedence (block over warn over allow) with one reason per applied rule; every reason flows through `reasons.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 5.9_
  - [ ] 14.2 Write property test for the guardrail verdict and precedence
    - **Property 14: checkReservation returns one valid Verdict by severity precedence and never blocks on missing data**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9**
  - [ ] 14.3 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 15. Wire the public surface and prove purity and browser safety
  - [ ] 15.1 Populate `index.ts` to re-export the public surface by name
    - Re-export `checkReservation`, `computeBoarding`, `classifyConnection`, `findClashes`, `checkLayovers`, `isOverloaded`, `findRebookingOptions`, `planSafeSwap`, `Context`, and `ContextSchema` through `@compass/core/rules`; keep internal helpers unexported. `scoreEnergy` is added to this surface in the next task when it lands
    - _Requirements: 8.1, 10.3, 10.4_
  - [ ] 15.2 Write property test for input immutability
    - **Property 16: Inputs are never mutated**
    - **Validates: Requirements 10.6, 6.7, 7.3, 7.5**
  - [ ] 15.3 Write determinism example test
    - Call each exported function twice on deeply equal inputs and assert deeply equal results
    - _Requirements: 10.5_
  - [ ] 15.4 Write Node built-in import scan and impurity static scan tests
    - Scan owned source and transitive imports for Node built-in imports; scan for `node:`, `fs`, `path`, `process`, `Buffer`, `Date.now(`, `new Date()`, and `Math.random`; fail if any is found
    - _Requirements: 10.1, 10.2, 12.4_
  - [ ] 15.5 Write browser-safe execution and shared-type structural tests
    - Import through `@compass/core/rules` and invoke every exported function, asserting no reference error and no I/O; assert the four shared types are imported from `@compass/contracts` and not redefined; assert no test under `test/rules` reads `fixtures/synthetic`
    - _Requirements: 10.1, 10.3, 10.4, 12.5_
  - [ ] 15.6 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 16. Implement the full energy budget formula (last implementation task)
  - [ ] 16.1 Implement `energy.ts` `scoreEnergy` and promote `isOverloaded` to the full formula
    - Score is `(commitmentCount * 10) + totalWalkingMinutes + (venueChangeCount * 15)`; days with fewer than two commitments have zero walking and zero venue changes
    - A commitment missing a venue or usable time is counted but excluded from walking and venue totals and named in the explanation that also names the three inputs and the formula
    - `isOverloaded` remains the single interface the guardrail calls; the full formula flags overload when the score is strictly greater than `overloadThreshold`, and the count-only fallback still flags when the commitment count alone is strictly greater than `overloadCountThreshold`. `checkReservation` is not changed: it keeps calling the same `isOverloaded` interface
    - Add `scoreEnergy` to the `index.ts` public surface
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 8.1, 10.3_
  - [ ] 16.2 Write property test for the energy formula, threshold, fallback, and explanation
    - **Property 11: Energy budget formula, overload threshold and count-only fallback, and explanation**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9**
  - [ ] 16.3 Run the rules tests, confirm they pass, then commit
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

- [ ] 17. Final checkpoint - full suite, coverage, and dash gate
  - Ensure all tests pass, confirm 100 percent coverage over owned files with only the permitted generated-type exclusions, and confirm the no-dash and self-made-data gates hold. Ask the user if questions arise.

- [ ] 18. Capture proof-of-working screenshots or terminal captures
  - [ ] 18.1 Save two or three screenshots or short terminal captures of the rules working to `docs/article/screenshots/itinerary-rules/`
    - Capture representative output, for example a blocked clash verdict with its reasons, a tight connection warning, and the passing test run with coverage; use only self-made sample data, never real attendee data
    - _Requirements: definition of done item 5 (workflow.md)_
  - [ ] 18.2 Commit the screenshots
    - Commit locally with scope `itinerary-rules`, subject and body via separate `-m` flags, no commit message file, no push

## Notes

- Every task is required; there are no optional tasks, because S2's definition of done is 100 percent coverage over owned files.
- Tasks run sequentially in numeric order. Do each task in this chat and save files after each step; do not delegate to a task-execution subagent.
- Each property test carries a comment in the format `// Feature: itinerary-rules, Property {number}: {property_text}`, runs at least 100 iterations with `fast-check`, and uses only self-made sample data under `packages/core/test/rules`.
- File ownership: only `packages/core/src/rules/**`, `packages/core/test/rules/**`, `data/venues.json`, and `.kiro/specs/itinerary-rules/` may be edited. Never touch `packages/contracts/**`, `contracts/**`, `package.json`, or `package-lock.json`. If a dependency or contract change is needed, stop and tell the owner; do not run `npm install`.
- Each top-level task ends with a local commit made only after that task's tests pass, using Conventional Commits with scope `itinerary-rules`, subject and body through separate `-m` flags, no commit message file, and no push. The task 1 commit also includes `.kiro/specs/itinerary-rules/`.
- The full energy budget formula (cut-list item 2) is the last implementation task (task 16). The guardrail reaches overload through a single `isOverloaded` interface, which uses the count-only fallback until the full formula lands, so `checkReservation` never changes.
- Each task references specific granular requirements for traceability, and each property sub-task names the design property it implements.

## Task Dependency Graph

Tasks run strictly sequentially in numeric order. Each task is its own wave, so no two tasks run in parallel.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 6, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 8, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "10.6"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 10, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 11, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 12, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6"] },
    { "id": 13, "tasks": ["16.1", "16.2", "16.3"] },
    { "id": 14, "tasks": ["18.1", "18.2"] }
  ]
}
```
