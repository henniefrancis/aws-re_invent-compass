# Requirements Document

## Introduction

This spec (S3, compass-power) covers the parts of re:Invent Compass that an attendee actually touches on their computer: the Kiro Power, the local stdio MCP server and its CLI (published to npm as `reinvent-compass`), the repo scanner, the week spec generator, and the Kiro hooks. It owns `packages/mcp-server/**`, `packages/core/src/scanner/**`, `packages/core/src/spec/**`, `power/**` and `fixtures/sample-repo/**`, plus the matching test folders (`packages/mcp-server/test/**`, `packages/core/test/scanner/**`, `packages/core/test/spec/**`).

In the airline metaphor this stream is the travel agent and the boarding gate. It reads the attendee's code to suggest an itinerary (scan and plan), writes that itinerary as a Kiro spec, books and cancels seats only through the guardrail (every write runs `checkReservation` inside the server), hands boarding passes to the phone, and offers the same desk to Kiro, Claude Desktop, VS Code and the Kiro CLI.

S3 consumes three other streams only through their documented interfaces, behind injected seams, and mocks them until they merge: S1 events-client (`@compass/core/auth`, `/api`, `/catalog`, `/simulated`), S2 itinerary-rules (`@compass/core/rules`) and S4 boarding-passes (`@compass/core/passes`). All shared types and the seventeen MCP tool schemas come from `@compass/contracts` and are never redeclared or edited here.

The guardrail inside the server is the control. Kiro hooks add a warning or a block on top, as defence in depth, so S3 works whether or not day-1 spike SP1 confirms hook blocking. A human approves every write: write tools are never auto-approved, and the official `awsevents` remote server's write tools are listed in `disabledTools`.

Scope boundary: this stream does not build the Events API client, sign-in, catalog cache or simulated transport (S1), the rules engine or `data/venues.json` (S2), the pass builder, Compass API client, sync, `.ics` or QR rendering (S4), the Compass API Lambdas (S5), infrastructure (S6) or the showcase site (S7).

## Glossary

- **Compass_Server**: The local stdio MCP server in `packages/mcp-server`, built on `@modelcontextprotocol/sdk` 1.32.1.
- **CLI**: The `reinvent-compass` command in the same package: no arguments starts the Compass_Server; `demo` runs the simulated flow; `hook <name>` is what Kiro hooks call.
- **Tool**: One of the seventeen MCP tools defined in `mcpTools` in `packages/contracts/src/mcp-tools.ts`.
- **Read_Tool**: `refresh_catalog`, `find_sessions`, `scan_repo`, `check_itinerary`. These may be auto-approved by the attendee.
- **Local_Action_Tool**: `sign_in`, `sign_out`, `plan_week`, `export_calendar`. These change only local state and are not auto-approved by Compass.
- **Write_Tool**: `reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby`, `add_layover`, `issue_boarding_passes`, `send_to_phone`, `sync_passes`, `forget_me`. Never auto-approved; guardrailed inside the Compass_Server. `sync_passes` is a Write_Tool because it can void passes (CTO review H1).
- **Schedule_Write_Tool**: The Write_Tools that change the attendee's real re:Invent schedule: `reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby`, `add_layover`.
- **Awsevents_Write_Tool**: The write tools of the official remote server, as listed in the AWS Events API MCP documentation: `ReserveSessions`, `CancelReservation`, `AssociateFavorites`, `DisassociateFavorite`, `CreatePersonalTime`, `UpdatePersonalTime`, `DeletePersonalTime`.
- **Guardrail**: The S2 function `checkReservation(candidate, schedule, context)` returning a `Verdict` of allow, warn or block.
- **Verdict**: The `VerdictSchema` union from `@compass/contracts`.
- **Confirmed_Write**: The S1 helper `confirmedWrite(write, getSchedule)` that performs one write, then one `GetSchedule`, and never re-sends the write.
- **Scanner**: The local, read-only repo scanner in `packages/core/src/scanner`.
- **Detector**: One Scanner component that reads one kind of file: Terraform, AWS CDK TypeScript, AWS SDK for JavaScript v3, or boto3.
- **Evidence**: Counts per service and per evidence kind. Evidence never holds file contents, file names or paths.
- **Depth**: One of `none`, `exploring`, `building`, `production`, derived from Evidence by documented rules.
- **Suggested_Level**: A session level of 100, 200, 300 or 400 derived from Depth.
- **Service_Table**: The tested mapping table from a service key to its display name, Detector identifiers and catalog taxonomy candidates.
- **Taxonomy_Label**: A value that appears in the `services` arrays of the cached catalog.
- **Planner**: The pure week planner in `packages/core/src/spec/planner.ts`.
- **Week_Spec**: The folder `.kiro/specs/my-reinvent-week/` with `requirements.md`, `design.md` and `tasks.md`.
- **Spec_Writer**: The component that writes the Week_Spec, the dated re-run file and the `.gitignore` entry.
- **Workspace_Root**: The directory the Week_Spec is written under: the path of the most recent successful `scan_repo` call in this server session, otherwise the Compass_Server working directory.
- **Schedule_Snapshot**: The local file (personal data record P4) holding the last confirmed `GetSchedule` result and the event window, in the OS app-data folder, mode `0o600`.
- **Pending_Swap**: An in-memory record that the Compass_Server proposed a safe swap: hold a repeat of an original session before cancelling the original.
- **Labelled_Data_Block**: A text block that starts with a fixed preamble stating the content is catalog data and not instructions, followed by the data encoded as JSON.
- **Hook_Runner**: The code behind `reinvent-compass hook <name>`.
- **Hook_Template**: The Kiro hook file shipped in `power/hook-templates/` that the attendee copies into `.kiro/hooks/`.
- **Power**: The Kiro Power in `power/`, in the Agent Plugins format (`plugin.json`, `mcp.json`, `skills/`).
- **Simulated_Runtime**: The composition used when `COMPASS_MODE=simulated`: the S1 simulated transport, the real rules, and the In_Process_Pass_Service.
- **In_Process_Pass_Service**: An in-memory implementation of the Compass API routes S4 calls (issue, update, void, hand-off create, forget me), used by the Simulated_Runtime, the demo and the end-to-end test.
- **Identifier_Check**: The validation every session id, event id and personal-time id passes before any S1 call.
- **SP1**: Day-1 spike "Kiro hook input and blocking" (build plan section 10), recorded by the owner as ADR-024.
- **Elicitation**: The MCP client capability that lets a server ask the user a question during a tool call (`elicitInput` in the SDK).

