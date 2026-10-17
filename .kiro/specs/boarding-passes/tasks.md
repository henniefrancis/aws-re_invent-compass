# Implementation Plan: boarding-passes (S4, the local pass side)

## Overview

This plan turns the S4 design into a sequence of coding steps under `packages/core/src/passes/**` and `packages/core/test/passes/**`. Each top-level task builds on the one before it, starting from the package scaffolding and injected interface types, moving through each component in dependency order (Pass_Builder, Compass_Client, Pass_Store, Pass_Sync, the forgetMe orchestrator, Handoff_Builder, Ics_Exporter), ending with the Itinerary_Page (cut-list item 1, built last), and finishing with the docs capture task. Every component ships with the property-based tests and the example and snapshot tests the design assigns to it, so coverage reaches one hundred percent as each task closes.

## Execution rules (read before starting any task)

- **Sequential only.** Tasks are executed one at a time, in numeric order (1, then 2, then 3, ...). There is no parallelism, no concurrent streams and no waves. The dependency graph at the end records this single ordered chain for tooling only.
- **Executed directly in this chat session.** Each task is carried out directly in the chat session and is never delegated to any task-execution subagent. Files are saved after each step so progress is always on disk.
- **No optional tasks.** Every task and sub-step in this plan is required. There are no optional markers and nothing may be skipped, because the S4 definition of done requires one hundred percent unit coverage of the owned code.
- **File-ownership fence.** Every file a task writes or edits MUST live under `packages/core/src/passes/**` or `packages/core/test/passes/**`, plus this spec folder `.kiro/specs/boarding-passes/`. The one exception is the final docs task, which writes captures under `docs/article/screenshots/boarding-passes/` (a docs artifact folder, outside the passes source fence). Tasks MUST NEVER edit `packages/contracts/**`, `contracts/**`, `package.json` or `package-lock.json`.
- **No dependency or contract changes.** The design states the needed libraries are already available: `zod` (declared in `packages/core` per integrator commit b5c22cd), `ical-generator`, `qrcode`, `fast-check`, `node:crypto` and `node:http`. If any task would need a package that is not already present, or a change to an S0 contract in `packages/contracts/**` or `contracts/**`, STOP and ask the owner (raise it as a note in this file for the integrator). Do not run `npm install` and do not edit those files.
- **Commit at the end of every top-level task.** The final sub-step of each top-level task is: run that task's tests and, only after they pass, make one local git commit. Use Conventional Commits with the scope `boarding-passes` (for example `feat(boarding-passes): ...`, `test(boarding-passes): ...`, `chore(boarding-passes): ...`). The commit MUST be created with multiple `-m` flags (one for the subject, one or more for the body) and MUST NOT use a commit message file. Never push, never open a PR, never tag. No em dash or en dash anywhere in the message. Task 1's commit additionally includes this spec folder `.kiro/specs/boarding-passes/` (`requirements.md`, `design.md`, `tasks.md`, `.config.kiro`) alongside its code.
- **Airline metaphor and dashes.** Keep the airline-metaphor names (`BoardingPass`, `Connection`, `Layover`, `Standby`, `rebook`, `voidPass`). Never use an em dash or an en dash in code, copy, comments, test names or commit messages.

## Tasks

