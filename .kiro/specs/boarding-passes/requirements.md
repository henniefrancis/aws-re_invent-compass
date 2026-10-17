# Requirements Document

## Introduction

This spec owns stream S4, the local "pass side" of re:Invent Compass, living under `packages/core/src/passes/**`. It turns a confirmed schedule into unofficial boarding passes, keeps those passes in sync as the schedule changes, hands them off to a phone through a QR code, and produces local calendar and itinerary files. Everything here runs on the attendee's own machine. The only data that leaves is the Builder ID ID token (as a bearer credential to the Compass API) and the printable pass fields.

This spec consumes the Compass API only through a client generated from `contracts/compass-api.openapi.yaml`, and it reuses the shared types and schemas (PassFields, Session, Schedule, Commitment, Problem) from `@compass/contracts` (S0). It does not redefine those shapes, and it does not edit any other stream's files. Where a change is needed in an S0 contract, that is raised as an S0 change request rather than made here.

S4 receives the ID token (from S1, the auth module) and the walk and boarding data (from S2, the rules engine) only through injected interfaces. Those interfaces are mocked until S1 and S2 merge; this spec never depends on either stream's unmerged code.

All names and attendee-facing copy follow the airline metaphor (BoardingPass, Connection, Layover, Standby, rebook, voidPass). No copy, comment, document, test name or commit message uses an em dash or an en dash.

## Glossary

- **Pass_Builder**: The component that builds PassFields from a confirmed session and the schedule, validating against the shared PassFields schema from `@compass/contracts`.
- **Compass_Client**: The typed client that calls the Compass API through the contract-generated types, sending the ID token as a bearer credential and validating every response with zod.
- **Pass_Store**: The component that reads and writes the local issued-pass record in the OS app-data folder.
- **Pass_Sync**: The component that diffs the current schedule against the issued-pass record and drives issue, update and void.
- **Handoff_Builder**: The component that creates a hand-off through the Compass_Client and renders the returned board URL as a QR code.
- **Ics_Exporter**: The component that writes an RFC 5545 calendar file from the itinerary.
- **Itinerary_Page**: The component that renders a self-contained offline HTML itinerary.
- **PassFields**: The shared pass-content shape and zod schema from `@compass/contracts` (build plan 5.3). Not redefined in this spec.
- **Schedule**: The confirmed schedule returned by the Events API GetSchedule operation, shaped by `@compass/contracts`.
- **Commitment**: One itinerary entry (a reserved session or a layover) from `@compass/contracts`.
- **Session**: A catalog session with timing and venue, shaped by `@compass/contracts`.
- **Problem**: The `application/problem+json` error body `{type, title, status, code}` from `@compass/contracts`.
- **ID_Token**: The Builder ID ID token from the auth module (S1), sent to the Compass API as a bearer credential and never logged or stored by this spec.
- **Issued_Pass_Record**: The local personal-data record P5 (serialNumber, session code, a hash of the pass fields, platform), stored in the app-data folder with file mode 0600.
- **App_Data_Folder**: The per-OS location for local personal data: `%APPDATA%` on Windows, `~/Library/Application Support` on macOS, or `$XDG_DATA_HOME` with the suffix `/reinvent-compass` on Linux.
- **Board_URL**: The URL returned by the create-hand-off operation, carrying the hand-off id in its URL fragment, that a phone opens to collect passes.
- **Ellipsis_Character**: The single Unicode horizontal ellipsis character used when a title is truncated.
- **Boarding_Closes**: The moment ten minutes before a session starts, derived from the server-supplied session start.
- **Connection**: The walk between two consecutive commitments.
- **Event_Window**: The event start, end and timezone from the Events API GetEvent operation, supplied at runtime to the PassFields schema factory.

## Requirements

### Requirement 1: Build PassFields from a confirmed session and schedule

**User Story:** As a first-time attendee, I want each reserved session turned into a valid boarding pass's fields, so that my pass shows the right session, gate, boarding time and next connection.

#### Acceptance Criteria