## Requirements

### Requirement 1: Repo scanner discovery and exclusions

**User Story:** As an attendee, I want Compass to look at my project safely, so that it learns which AWS services I use without touching or leaking my files.

#### Acceptance Criteria

1. WHEN the Scanner is given a path, THE Scanner SHALL resolve it to an absolute path and SHALL return a "folder not found" error IF the path does not exist or is not a directory.
2. THE Scanner SHALL open files for reading only and SHALL NOT create, modify, rename or delete any file or directory.
3. THE Scanner SHALL skip every directory named `node_modules`, `.git`, `dist`, `build`, `out`, `cdk.out`, `.terraform`, `coverage`, `.next`, `target`, `__pycache__`, `.venv` or `venv`.
4. THE Scanner SHALL honour `.gitignore` files in the scanned root and in every scanned subdirectory, supporting comments, blank lines, negation (`!`), directory-only patterns (trailing `/`), anchored patterns (leading or middle `/`), `*`, `**`, `?` and character classes, and SHALL skip every ignored path.
5. THE Scanner SHALL skip any file larger than 1 MiB and any file whose first 8 KiB contains a NUL byte, and SHALL count each skipped file by its reason.
6. THE Scanner SHALL NOT follow symbolic links.
7. IF the Scanner has read 20,000 files, THEN THE Scanner SHALL stop reading and SHALL report that the scan was truncated.
8. THE Scanner SHALL read only files with the extensions `.tf`, `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` or `.py`, and files named `package.json` or `requirements.txt`.

### Requirement 2: Scanner detectors

**User Story:** As an attendee, I want Compass to recognise the common ways AWS appears in code, so that the services it finds match what I really build.

#### Acceptance Criteria

1. WHEN the Terraform Detector reads a `.tf` file, THE Detector SHALL count each `resource` or `data` block whose type starts with `aws_` and SHALL attribute it to a service through the Service_Table.
2. WHEN the CDK Detector reads a TypeScript file, THE Detector SHALL count imports from `aws-cdk-lib/aws-<module>` and from the `aws_<module>` namespaces of `aws-cdk-lib`, and SHALL count each construct instantiated from an imported module.
3. WHEN the SDK Detector reads a JavaScript or TypeScript file, THE Detector SHALL count imports and requires of `@aws-sdk/client-<name>` (and `@aws-sdk/lib-dynamodb` and `@aws-sdk/lib-storage`), each `new <Name>Client(` instantiation and each `new <Name>Command(` instantiation.
4. WHEN the boto3 Detector reads a `.py` file, THE Detector SHALL count each `client("<name>")` and `resource("<name>")` call made on `boto3` or on a boto3 session.
5. WHEN a Detector reads `package.json` or `requirements.txt`, THE Detector SHALL count each declared dependency on `aws-cdk-lib`, an `@aws-sdk/client-<name>` package or `boto3` as a dependency declaration.
6. THE Detectors SHALL ignore whole-line comments (`//` and `#`) and SHALL count an AWS identifier with no Service_Table entry as unmapped, without reporting it as a service.
7. WHERE the boto3 Detector is not built (cut-list item 3), THE Scanner SHALL report that Python files were not analysed.

### Requirement 3: Evidence, depth, level and reasoning

**User Story:** As an attendee, I want to know how deeply I use each service and which session level suits me, so that the plan starts at the right depth.

#### Acceptance Criteria

1. THE Scanner SHALL report, per detected service, Evidence counts for each evidence kind: Terraform resources, CDK constructs, CDK imports, SDK imports, SDK clients, SDK commands, boto3 clients and dependency declarations.
2. THE Scanner SHALL classify each service's Depth with the documented rules: `none` with no Evidence, `exploring` with only imports or dependency declarations, `building` when infrastructure definitions or client calls exist, and `production` when the documented production thresholds are met.
3. THE Scanner SHALL derive a Suggested_Level of 100, 200, 300 or 400 from Depth with the documented table, so that a deeper Depth never gives a lower level.
4. THE Scanner SHALL give each service a reasoning sentence in plain English that names the evidence kinds and counts, the Depth and the Suggested_Level, with no em dash or en dash.
5. THE Scanner SHALL NOT include any file content, file name or path in any value it returns.
6. WHEN the same tree is scanned twice, THE Scanner SHALL return equal results regardless of directory listing order.
7. WHEN `scan_repo` returns, THE Compass_Server SHALL return `services` as the display names of services with a Depth other than `none`, and `depthByService` with Depth encoded as 0 for `none`, 1 for `exploring`, 2 for `building` and 3 for `production`, parsed by the contract output schema.