- [x] 1. Scaffold the passes package, injected interface types, owned data models and shared helpers
  - Create the `packages/core/src/passes/` module layout and the `@compass/core/passes` subpath entry point, with no shared barrel beyond the declared subpath export.
  - Define the injected interface contracts in their own file: `IdTokenProvider`, `ConnectionProvider`, `Clock`, `AppDataResolver`, `FileSystem`, `HttpTransport`, plus `HttpRequest` and `HttpResponse`.
  - Define the S4-owned data model shapes: `EventWindow`, `IssuedPass`, `IssuedPassRecord`, `ItineraryCommitment`, `Itinerary`, `IncludeFlags`, `SyncInput`, `BuildSession`, `AdjacentCommitment`, `AdjacentSession`, `BuildPassFn`, importing every wire and pass type from `@compass/contracts` and redefining none of them.
  - Implement the shared `redact(value)` helper and the `PassError { code, summary }` error shape so no ID token, email, Board_URL, hand-off id or request input can reach a log line or error message.
  - Implement the `fieldsHash` function: a SHA-256 hex digest over the canonical JSON (keys sorted, no whitespace) of a validated `PassFields`, using `node:crypto`, over pass content only.
  - _Requirements: 8.1, 8.2, 8.3_
  - [x] 1.1 Write unit tests for the redaction helper and the field hash
    - Assert `redact` removes each sentinel secret kind, and that `fieldsHash` is deterministic (equal canonical JSON gives an equal hash) and differs when content differs.
    - _Requirements: 8.1, 8.2_
  - [x] 1.2 Run this task's tests, then commit locally (include the spec folder)
    - Run `npm test` for `packages/core`; only after it passes, make one local commit with multiple `-m` flags. Stage the task 1 code and tests under `packages/core/**/passes/**` together with the spec folder `.kiro/specs/boarding-passes/` (`requirements.md`, `design.md`, `tasks.md`, `.config.kiro`). Never push, never open a PR, never tag.
    - Example: `git commit -m "chore(boarding-passes): scaffold passes package, injected seams and shared helpers" -m "Add injected interface contracts, owned data models, redact helper, PassError and fieldsHash. Commit the boarding-passes spec folder alongside the initial code."`

- [x] 2. Implement Pass_Builder
  - Implement `buildPass(input, deps)` as a pure function (no clock), taking only the `ConnectionProvider` as an injected dependency.
  - Run `normalisePassText` from `@compass/contracts` on title, venue, room and the from-venue value before validation.
  - Apply the title rule: after normalisation, truncate a title longer than eighty characters to seventy-seven characters followed by the three ASCII full stops `...`, never using the single Unicode ellipsis and never splitting a surrogate pair.
  - Apply the text fallbacks without echoing rejected text: title that still fails becomes `Title not shown` with the session code kept; venue or room that still fails becomes an empty string.
  - Populate `walkFromPrevious` and `nextConnection` only when the adjacent commitment and known walk minutes exist, omitting the field otherwise, and clamp any known walk minutes to the range 0 to 90.
  - Include the attendee name field (one to forty characters) only when a local opt-in is recorded, and omit it otherwise.
  - Set no server-owned field (`boardingClosesAt`, `disclaimer`, `expirationDate`, `relevantDates`, `transitType`, `sharingProhibited`) and send no barcode field; validate the result against `createPassFieldsSchema(eventWindow)` before return.
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_
  - [x] 2.1 Write property test: built fields always validate for the current window
    - **Property 1: Built fields always validate for the current window**
    - **Validates: Requirements 1.1, 1.8**
  - [x] 2.2 Write property test: adjacency fields present exactly when the adjacent commitment exists
    - **Property 3: Adjacency fields present exactly when the adjacent commitment exists**
    - **Validates: Requirements 1.3, 1.4**
  - [x] 2.3 Write property test: title length and ASCII ellipsis truncation
    - **Property 4: Title length and ASCII ellipsis truncation**
    - **Validates: Requirements 1.5**
  - [x] 2.4 Write property test: attendee name present exactly when opt-in is recorded
    - **Property 5: Attendee name present exactly when opt-in is recorded**
    - **Validates: Requirements 1.6, 1.7**
  - [x] 2.5 Write property test: empty venue and room are sent as empty strings
    - **Property 6: Empty venue and room are sent as empty strings**
    - **Validates: Requirements 1.9**
  - [x] 2.6 Write property test: no server-derived or barcode fields in builder output
    - **Property 7: No server-derived or barcode fields in builder output**
    - **Validates: Requirements 1.10**
  - [x] 2.7 Write example and snapshot tests for the builder
    - Snapshot the builder output over representative sessions (Requirement 9.1); add example tests for the `Title not shown` fallback (rejected text never echoed) and the empty venue and room cases.
    - _Requirements: 1.8, 1.9_
  - [x] 2.8 Run this task's tests, then commit locally
    - Run `npm test` for `packages/core`; only after it passes, make one local commit with multiple `-m` flags scoped `boarding-passes`. Never push, never open a PR, never tag.
    - Example: `git commit -m "feat(boarding-passes): add Pass_Builder with text normalisation and adjacency" -m "Pure buildPass derives walk fields, truncates titles with ASCII ellipsis, applies safe fallbacks and validates against the window schema."`