1. WHEN the Pass_Builder is given a confirmed Session and the Schedule, THE Pass_Builder SHALL produce a PassFields value that validates against the PassFields schema from `@compass/contracts` created for the current Event_Window.
2. THE Pass_Builder SHALL derive Boarding_Closes as the session start minus ten minutes using the server-supplied session start.
3. WHERE a previous Commitment exists before the session, THE Pass_Builder SHALL populate the walk-from-previous field with the walk minutes and the previous venue.
4. WHERE a following Commitment exists after the session, THE Pass_Builder SHALL populate the next-connection field with the following session code, start, venue and walk minutes.
5. WHEN a session title is processed, THE Pass_Builder SHALL normalise the text first, and IF the normalised title is longer than eighty characters, THEN THE Pass_Builder SHALL truncate it to seventy-seven characters followed by "..." (three ASCII full stops), because the single Unicode horizontal ellipsis character is not in the PassFields text allowlist.
6. WHERE the attendee has recorded a local opt-in for a displayed name, THE Pass_Builder SHALL include the attendee name field constrained to between one and forty characters.
7. WHERE the attendee has not recorded a local opt-in for a displayed name, THE Pass_Builder SHALL omit the attendee name field.
8. THE Pass_Builder SHALL run `normalisePassText` from `@compass/contracts` on the title, venue, room and from-venue values before validation. IF the title still fails the text rules after normalisation, THEN THE Pass_Builder SHALL use the text "Title not shown" and SHALL keep the session code. IF a venue or room still fails after normalisation, THEN THE Pass_Builder SHALL send it as an empty string. THE Pass_Builder SHALL never echo the rejected text.
9. WHEN the venue or the room for a session is empty, THE Pass_Builder SHALL send the venue and room as empty strings, and the text "Venue not published" SHALL be rendered from an empty value rather than sent as field content.
10. THE Pass_Builder SHALL rely on the server to set the boarding-closes, disclaimer, expiration, relevant-dates, transit-type and sharing-prohibited fields, and SHALL send no barcode field.
11. THE boarding-passes module SHALL provide `buildPassFor(schedule, deps)`, returning the pass-building function Pass_Sync injects (with the previous commitment and the next reserved session as neighbours and walk minutes from an injected lookup), and `buildItinerary(schedule, walks)`, returning the ordered Itinerary with each reserved commitment's walk minutes, so that consumers do not rebuild that logic.

### Requirement 2: Call the Compass API through a contract client

**User Story:** As an attendee, I want all pass operations to go through one safe client, so that my passes are issued, downloaded, updated, voided, handed off and forgotten without my credentials or input leaking.

#### Acceptance Criteria

1. WHEN the attendee issues passes, THE Compass_Client SHALL send a POST request to `/api/v1/passes` with the platforms and the PassFields array, and SHALL validate the response against the contract issue-response schema.
2. WHEN the attendee downloads an Apple pass, THE Compass_Client SHALL send a GET request to `/api/v1/passes/{serialNumber}/apple` and SHALL return the Apple pass body.
3. WHEN the attendee updates a pass, THE Compass_Client SHALL send a PUT request to `/api/v1/passes/{serialNumber}` with the PassFields, and SHALL validate the response against the contract update-response schema.
4. WHEN the attendee voids a pass, THE Compass_Client SHALL send a POST request to `/api/v1/passes/{serialNumber}/void` and SHALL validate the response against the contract void-response schema.
5. WHEN the void operation is sent more than once for the same serial number, THE Compass_Client SHALL treat a success response as the completed state without reporting an error.
6. WHEN the attendee creates a hand-off, THE Compass_Client SHALL send a POST request to `/api/v1/handoffs` with the chosen serial numbers and include flags, and SHALL validate the response against the contract hand-off-response schema.
7. WHEN the attendee invokes forget-me, THE Compass_Client SHALL send a DELETE request to `/api/v1/me` and SHALL validate the response against the contract forget-me-response schema. WHEN the response status is 202 (even if its body does not match the contract), 404 or 410, THE forgetMe orchestrator SHALL delete the Issued_Pass_Record and the whole app-data `output/` folder (only after checking that the folder is `output` inside a folder named `reinvent-compass`), and its copy SHALL state that passes are voided and expire and SHALL NOT claim that passes are deleted from the phone.
8. THE Compass_Client SHALL attach the ID_Token as an HTTP Bearer credential on every attendee route request.
9. IF a response body is `application/problem+json`, THEN THE Compass_Client SHALL parse it against the Problem schema and SHALL surface the error without echoing the request input.
10. IF a response status is 429 and a Retry-After header is present, THEN THE Compass_Client SHALL wait for the Retry-After duration and SHALL retry the request once, provided the wait is at most 60 seconds; IF the wait is longer, THEN THE Compass_Client SHALL NOT retry early and SHALL surface the rate-limit error carrying the server's full wait in seconds.
11. THE Compass_Client SHALL perform no automatic retry of a write request that would bypass human approval.
12. IF a response body fails validation against its contract schema, THEN THE Compass_Client SHALL report a validation failure and SHALL NOT return unvalidated data.
13. THE Compass_Client SHALL treat a 404 on update or void as the serial being gone only WHEN the response is `application/problem+json` and its body parses as the contract Problem; any other 404 SHALL be reported as an error.
14. THE Compass_Client SHALL accept a base URL only when its host is an exact entry (compared in lower case) of a required caller-supplied allowlist, or a local host with an explicit simulated flag, with no pattern matching of any kind, and SHALL refuse credentials, a query, a fragment and (outside simulated runs) a port other than 443 or plain http. The client SHALL NOT send an `x-api-key` header, because CloudFront adds it.
15. THE Compass_Client SHALL, unless the check is switched off by its `checkTokenUse` option, refuse to send an ID token whose unverified payload does not carry `token_use` equal to `id`, and SHALL reduce the title, code and type of a server-supplied Problem to a safe character set and length before surfacing them.