### Requirement 4: Service taxonomy mapping table

**User Story:** As an attendee, I want the services in my code matched to the catalog's own service list, so that suggested sessions really cover what I use.

#### Acceptance Criteria

1. THE Service_Table SHALL map each service key to one display name, its Terraform type prefixes, CDK module names, SDK client package names, boto3 service names and catalog taxonomy candidates.
2. WHEN the Compass_Server maps a detected service to Taxonomy_Labels, THE Compass_Server SHALL return only candidates that appear in the cached catalog's `services` values, compared case-insensitively, and SHALL report a service with no match as "not in the catalog's service list".
3. THE Service_Table SHALL map each Detector identifier to exactly one service key.
4. THE Service_Table SHALL have unique keys, and every entry SHALL have a display name, at least one Detector identifier and at least one taxonomy candidate.

### Requirement 5: Week planner

**User Story:** As a first-time attendee, I want a suggested week that fits my code, my level and my energy, so that I start from a safe, sensible plan.

#### Acceptance Criteria

1. THE Planner SHALL consider only sessions with a usable start and end time inside the event window, and SHALL report how many sessions were left out for missing times.
2. THE Planner SHALL rank candidates by matched Taxonomy_Labels weighted by Depth, by agreement with the Suggested_Level, and by goal words found in the title, with a deterministic tie-break on start time and then session code.
3. THE Planner SHALL place at most `maxPerDay` sessions on any event day, where `maxPerDay` defaults to 4 and IF it is outside 1 to 8, THEN THE Compass_Server SHALL refuse the call with a plain-English reason.
4. WHEN the Planner considers a candidate, THE Planner SHALL call the Guardrail against the confirmed schedule plus the picks made so far and SHALL skip any candidate whose Verdict is block.
5. THE Planner SHALL give every pick a reason of 1 to 200 characters in plain English that names the matched service and how the pick fits the day.
6. THE Planner SHALL add the layover suggestions that S2 `checkLayovers` returns for each planned day.
7. THE Planner SHALL suggest at most one standby (favorite) per pick, chosen from repeats of the pick or the next-ranked candidate at a different time.
8. WHEN a pick is not reservable, THE Planner SHALL mark it "walk up, no reservation needed".
9. THE Planner SHALL NOT call any Events API write operation.
10. THE Planner SHALL return commitments that each parse with `CommitmentSchema`.

### Requirement 6: Week spec content

**User Story:** As an attendee, I want my week written as a Kiro spec, so that I can read it, approve each step and run it like any other spec.

#### Acceptance Criteria

1. THE Week_Spec `requirements.md` SHALL state the attendee's goals as EARS statements, including the 10-minute boarding rule and the meal layover goal.
2. THE Week_Spec `design.md` SHALL show the itinerary by day with, for each pick, its session code, catalog title, type, level, gate (venue and room), times, reason, the connection from the previous commitment (classification, walking minutes and reason), the day's layovers and the day's energy result or count-only result.
3. THE Week_Spec `tasks.md` SHALL contain exactly one task per API action, each naming the Compass Tool that performs it, and a final task "Issue boarding passes" that names `issue_boarding_passes`.
4. THE Week_Spec SHALL render every catalog-derived string as a single line of quoted data, with control characters and line breaks removed, Markdown control characters escaped, and em dashes and en dashes replaced by hyphens.
5. THE Week_Spec SHALL include from the scan only service display names and Depth, never file names, paths or contents.
6. THE Week_Spec SHALL state the event timezone once per view and show every time in event local time.
7. WHEN the same plan input is rendered twice, THE Spec renderer SHALL produce byte-identical files.
8. THE Week_Spec SHALL contain no em dash or en dash.

### Requirement 7: Writing the week spec, re-runs and the gitignore offer

**User Story:** As an attendee, I want re-planning to be safe and my location kept private, so that I never lose edits and never publish where I will be.

#### Acceptance Criteria

1. WHEN `plan_week` runs and the Week_Spec folder has no `requirements.md`, `design.md` or `tasks.md`, THE Spec_Writer SHALL write the three files under the Workspace_Root.
2. WHEN `plan_week` runs and any Week_Spec file already exists, THE Spec_Writer SHALL leave the existing files unchanged, SHALL write a new file `week-<YYYY-MM-DD>.md` (adding `-2`, `-3` and so on when that name exists) containing the regenerated documents, and SHALL return a line diff between the existing documents and the new file.
3. IF the Workspace_Root is not an existing directory, THEN THE Spec_Writer SHALL refuse with a plain-English reason and write nothing.
4. WHEN the Week_Spec folder is not ignored by the Workspace_Root `.gitignore`, THE Compass_Server SHALL offer to add `.kiro/specs/my-reinvent-week/` to `.gitignore` and SHALL explain that a public repository would publish where the attendee will be and when.
5. WHERE the client declares the Elicitation capability, THE Compass_Server SHALL ask the gitignore question through Elicitation, SHALL append the entry only on an explicit accept, and SHALL leave `.gitignore` unchanged on decline or cancel.
6. WHERE the client does not declare the Elicitation capability, THE Compass_Server SHALL return the offer, the reason and the exact line to add in the tool text, and SHALL NOT change `.gitignore`.
7. WHEN the Spec_Writer appends the gitignore entry, THE Spec_Writer SHALL create `.gitignore` if absent, SHALL preserve all existing content, and SHALL NOT add the entry twice.