- [ ] 3. Implement Compass_Client and the response schemas
  - Implement the owned response schemas in `packages/core/src/passes/compass-api-schemas.ts`, each declared as a `z.ZodType<...>` of the matching generated `CompassApi` response type so a schema that drifts from the contract fails to compile. Do not edit `packages/contracts/**`; import the generated types only.
  - Implement the `CompassClient` over the injected `HttpTransport`, `IdTokenProvider` and `Clock`: `issuePasses`, `getApplePass`, `updatePass`, `voidPass`, `createHandoff`, `forgetMe`.
  - Attach `Authorization: Bearer <idToken>` on every attendee route, fetching the token fresh per call and never storing it.
  - Validate every response body against its schema and return no unvalidated data; parse `application/problem+json` against `ProblemSchema` into a `PassError` that carries no request input.
  - Handle 429: retry exactly once after waiting the `Retry-After` duration (delta-seconds or HTTP-date, capped at 60 seconds); when the header is absent or unusable, surface the 429 with no retry; perform no other automatic write retry.
  - Treat a 404 on `updatePass` or `voidPass` as the serial being already gone (signal the caller to drop the entry), and treat a repeat void success as the completed state.
  - Build the in-memory and/or `node:http` mock transport from `contracts/compass-api.openapi.yaml` for the tests (read-only use of the contract file; never edit it).
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_
  - [ ] 3.1 Write property test: ID token attached as Bearer on every attendee route
    - **Property 8: ID token attached as Bearer on every attendee route**
    - **Validates: Requirements 2.8**
  - [ ] 3.2 Write property test: Problem bodies parse and surface without request input
    - **Property 10: Problem bodies parse and surface without request input**
    - **Validates: Requirements 2.9**
  - [ ] 3.3 Write property test: single retry only on 429 with a usable Retry-After
    - **Property 11: Single retry only on 429 with a usable Retry-After**
    - **Validates: Requirements 2.10, 2.11**
  - [ ] 3.4 Write property test: response validation gate
    - **Property 12: Response validation gate**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.6, 2.12**
  - [ ] 3.5 Write example tests for byte pass-through, void idempotence and the 404 drop signal
    - `getApplePass` returns the Apple pass body bytes (2.2); voiding a serial twice against a success response yields the completed state and no error both times (2.5, former Property 9); a 404 on update or void signals the serial is already gone.
    - All Compass_Client tests run against the mock server built from `contracts/compass-api.openapi.yaml` (Requirement 9.4).
    - _Requirements: 2.2, 2.5, 9.4_
  - [ ] 3.6 Run this task's tests, then commit locally
    - Run `npm test` for `packages/core`; only after it passes, make one local commit with multiple `-m` flags scoped `boarding-passes`. Never push, never open a PR, never tag.
    - Example: `git commit -m "feat(boarding-passes): add Compass_Client and contract-typed response schemas" -m "Typed client validates every response with zod, attaches the Bearer ID token, retries 429 once on Retry-After and treats 404 on write as already gone."`