### Requirement 3: Store the issued-pass record locally

**User Story:** As an attendee, I want a private local record of the passes I have issued, so that sync can tell what changed without that record leaving my machine.

#### Acceptance Criteria

1. WHEN the Pass_Store writes the Issued_Pass_Record, THE Pass_Store SHALL write it inside the App_Data_Folder resolved for the current operating system.
2. THE Pass_Store SHALL resolve the App_Data_Folder as `%LOCALAPPDATA%` on Windows (falling back to an absolute `%APPDATA%`, then to the user's `AppData\Local`), as `~/Library/Application Support` on macOS, and as `$XDG_DATA_HOME` with the suffix `/reinvent-compass` on Linux.
3. THE Issued_Pass_Record SHALL hold, for each issued pass, the serial number, the session code, a hash of the pass fields and the platform.
4. WHEN the Pass_Store creates the Issued_Pass_Record file, THE Pass_Store SHALL set the file mode to 0600.
5. WHEN the Pass_Store reads an absent Issued_Pass_Record, THE Pass_Store SHALL return an empty record.
6. THE Pass_Store SHALL exclude the ID_Token and the attendee email from the Issued_Pass_Record.
7. THE Pass_Store SHALL write the record atomically (a temporary file in the same folder renamed over the record), SHALL keep exactly one `.bak` copy of the previous record (overwritten only from a record that parses), and SHALL create the app-data folder with mode 0700.
8. THE Pass_Store SHALL serialise a read-modify-write run with an in-process mutex per record path and a cross-process lock file created with exclusive-create semantics, and SHALL write a random owner token into the lock file, release it only while it still holds that token, refresh its timestamp before each API call, and take over a lock only when its last refresh (or, for an empty or unreadable lock, its file time) is older than ten minutes, re-reading and comparing the lock before removing it.
9. WHEN the Pass_Store reads a record that holds more than one entry for a session code, THE Pass_Store SHALL keep the newest and report the older entries so their passes can be voided.
10. IF the Issued_Pass_Record is corrupt, THEN THE Pass_Store SHALL raise an error that names the recovery step (the forget_me tool, or deleting the record file) without echoing the path or the content.

### Requirement 4: Sync passes against the schedule

**User Story:** As an attendee, I want my passes to follow my schedule, so that a cancelled session's pass is voided and a changed session's pass is updated without me tracking it by hand.

#### Acceptance Criteria

1. WHEN Pass_Sync runs, THE Pass_Sync SHALL diff the current Schedule against the Issued_Pass_Record into the four cases added, changed, cancelled and unchanged.
2. WHEN a session is in the added case, THE Pass_Sync SHALL issue a pass for that session through the Compass_Client.
3. WHEN a session is in the changed case, THE Pass_Sync SHALL update that session's pass through the Compass_Client with a PUT request.
4. WHEN a session is in the cancelled case, THE Pass_Sync SHALL void that session's pass through the Compass_Client.
5. THE Pass_Sync SHALL classify a session as changed WHEN the hash of the rebuilt PassFields differs from the hash stored in the Issued_Pass_Record, and SHALL classify a session as cancelled WHEN it is present in the Issued_Pass_Record but absent from the current Schedule.
6. WHEN Pass_Sync runs with a Schedule that matches the Issued_Pass_Record, THE Pass_Sync SHALL make no Compass API calls and SHALL leave the Issued_Pass_Record unchanged.
7. WHEN Pass_Sync completes an issue, update or void, THE Pass_Sync SHALL write the resulting state to the Issued_Pass_Record.
8. THE Pass_Sync SHALL require the caller to assert `scheduleConfirmed` (the session list came from a successful, complete GetSchedule), SHALL require `confirmEmpty` to void every recorded pass against an empty list, and SHALL require `allowBulkVoid` to void more than five passes in one run; otherwise it SHALL stop before any Compass API call.
9. THE Pass_Sync SHALL build every pass it could need before the first Compass API call, so that a builder error makes no call.
10. IF the Issued_Pass_Record cannot be written after an issue, THEN THE Pass_Sync SHALL void the just-issued passes again and raise `sync.store_failed`; IF an issue response lacks a requested session code, THEN THE Pass_Sync SHALL record what came back and raise `sync.partial_issue`.
11. THE Pass_Sync SHALL refuse a response that answers for a different serial on update or void, and an issue response that answers for an unrequested code, repeats a code, repeats a serial already recorded, or names a platform that was not requested, recording nothing for it; and SHALL match record entries on both session code and serial.
12. THE Pass_Sync SHALL void every older duplicate entry for a session code before any other change, and every serial of a cancelled code.
13. IF a compensating void fails, THEN THE Pass_Sync SHALL persist its serial to a `.pending-void` file in the store folder (mode 0600, under the store lock) and SHALL retry the pending serials first on the next sync, removing each only after its void succeeds.
14. IF an issue response fails the identity checks, THEN THE Pass_Sync SHALL raise an error whose copy tells the user to run the forget_me tool to clean up any passes that may have been issued.

### Requirement 5: Hand off passes with a QR code

**User Story:** As an attendee, I want a QR code on my computer that sends my chosen passes to my phone, so that I can add them to my wallet without typing a link.

#### Acceptance Criteria

1. WHEN the attendee requests a hand-off for chosen serial numbers, THE Handoff_Builder SHALL create the hand-off through the Compass_Client and SHALL obtain the Board_URL.
2. WHEN the Handoff_Builder has the Board_URL, THE Handoff_Builder SHALL render the Board_URL as a QR code for the terminal using ASCII or Unicode block characters.
3. WHEN the Handoff_Builder has the Board_URL, THE Handoff_Builder SHALL render the Board_URL as a QR code for chat both as text and as a PNG image.
4. THE Handoff_Builder SHALL carry the hand-off id in the URL fragment of the Board_URL that is encoded in each QR code.
5. THE Handoff_Builder SHALL refuse a Board_URL unless its origin equals the origin the client is pinned to (read from the client itself), its path is exactly `/board`, its query is empty, it carries no credentials, its fragment is exactly `#h=<id>` where the id matches `^[A-Za-z0-9_-]{22}$` and equals the hand-off id of the same response, and the expiry is in the future and at most 24 hours ahead; and SHALL encode the parsed href in each QR code.

### Requirement 6: Export the itinerary as an .ics calendar

**User Story:** As an attendee, I want a calendar file of my week with timely reminders, so that my phone warns me when to leave and when boarding closes.

#### Acceptance Criteria

1. WHEN the Ics_Exporter exports the itinerary, THE Ics_Exporter SHALL produce a calendar that validates as RFC 5545.
2. THE Ics_Exporter SHALL write one calendar event per Commitment.
3. WHERE a Commitment is a reserved session with an earlier commitment, THE Ics_Exporter SHALL add a "leave now" alarm triggered at Boarding_Closes minus the Connection walk minutes. WHERE a reserved session has no earlier commitment, THE Ics_Exporter SHALL add only the "boarding closes" alarm.
4. WHERE a Commitment is a reserved session, THE Ics_Exporter SHALL add a "boarding closes" alarm set to the session start minus ten minutes.
5. THE Ics_Exporter SHALL make every identifier and text it writes injection-safe: control characters become spaces and format and bidirectional characters are removed from all text, identifiers outside `^[A-Za-z0-9_-]{1,64}$` are replaced by a hash, the event timezone must be a real IANA zone.
6. THE Ics_Exporter SHALL write the calendar as a local file only, into the app-data `output/` folder, with a stable UID per session, keyed on the session id (or the personal time id) alone so that it does not change when the event moves; commitments that share an id SHALL be numbered -2, -3 in the order of their start time.

### Requirement 7: Render an offline itinerary page

**User Story:** As an attendee, I want a single offline page of my week that works on my phone with no connection, so that I can read my itinerary anywhere.

> Cut-list item 1: the Itinerary_Page is built last.

#### Acceptance Criteria

1. WHEN the Itinerary_Page renders, THE Itinerary_Page SHALL produce a single self-contained HTML file with all CSS inlined.
2. THE Itinerary_Page SHALL contain no script content.
3. THE Itinerary_Page SHALL make no network requests, referencing no external resource.
4. THE Itinerary_Page SHALL state the event timezone once for the itinerary view and SHALL show all times in the event local time.
5. WHEN a venue is empty for a Commitment, THE Itinerary_Page SHALL show the gate as "Venue not published".
6. THE Itinerary_Page SHALL provide a document language, a page title, a single top-level heading and a heading outline that follows document order, to support WCAG 2.2 AA conformance.
7. THE Itinerary_Page SHALL present the itinerary as table or list markup whose structure is programmatically determinable.
8. THE Itinerary_Page SHALL include a viewport meta tag so that the page scales to the device width.
9. THE Itinerary_Page SHALL reflow its content without loss of information or horizontal scrolling at a viewport width of 320 CSS pixels, to meet WCAG 2.2 AA reflow.
10. THE Itinerary_Page SHALL render body text at a contrast ratio of at least 4.5 to 1 against its background, to meet WCAG 2.2 AA text contrast.
11. THE Itinerary_Page SHALL remove format and bidirectional characters from all shown text, SHALL include `base-uri 'none'` and `form-action 'none'` in its content security policy, and SHALL show the date with the boarding time when boarding closes on a different local day from the session start.

### Requirement 8: Protect credentials and personal data

**User Story:** As an attendee, I want my tokens and email kept off every log and error, so that using Compass does not leak my identity.

#### Acceptance Criteria

1. THE Pass_Builder, Compass_Client, Pass_Store, Pass_Sync, Handoff_Builder, Ics_Exporter and Itinerary_Page SHALL exclude the ID_Token, the attendee email, the Board_URL and the hand-off id from all log output and from all error messages.
2. IF an operation fails, THEN the raising component SHALL produce an error message that excludes the ID_Token and the attendee email.
3. THE Compass_Client SHALL exclude the request input from any surfaced error.

### Requirement 9: Testing and coverage

**User Story:** As a maintainer, I want the pass side proven by tests at full coverage, so that it ships without regressions and without leaking data.

#### Acceptance Criteria

1. THE boarding-passes test suite SHALL include snapshot tests for the Pass_Builder output, the Ics_Exporter output and the Itinerary_Page output.
2. THE boarding-passes test suite SHALL cover the Pass_Sync diff cases added, changed, cancelled and unchanged, and SHALL cover an idempotent re-run that makes no Compass API calls.
3. THE boarding-passes test suite SHALL validate the Ics_Exporter output with an RFC 5545 validator.
4. THE boarding-passes test suite SHALL run the Compass_Client against a mock server built from `contracts/compass-api.openapi.yaml`.
5. THE boarding-passes test suite SHALL include a test proving that no ID_Token and no attendee email reaches log output or error messages.
6. THE boarding-passes test suite SHALL achieve one hundred percent unit coverage of the owned code for lines, branches, functions and statements, with named exclusions only.