### Requirement 8: MCP server and tool registration

**User Story:** As an attendee using any desktop MCP client, I want a predictable set of tools with clear descriptions, so that I know what each one does before I approve it.

#### Acceptance Criteria

1. THE Compass_Server SHALL communicate over stdio using `McpServer` and `StdioServerTransport` from `@modelcontextprotocol/sdk`.
2. THE Compass_Server SHALL register exactly the seventeen Tools keyed in `mcpTools`, using each entry's input and output schema from `@compass/contracts` without redeclaring either.
3. THE Compass_Server SHALL give every Write_Tool a description that states the real change it makes, and every Schedule_Write_Tool description SHALL state that it changes the attendee's real re:Invent schedule.
4. THE Compass_Server SHALL set `readOnlyHint: true` on every Read_Tool and `destructiveHint: true` on every Write_Tool.
5. WHEN a Tool succeeds, THE Compass_Server SHALL return `structuredContent` that parses with that Tool's contract output schema and a plain-English text summary.
6. THE Compass_Server SHALL write nothing but MCP protocol messages to stdout, and SHALL write log lines only to stderr through a redacting logger.
7. THE Compass_Server SHALL NOT call one Tool's handler from another, and SHALL perform an Events API write only inside the handler of the Write_Tool the client called.
8. THE Compass_Server SHALL complete MCP initialisation without reading the catalog, the network or the keychain, so that cold start stays under the 1.5 second budget.

### Requirement 9: Session and catalog tools

**User Story:** As an attendee, I want to sign in, refresh the catalog and search it from my assistant, so that planning starts from live data.

#### Acceptance Criteria

1. WHEN `sign_in` is called, THE Compass_Server SHALL run the S1 sign-in flow and SHALL return `signedIn` and, when known, `expiresAt`, and SHALL include the S1 memory-only notice in the text when tokens are held in memory only.
2. WHEN `sign_out` is called, THE Compass_Server SHALL run the S1 sign-out flow and SHALL include the Builder ID sign-out URL returned by S1 in the text.
3. WHEN `refresh_catalog` is called, THE Compass_Server SHALL fetch every catalog page through S1 with `includeAbstracts=false`, SHALL resolve the event window through S1 from ListEvents and GetEvent, and SHALL return `sessionCount` and `refreshedAt`.
4. WHEN `find_sessions` is called, THE Compass_Server SHALL filter the cached catalog locally through S1, SHALL apply `limit` with a default of 20 and a maximum of 50, and SHALL return `totalMatched` as the count before the limit.
5. IF a Tool that needs sign-in is called while the attendee is not signed in, THEN THE Compass_Server SHALL return a plain-English error asking the attendee to run `sign_in`.
6. WHERE the Simulated_Runtime is active, THE Compass_Server SHALL present a signed-in attendee without opening a browser or calling any OAuth endpoint.

### Requirement 10: Catalog text returned as labelled data

**User Story:** As an attendee, I want text from the catalog treated as data, so that a session description cannot trick my assistant into booking.

#### Acceptance Criteria

1. WHEN a Tool returns catalog-derived text in its text content, THE Compass_Server SHALL place it inside a Labelled_Data_Block.
2. THE Compass_Server SHALL NOT return session abstracts from any Tool.
3. WHILE a Read_Tool, `plan_week` or `check_itinerary` handler runs, THE Compass_Server SHALL NOT send any Events API write operation or Compass API write request.
4. WHEN a session title or abstract contains instructions, THE Compass_Server SHALL NOT perform any write as a result of reading it.
5. THE Compass_Server SHALL return from `scan_repo` only service names, Depth values, levels, counts and reasoning, never repository text.

### Requirement 11: Identifier checks on tool arguments

**User Story:** As an attendee, I want every identifier my assistant passes to be checked, so that a prompt-injected argument cannot reach the Events API in an unexpected shape.

#### Acceptance Criteria