- [ ] 4. Implement Pass_Store
  - Implement `PassStore` (`read`, `write`, `deleteRecord`) over the injected `AppDataResolver` and `FileSystem`.
  - Resolve the App_Data_Folder per OS: `%APPDATA%` on Windows, `~/Library/Application Support` on macOS, `$XDG_DATA_HOME` with the `/reinvent-compass` suffix on Linux.
  - Store per issued pass only the serial number, session code, fields hash and platforms; never the ID token or attendee email.
  - Always pass mode 0600 to the filesystem seam on write; read an absent record as an empty record `{ passes: [] }`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ] 4.1 Write example tests for per-OS resolution, write path and mode, round trip and absent read
    - Per-OS App_Data_Folder resolution across platform and environment combinations including the Linux suffix (3.2); record written inside the resolved folder with mode 0600 passed to the seam (3.1, 3.4, former Property 13); write then read yields an equal record with no ID token or email in the serialised text (3.3, 3.6, former Property 14); absent read returns an empty record (3.5).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ] 4.2 Run this task's tests, then commit locally
    - Run `npm test` for `packages/core`; only after it passes, make one local commit with multiple `-m` flags scoped `boarding-passes`. Never push, never open a PR, never tag.
    - Example: `git commit -m "feat(boarding-passes): add Pass_Store with per-OS app-data resolution" -m "Reads and writes the issued-pass record with mode 0600, excludes token and email, and returns an empty record when absent."`

- [ ] 5. Implement Pass_Sync
  - Implement the pure `diffSchedule(input, record, rebuild)` classifying each session code in the union into exactly one of added, changed, cancelled or unchanged, where changed is a differing rebuilt-fields hash and cancelled is in the record but absent from the schedule.
  - Implement `syncPasses(input, deps)`: issue added sessions in chunks of at most twenty-five (matching the issue response back by session code and recording the issued platforms), PUT changed sessions, void cancelled sessions, make no call for unchanged sessions, and write the resulting state to the record after each completed issue, update or void.
  - Handle the client's 404 already-gone signal on update or void by dropping that entry from the record rather than treating it as an error; make zero calls and leave the record unchanged on a fully matching run.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
  - [ ] 5.1 Write property test: diff partitions sessions into exactly one case
    - **Property 15: Diff partitions sessions into exactly one case**
    - **Validates: Requirements 4.1, 4.5**
  - [ ] 5.2 Write property test: sync drives the correct call per case and persists the post-state
    - **Property 16: Sync drives the correct call per case and persists the post-state**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.7**
  - [ ] 5.3 Write property test: idempotent re-run makes no calls and leaves the record unchanged
    - **Property 17: Idempotent re-run makes no calls and leaves the record unchanged**
    - **Validates: Requirements 4.6**
  - [ ] 5.4 Run this task's tests, then commit locally
    - Run `npm test` for `packages/core`; only after it passes, make one local commit with multiple `-m` flags scoped `boarding-passes`. Never push, never open a PR, never tag.
    - Example: `git commit -m "feat(boarding-passes): add Pass_Sync diff and drive issue, update and void" -m "Pure four-case diff keyed on session code drives chunked issue, PUT update and void, self-heals on 404 and is idempotent on a matching run."`

- [ ] 6. Implement the forgetMe orchestrator
  - Implement `forgetMe(deps)` composing the `CompassClient`, `PassStore`, `FileSystem` and `AppDataResolver`.
  - Call `client.forgetMe()`; only on a 202 response delete the local record and remove `output/reinvent.ics` and `output/itinerary.html`; on any other status leave local files untouched.
  - Surface copy that states passes are voided and will expire, and never claims passes are deleted from the phone.
  - _Requirements: 2.7_
  - [ ] 6.1 Write example tests for the orchestrator outcomes
    - On 202, assert the local record is deleted and both output files are removed; on any other status, assert local files are untouched; assert the copy states passes are voided and expire and never claims phone deletion.
    - _Requirements: 2.7_
  - [ ] 6.2 Run this task's tests, then commit locally
    - Run `npm test` for `packages/core`; only after it passes, make one local commit with multiple `-m` flags scoped `boarding-passes`. Never push, never open a PR, never tag.
    - Example: `git commit -m "feat(boarding-passes): add forgetMe orchestrator for local deletion on 202" -m "Composes client, store and filesystem; deletes the record and output files only on a 202 and keeps copy honest about wallet deletion."`

- [ ] 7. Implement Handoff_Builder
  - Implement `HandoffBuilder.handoff(serialNumbers, include)`: create the hand-off through the `CompassClient`, obtain the Board_URL, and render it as a terminal QR (ASCII or Unicode blocks), a chat text QR and a chat PNG QR using `qrcode`.
  - Encode the Board_URL exactly as returned with the hand-off id intact in the URL fragment across all three renders, and never write the Board_URL or hand-off id to a log line or error.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [ ] 7.1 Write property test: the three QR renders encode the same Board_URL data
    - **Property 18: The three QR renders encode the same Board_URL data**
    - **Validates: Requirements 5.2, 5.3, 5.4**
  - [ ] 7.2 Run this task's tests, then commit locally
    - Run `npm test` for `packages/core`; only after it passes, make one local commit with multiple `-m` flags scoped `boarding-passes`. Never push, never open a PR, never tag.
    - Example: `git commit -m "feat(boarding-passes): add Handoff_Builder with three QR renders" -m "Creates the hand-off through the client and renders the Board_URL as terminal, chat-text and chat-PNG QR codes with the fragment intact."`

- [ ] 8. Implement Ics_Exporter
  - Implement `buildCalendar(itinerary, window)` with `ical-generator` producing RFC 5545 text, one VEVENT per Commitment, all times in UTC with the `Z` designator and no `TZID` or `VTIMEZONE`.
  - Derive Boarding_Closes locally as session start minus ten minutes; add a boarding-closes alarm for every reserved session, and a leave-now alarm at Boarding_Closes minus the carried walk minutes when an earlier commitment exists.
  - Assign a stable UID per commitment (session code for a reserved session; `personalTimeId` or a hash of title and start for a layover) and implement `writeCalendar` to write only inside the app-data `output/` folder.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ] 8.1 Write property test: calendar is valid RFC 5545 with one event per commitment
    - **Property 19: Calendar is valid RFC 5545 with one event per commitment**
    - Wire an RFC 5545 validator into this property (Requirement 9.3).
    - **Validates: Requirements 6.1, 6.2, 9.3**
  - [ ] 8.2 Write property test: alarm rules
    - **Property 20: Alarm rules**
    - **Validates: Requirements 6.3, 6.4**
  - [ ] 8.3 Write example and snapshot tests for Boarding_Closes, stable UID and output path
    - Snapshot the calendar over a representative itinerary (Requirement 9.1); assert Boarding_Closes equals session start minus ten minutes over representative starts (1.2, former Property 2); assert building twice yields identical UIDs for a reserved session and a layover (with and without a `personalTimeId`) and that the file is written inside `output/` (6.5, former Property 21).
    - _Requirements: 1.2, 6.5_
  - [ ] 8.4 Run this task's tests, then commit locally
    - Run `npm test` for `packages/core`; only after it passes, make one local commit with multiple `-m` flags scoped `boarding-passes`. Never push, never open a PR, never tag.
    - Example: `git commit -m "feat(boarding-passes): add Ics_Exporter with UTC times and boarding alarms" -m "Builds RFC 5545 with one VEVENT per commitment, boarding-closes and leave-now alarms, stable UIDs and output written only to the app-data output folder."`