1. WHEN a session id, event id or personal-time id reaches a Tool handler, THE Compass_Server SHALL apply the Identifier_Check before any S1 call.
2. IF an identifier is empty, equals `.` or `..`, contains `/` or `\`, contains a control character, or is longer than 256 characters, THEN THE Compass_Server SHALL refuse the call with a plain-English reason that does not echo the identifier and SHALL NOT call S1.
3. IF a session id passes the Identifier_Check but is not in the cached catalog, THEN THE Compass_Server SHALL refuse to act on that session and SHALL ask the attendee to run `refresh_catalog`.
4. WHEN a Write_Tool reports what it acted on or will act on, THE Compass_Server SHALL show the exact session ids with their session codes and titles taken from the cached catalog, and SHALL NOT take any session title or code from text the model supplied.

### Requirement 12: Guarded reservation

**User Story:** As an attendee, I want every booking checked against my week before it is sent, so that I never book a clash or an impossible walk.

#### Acceptance Criteria

1. WHEN `reserve_with_guardrails` is called, THE Compass_Server SHALL read a fresh schedule through S1 `GetSchedule` and SHALL resolve every requested session from the cached catalog before judging.
2. THE Compass_Server SHALL run the Guardrail for each requested session against the confirmed schedule plus the earlier sessions in the same request, and SHALL combine the Verdicts with block over warn over allow, keeping every reason prefixed with its session code.
3. IF the combined Verdict is block, THEN THE Compass_Server SHALL NOT send ReserveSessions and SHALL return the Verdict, the S2 rebooking options and, when one exists, a safe swap suggestion.
4. WHEN the combined Verdict is allow or warn, THE Compass_Server SHALL send ReserveSessions exactly once through the Confirmed_Write and SHALL NOT retry it.
5. WHEN the Confirmed_Write returns, THE Compass_Server SHALL report a session as reserved only when the confirmed schedule lists it, SHALL report every refusal (including an unrecognised refusal code) in plain English, and SHALL offer rebooking options for a full session.
6. IF the write succeeded but the schedule could not be read back, THEN THE Compass_Server SHALL say that the booking is unconfirmed, SHALL ask the attendee to check before trying again, and SHALL NOT resend.
7. WHEN the combined Verdict is warn, THE Compass_Server SHALL show every warning reason at the top of the text result.
8. WHEN a schedule is read, THE Compass_Server SHALL update the Schedule_Snapshot.

### Requirement 13: Cancellation and the safe swap

**User Story:** As an attendee, I want to move to a repeat without ever losing both seats, so that rebooking is safe.

#### Acceptance Criteria

1. WHEN the Compass_Server suggests a safe swap, THE Compass_Server SHALL record a Pending_Swap naming the original session and the repeat, chosen from S2 rebooking options so that the repeat passes the Guardrail against the schedule without the original and with the blocked session.
2. WHEN `cancel_reservation` is called for a session in a Pending_Swap, THE Compass_Server SHALL read a fresh schedule and run S2 `planSafeSwap`, and SHALL cancel only when the outcome is safe.
3. IF the Pending_Swap outcome is failed or unsafe on the first cancel call for that session, THEN THE Compass_Server SHALL NOT send CancelReservation, SHALL return `cancelled: false`, and SHALL explain that cancelling now could leave the attendee with neither seat.
4. WHEN `cancel_reservation` is called again for the same session after such a refusal, THE Compass_Server SHALL, WHERE the client declares Elicitation, ask an explicit "cancel anyway" question and cancel only on accept, and OTHERWISE SHALL honour the second call only within 5 minutes of the refusal; in both cases it SHALL drop the Pending_Swap and cancel through the Confirmed_Write, and the refusal text SHALL state the rule (CTO review M1).
5. WHEN `cancel_reservation` is called for a session that is not in the confirmed schedule's reserved list, THE Compass_Server SHALL return `cancelled: false` with a reason and SHALL NOT send CancelReservation.
6. WHEN a cancellation is sent, THE Compass_Server SHALL send CancelReservation exactly once through the Confirmed_Write and SHALL return `cancelled: true` only when the confirmed schedule no longer lists the session.
7. THE Compass_Server SHALL keep Pending_Swaps in memory only and SHALL clear one when its swap completes, when it is dropped, or when the server exits.
8. WHEN a cancelled session has an issued boarding pass, THE Compass_Server SHALL tell the attendee to run `sync_passes` to void it.

### Requirement 14: Standby and layovers

**User Story:** As an attendee, I want to keep backups and protect meal breaks, so that a full session or a long day does not derail me.

#### Acceptance Criteria

1. WHEN `add_standby` is called, THE Compass_Server SHALL send AssociateFavorites once through the Confirmed_Write, SHALL report per-session results, and SHALL state that standby is a backup and not a reservation.
2. WHEN `remove_standby` is called, THE Compass_Server SHALL send DisassociateFavorite once through the Confirmed_Write and SHALL return `removed: true` only when the confirmed schedule no longer lists the favorite.
3. WHEN `add_layover` is called, THE Compass_Server SHALL send CreatePersonalTime once through the Confirmed_Write and SHALL return the `personalTimeId` of the confirmed entry whose title, start and end match the request.
4. IF a layover's end is not after its start, or either time is outside the event window or lacks an offset, THEN THE Compass_Server SHALL refuse with a plain-English reason and SHALL NOT call S1.
5. WHEN a requested layover overlaps a commitment, THE Compass_Server SHALL include a warning naming the overlap and SHALL still create the layover.
6. THE Compass_Server SHALL treat a layover title as the attendee's own text and SHALL show it back only inside a Labelled_Data_Block.

### Requirement 15: Boarding pass tools

**User Story:** As an attendee, I want passes for my reserved sessions on my phone and kept in step with my schedule, so that I board on time.

#### Acceptance Criteria

1. WHEN `issue_boarding_passes` is called, THE Compass_Server SHALL refuse every requested session that the fresh confirmed schedule does not list as reserved, without a Compass API call for it.
2. WHEN `issue_boarding_passes` issues a pass, THE Compass_Server SHALL refresh the session through S1 GetSession, build its fields through S4 `buildPass`, issue through the S4 Compass client, record it in the S4 pass store, and return the issued session ids and serials.
3. THE Compass_Server SHALL state in pass tool text that each pass is unofficial and that the badge is the ticket, and SHALL NOT claim that a pass can be deleted from a phone.
4. WHEN `send_to_phone` is called, THE Compass_Server SHALL create a hand-off through S4 for the serials of the chosen sessions (or all issued passes when none are chosen), SHALL return `handoffUrl` and `expiresAt`, and SHALL include the S4 text QR code and PNG QR code in the result.
5. IF `send_to_phone` is called before any pass is issued, THEN THE Compass_Server SHALL return a plain-English error asking the attendee to issue passes first.
6. WHEN `sync_passes` is called, THE Compass_Server SHALL run S4 sync against a fresh confirmed schedule and SHALL return the session ids issued, updated and voided.
7. WHERE `sync_passes` is given `sessionIds`, THE Compass_Server SHALL consider only passes and sessions for those ids and SHALL NOT issue, update or void any other pass.
8. WHEN `export_calendar` is called, THE Compass_Server SHALL build the calendar through the S4 exporter from the given commitments or, when none are given, from the confirmed schedule, and SHALL return the `.ics` text.

### Requirement 16: forget_me and local personal data

**User Story:** As an attendee, I want to delete everything Compass holds about me with one command, so that I can exercise my POPIA rights.

#### Acceptance Criteria

1. WHEN `forget_me` is called with `confirm: true`, THE Compass_Server SHALL run the S4 forget-me orchestrator and, only on its success, SHALL delete the Schedule_Snapshot and clear the in-memory scan result and Pending_Swaps.
2. WHEN `forget_me` succeeds, THE Compass_Server SHALL state that passes were voided and will expire, and SHALL NOT claim they were deleted from any phone.
3. IF the S4 forget-me orchestrator fails, THEN THE Compass_Server SHALL leave local data in place and SHALL say that nothing was deleted.
4. THE Compass_Server SHALL write the Schedule_Snapshot to the OS app-data folder with mode `0o600`, holding the confirmed schedule, the event window and the fetch time, and never a token or email.
5. WHERE the Simulated_Runtime is active, THE Compass_Server SHALL keep the Schedule_Snapshot and every other local file in a `simulated` subfolder of the app-data folder.

### Requirement 17: Errors, redaction and logging

**User Story:** As an attendee, I want clear errors that never leak my credentials, so that I can trust Compass.

#### Acceptance Criteria

1. WHEN an S1 typed error, an S4 pass error or a validation failure reaches a Tool handler, THE Compass_Server SHALL return `isError: true` with a plain-English message from a fixed table.
2. THE Compass_Server SHALL keep every access token, refresh token, ID token, email, `Authorization` header value, hand-off URL and hand-off id out of all log lines and error messages.
3. THE Compass_Server SHALL NOT echo free-text Tool input in any error message.
4. WHEN a rate limit error reaches a Write_Tool handler, THE Compass_Server SHALL report the wait and SHALL NOT retry the write.

### Requirement 18: CLI

**User Story:** As an attendee or a judge, I want one command to run Compass and one to see it work, so that trying it takes a minute.

#### Acceptance Criteria

1. WHEN `reinvent-compass` runs with no arguments, THE CLI SHALL start the Compass_Server on stdio.
2. WHEN `reinvent-compass demo` runs, THE CLI SHALL force the Simulated_Runtime, SHALL make no network request, and SHALL print the flow in order: scan the sample repo, plan, a blocked clash, a safe swap, reserve, issue passes, QR hand-off, cancel, void.
3. WHEN the demo completes, THE CLI SHALL exit with code 0, and IF any demo step fails, THEN THE CLI SHALL print which step failed and exit with code 1.
4. WHEN `reinvent-compass hook <name>` runs, THE CLI SHALL read the hook input as JSON from stdin only, up to 1 MiB and 5 seconds, SHALL accept only the names `pre-write-guardrail` and `post-write-sync`, and SHALL NOT spawn any shell or subprocess.
5. THE CLI SHALL exit a `hook` command only with code 0 or code 2.
6. WHEN `--version` or `--help` is given, THE CLI SHALL print the package version or usage to stdout and exit with code 0.
7. IF an unknown command is given outside `hook`, THEN THE CLI SHALL print usage to stderr and exit with code 1.
8. THE CLI entry file `bin.ts` SHALL only pass `process.argv`, stdin, stdout, stderr and the environment to a tested function.

### Requirement 19: Kiro hooks

**User Story:** As a Kiro user, I want the same guardrail to run before the agent calls a write tool, so that I see problems before I approve.

#### Acceptance Criteria

1. WHEN the pre-write guardrail receives an Awsevents_Write_Tool call, THE Hook_Runner SHALL block it with exit code 2 and a reason on stderr that points to the Compass guarded tool.
2. WHEN the pre-write guardrail receives a `reserve_with_guardrails` call, THE Hook_Runner SHALL run the Guardrail against the Schedule_Snapshot and the cached catalog, SHALL exit 2 with the reasons on stderr for a block, SHALL exit 0 with the reasons and the catalog titles on stdout for a warn, and SHALL exit 0 silently for an allow.
3. IF the hook input is malformed, the tool is unknown, or the Schedule_Snapshot is missing or older than 15 minutes, THEN THE Hook_Runner SHALL exit 0 with a note that the server guardrail still checks the call.
4. WHEN the pre-write guardrail receives any other Compass Write_Tool call, THE Hook_Runner SHALL exit 0 without output.
5. WHEN the post-write sync hook receives a Schedule_Write_Tool or Awsevents_Write_Tool call, THE Hook_Runner SHALL exit 0 and print a one-line reminder to run `sync_passes`, and for any other tool SHALL exit 0 without output.
6. THE Hook_Runner SHALL take the tool name from the `tool_name` field, accepting both the `mcp_<server>_<tool>` form and a bare tool name, and SHALL NOT place any input value into a command line.
7. THE Hook_Runner SHALL NOT perform any write or any network request.

### Requirement 20: Kiro Power package

**User Story:** As a Kiro user, I want a one-click Power, so that Compass, its skills and its safety settings install together.

#### Acceptance Criteria

1. THE Power `plugin.json` SHALL contain the Agent Plugins `$schema`, the name `reinvent-compass`, a version equal to the `reinvent-compass` package version, a description, an author name, the license `Apache-2.0`, and exactly the keywords `reinvent`, `re:Invent`, `conference`, `sessions`, `schedule`, `boarding pass`, `first-timer`.
2. THE Power `mcp.json` SHALL define `compass` as a stdio server started with `npx --yes reinvent-compass@<version>` using only the Agent Plugins stdio keys, and SHALL NOT define `awsevents` until ADR-024 confirms that `disabledTools` is honoured in a Power; once confirmed it SHALL define `awsevents` with the URL and OAuth values from tech.md and `disabledTools` listing exactly the seven Awsevents_Write_Tools (CTO review H2).
3. THE Power SHALL provide the skills `plan-my-week`, `first-timer-guide` and `install-hooks`, each a `SKILL.md` with `name` and `description` front matter.
4. THE `first-timer-guide` skill SHALL cite only official AWS pages, each with its URL, on the hosts `reinvent.awsevents.com`, `aws.amazon.com` or `docs.aws.amazon.com`.
5. THE `plan-my-week` skill SHALL tell the agent to run `check_itinerary` and show the human the session codes and catalog titles before asking for approval of any Write_Tool call.
6. THE Hook_Template SHALL use the Kiro hook schema version `v1` with a PreToolUse guardrail hook whose matcher covers the eight Compass Write_Tools and the seven Awsevents_Write_Tools, and a PostToolUse sync hook, each running `npx --yes reinvent-compass@<version> hook <name>` with no template variables and a 30 second timeout.
7. THE Power SHALL NOT list any Write_Tool or Awsevents_Write_Tool in any `autoApprove` entry.
8. THE Power SHALL use no AWS logo or wording that suggests an official AWS product, and SHALL contain no em dash or en dash.

### Requirement 21: Setup for other MCP clients

**User Story:** As an attendee who does not use Kiro, I want setup steps for my client, so that I can still plan with Compass.

#### Acceptance Criteria

1. THE `packages/mcp-server/README.md` SHALL document setup for Kiro (the Power), Claude Desktop, VS Code and the Kiro CLI, each citing that client's official MCP documentation page checked when written.
2. THE README SHALL state that hooks are Kiro-only and that the guardrail runs inside the Compass_Server regardless of client.
3. THE README SHALL list the Read_Tools that may be auto-approved and state that Write_Tools must never be.
4. THE README SHALL document simulated mode, the `demo` command, and what leaves the attendee's machine.

### Requirement 22: Simulated mode and the in-process pass service

**User Story:** As a judge or developer, I want the whole flow to run with nothing live attached, so that I can try and test it safely.

#### Acceptance Criteria

1. WHERE `COMPASS_MODE=simulated` is set, THE Compass_Server SHALL use the Simulated_Runtime and SHALL send no request to the Events API or the Compass API.
2. THE In_Process_Pass_Service SHALL implement issue, update, void, hand-off create and forget me with the request and response shapes of the generated `CompassApi` types, and SHALL validate pass fields with `createPassFieldsSchema` for the event window.
3. THE In_Process_Pass_Service SHALL create UUID v4 serials, 16-byte base64url hand-off ids, hand-off expiry 15 minutes after creation, and a board URL on the reserved `.invalid` domain with the id in the URL fragment.
4. THE In_Process_Pass_Service SHALL treat a repeated void of the same serial as success and SHALL expose the voided state to tests.

### Requirement 23: Integration seams with S1, S2 and S4

**User Story:** As the integrator, I want S3 to depend on the other streams only through their documented interfaces, so that parallel work merges cleanly.

#### Acceptance Criteria

1. THE Compass_Server SHALL reach S1, S2 and S4 only through injected ports whose adapters import the declared subpath exports, and tests SHALL use fakes for those ports until each stream is merged.
2. THE ID token adapter SHALL supply S4's `IdTokenProvider.getIdToken` from S1's `IdTokenProvider.getIdTokenForCompassApi`, and SHALL NOT expose the ID token to any Events API call.
3. THE Compass_Server SHALL build the S2 rules context with `now` from an injected clock, the timezone from the S1 event window, and venue data parsed from `data/venues.json` through S2's exported context schema.
4. THE Compass_Server SHALL NOT hard-code event dates, the event timezone or session reservability.
5. WHEN S1, S2 and S4 are merged, THE adapter tests SHALL run against the real modules.

### Requirement 24: SP1 verification and hook adjustment

**User Story:** As the owner, I want the hooks matched to how Kiro really behaves, so that the defence in depth works and nothing breaks if it does not.

#### Acceptance Criteria

1. THE design SHALL record what the Kiro documentation says about hook input, blocking, MCP tool names, Power hooks and `disabledTools`, with the documentation URLs, and SHALL include an owner-run SP1 checklist.
2. THE Hook_Runner SHALL keep tool name parsing and exit code policy in one module, so that an SP1 result changes that module, the Hook_Template and their tests only.
3. WHEN the owner records the SP1 result, THE compass-power stream SHALL adjust the Hook_Runner, the Hook_Template, the Power `mcp.json` and their tests to match it.
4. IF SP1 shows that a PreToolUse hook cannot block, THEN THE Hook_Runner SHALL warn only, through stdout with exit code 0.
5. IF SP1 shows that a Power's `awsevents` entry with `disabledTools` is rejected or not honoured, THEN THE README and the `install-hooks` skill SHALL document the workspace MCP configuration with `disabledTools` instead, and the PreToolUse block on Awsevents_Write_Tools SHALL remain.
6. THE Compass_Server guardrail SHALL behave the same whatever the SP1 result.

### Requirement 25: Testing and acceptance

**User Story:** As the owner, I want the whole flow proven end to end and every module fully covered, so that S3 passes the review gate.

#### Acceptance Criteria

1. THE compass-power test suite SHALL include a simulated end-to-end acceptance test, through an in-memory MCP client, of: scan the sample repo, plan, a blocked clash, a safe swap, reserve, issue passes through the In_Process_Pass_Service, QR hand-off, cancel and void.
2. THE compass-power test suite SHALL run the `demo` command and assert that every step succeeds.
3. THE compass-power test suite SHALL include Scanner fixture tests on `fixtures/sample-repo`, creating decoy files only in a temporary copy and never in tracked fixtures.
4. THE compass-power test suite SHALL include a prompt-injection test in which a session title and abstract contain instructions to book, and SHALL assert that no write operation is sent.
5. THE compass-power test suite SHALL implement every correctness property with `fast-check`, at least 100 runs each, tagged with the feature name and property number.
6. THE compass-power test suite SHALL reach 100% lines, branches, functions and statements for owned code, with `packages/mcp-server/src/bin.ts` as the only named exclusion.
7. THE compass-power test suite SHALL NOT call the live Events API or the live Compass API.
8. THE compass-power stream SHALL save two or three simulated-mode screenshots or terminal captures to `docs/article/screenshots/compass-power/`.
9. THE compass-power owned files SHALL contain no em dash or en dash.

## CTO review amendments

These amendments came from the CTO review and take precedence over the criteria above where they differ.

1. **H1.** `sync_passes` is a Write_Tool (`destructiveHint`, never auto-approved, listed as such in the README and the `plan-my-week` skill). The passes adapter never calls S4 `syncPasses` with partial input: it wraps the pass store in a narrowing view (`read` returns only the narrowed entries, `write` merges untouched entries back), and issue is the Compass client `issuePasses` plus S4 `fieldsHash` plus `store.write`.
2. **H2.** `power/mcp.json` has no `awsevents` entry until ADR-024 confirms `disabledTools` in a Power. A structural test fails if `awsevents` is present while ADR-024 is missing or negative.
3. **H3.** The end-to-end and demo triple is A = `syn-024` (BWP213, 1 December 13:00), A-R = `syn-025` (BWP213-R, 4 December 11:30, with seats) and B = `syn-076` (ARC228, 1 December 13:00 to 14:30, reservable, clashes with A and not with A-R), re-picked after the synthetic catalog was regenerated so that every repeat is a true repeat. The ids are pinned in one constant and asserted to exist in `fixtures/synthetic/catalog.json`, and the real S2 engine is asserted to block B against A, accept the safe swap from A to A-R, and not block B against A-R.
4. **M1.** Criterion 13.4 above is replaced by the elicited "cancel anyway" or five-minute rule.
5. **M2.** "Exactly once" means: no application-level resend, and at most one transport retry only after a rejected, unprocessed request (S1 401 and 429, S4 429). The task 26 adapter tests pin the real counts.
6. **M3.** `plan_week` states the absolute target folder in its text and, where the client declares Elicitation, asks the human to confirm it. The writer uses `lstat` on every path component under the root and refuses symlinks, creates files with the `wx` flag, and never appends to a symlinked `.gitignore`.
7. **M4.** WHERE the client declares Elicitation, every Schedule_Write_Tool elicits a confirmation before the write, listing the ids, codes and titles from the catalog plus every warning. Decline or cancel means no write.
8. **M5.** The SP1 probe tool is `ProbeWrite` on server `sp1-probe`, and the exact `tool_name` is recorded. `identifyTool` is case-insensitive and the hook matcher is `.*(...)$`.
9. **M6.** The `find_sessions` service filter is applied by the adapter over the cached wire `services` (any match, case-insensitive), because S1 `filterCatalog` takes one service over `NormalisedSession`, which has no `services` field.
10. **M7.** The Simulated_Runtime clock is pinned at `2026-11-29T18:00:00-08:00`.
11. **M8.** The rules adapter codes against S2 `connectionsForDay(schedule, context)`, `energyForDay(schedule, context)` and `withContextDefaults` (S2 `context.ts`).
12. **M11.** The SP1 checklist adds "Import power from GitHub" with the repository URL and with the `power/` subfolder URL; the README install section follows the result and documents both until then.
13. **L1.** The registry catches every handler throw and returns a fixed message, tested through the in-memory client.
14. **L2.** `find_sessions.limit` and `plan_week.maxPerDay` refuse negative and non-integer values.
15. **L3.** The npx local-copy risk is recorded in the threat model (README), and SP1 records the stdio server's working directory.
16. **L5.** The platform is injected; `process.platform` branches stay out of `src`.

## Review round 2 amendments

These came from the S3 code reviews (QA and security) after the first build. They take precedence over the criteria above where they differ.

R2.1. **Scan limits.** A scan SHALL finish inside 20 seconds in a worker thread that is terminated when the budget is spent, SHALL visit at most 200,000 entries and 40 directory levels, and SHALL use a linear import parser and bounded gitignore patterns (at most 256 characters, 8 stars, 2000 rules per file), so crafted repository content cannot make the server slow.