- [ ] 9. Implement Itinerary_Page (built last, cut-list item 1)
  - Implement `render(itinerary, window)` producing one self-contained offline HTML document with all CSS inlined, no script content and no inline event-handler attributes, and no external resource references or network requests.
  - State the event timezone once for the view and show all times in event local time; render an empty venue as exactly `Venue not published`.
  - Build accessible structure: a document language, a non-empty page title, a single top-level heading, a heading outline in document order, table or list markup whose structure is programmatically determinable, and a viewport meta tag; build device-width with no fixed widths above 320 CSS pixels and a palette whose body text contrast is at least 4.5 to 1.
  - Implement `write(itinerary, window)` to write only inside the app-data `output/` folder.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_
  - [ ] 9.1 Write snapshot and structural example tests for the itinerary page
    - Snapshot the rendered HTML (Requirement 9.1); assert no script element and no inline event-handler attribute (7.2, former Property 22); no external resource reference (7.3, former Property 23); empty venue renders exactly `Venue not published` (7.5, former Property 24); a document language, a non-empty page title, exactly one top-level heading, a heading outline that skips no level, a viewport meta tag and table or list markup (7.6, 7.7, 7.8, former Property 25); the timezone is stated once and times are in event local time (7.4); no fixed widths above 320 pixels are present in the inlined CSS (7.9).
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_
  - [ ] 9.2 Write an example test asserting the palette contrast
    - Compute the chosen palette's body text contrast once and assert it is at or above 4.5 to 1 (7.10).
    - _Requirements: 7.10_
  - [ ] 9.3 Write the sentinel-secret harness property test across all components
    - **Property 26: No secret reaches logs or errors on the named failure paths**
    - Inject a known ID token, attendee email, Board_URL and hand-off id, drive each component's named failure paths (problem bodies, response validation failures, transport failures, store write failures and builder text fallbacks), and assert no sentinel value and no request input appears in any captured log or thrown error (Requirement 9.5).
    - **Validates: Requirements 8.1, 8.2, 8.3, 9.5**
  - [ ] 9.4 Run this task's tests and the full suite with coverage, then commit locally
    - Run `npm test` for `packages/core` with v8 coverage and confirm one hundred percent lines, branches, functions and statements for the owned code with named exclusions only (Requirement 9.6); only after it passes, make one local commit with multiple `-m` flags scoped `boarding-passes`. Never push, never open a PR, never tag.
    - Example: `git commit -m "feat(boarding-passes): add offline Itinerary_Page and close coverage" -m "Self-contained accessible HTML with inlined CSS, no script and no network; adds the sentinel-secret harness and reaches full owned-code coverage."`

- [ ] 10. Capture feature screenshots or terminal captures for the Builder Center post
  - Produce two or three screenshots or short terminal captures of the feature working (for example the terminal QR render, the rendered itinerary page, and a sync run), and save them to `docs/article/screenshots/boarding-passes/`. This folder is outside the passes source fence and is a docs artifact task; it writes no source or test code.
  - _Requirements: 9.1_
  - [ ] 10.1 Run the capture-producing tests, then commit the captures locally
    - Re-run the relevant snapshot or render tests to generate the output shown in the captures; only after they pass, make one local commit with multiple `-m` flags scoped `boarding-passes` that stages the files under `docs/article/screenshots/boarding-passes/`. Never push, never open a PR, never tag.
    - Example: `git commit -m "docs(boarding-passes): add feature screenshots for the Builder Center post" -m "Capture the terminal QR hand-off, the offline itinerary page and a sync run for the article."`

## Notes

- Tasks are executed sequentially in numeric order, one at a time, directly in this chat session, never delegated to a subagent, with files saved after each step.
- There are no optional tasks; the S4 definition of done requires one hundred percent owned-code coverage, so every sub-step is required.
- Every task references the requirement numbers it implements, and every property-based test names its property number and the requirement clause it validates.
- File-ownership fence: all source and test edits stay under `packages/core/src/passes/**` and `packages/core/test/passes/**`, plus this spec folder; the only exception is task 10, which writes captures under `docs/article/screenshots/boarding-passes/`. Tasks never edit `packages/contracts/**`, `contracts/**`, `package.json` or `package-lock.json`.
- The design states the needed libraries are already available (`zod` in `packages/core` per commit b5c22cd, `ical-generator`, `qrcode`, `fast-check`, `node:crypto`, `node:http`). If a task would need anything not already present, or a contract change, STOP and ask the owner; do not run `npm install` and do not edit the contract or manifest files.
- Each top-level task ends with a local commit created with multiple `-m` flags (no message file), scoped `boarding-passes`, Conventional Commits, no em dash or en dash, and it never pushes, opens a PR or tags. Task 1's commit includes the spec folder alongside its code.
- Property-based tests use fast-check at a minimum of 100 iterations each; the property number gaps (2, 9, 13, 14, 21 through 25) are the criteria the design moved to example and snapshot tests.

### S0 change requests for the integrator

- None at plan time. If a task discovers a needed change to `@compass/contracts`, the contract OpenAPI file, or a new dependency, record it here and stop rather than editing S0 or running `npm install`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 3, "tasks": ["4.1", "4.2"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "id": 5, "tasks": ["6.1", "6.2"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 9, "tasks": ["10.1"] }
  ]
}
```
