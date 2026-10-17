# Requirements Document

## Introduction

This spec (S1, events-client) covers the local-first Events API layer of re:Invent Compass: the parts that sign an attendee in, talk to the AWS Events API, keep a local catalog, and stand in for all of that in a simulated mode for tests and demos. It owns `packages/core/src/{auth,api,catalog,simulated}/**` and `fixtures/api/**`.

In the airline metaphor the attendee is boarding a week at re:Invent. This stream is the check-in desk and the departures board behind it: it proves who the attendee is (sign-in), reads the live schedule of flights (the catalog and the attendee's itinerary), books and cancels seats under strict rules (the typed Events API client and confirmed writes), and can run the whole desk against a made-up timetable with no live system attached (simulated mode).

Everything here runs on the attendee's own computer. The access and refresh tokens, the catalog cache and the schedule snapshot never leave the machine. The ID token leaves only to prove sign-in to the Compass API (owned by another stream), never to the Events API. All shared types and zod schemas come from `@compass/contracts`. No token, ID token, email or Authorization header may reach any log or error message.

Scope boundary: this stream does not build the guardrails engine (S2 rules), the scanner or spec generator (S3), the pass model or Compass API client (S4), or any server-side component. It reads `data/venues.json` (owned by S2) through `VenueSchema` but never writes it.

## Glossary

- **Events API**: The AWS re:Invent Events API at REST base URL `https://api.awsevents.com/v1`, event id `reinvent2026`. The upstream system this stream calls.
- **Events_Client**: The typed client in `core/src/api/` that calls the twelve Events API operations and validates every response.
- **Auth_Module**: The sign-in, refresh, revoke and token storage component in `core/src/auth/`.
- **Catalog_Module**: The pagination, cache and normalisation component in `core/src/catalog/`.
- **Simulated_Transport**: The fixture-backed stand-in for the Events API, active when `COMPASS_MODE=simulated`.
- **Token_Store**: The abstraction over token storage: OS keychain through `@napi-rs/keyring`, or a memory-only store when no keychain exists.
- **Keychain**: The operating system credential store reached through `@napi-rs/keyring`.
- **Attendee**: The signed-in human using Compass on their own computer.
- **Access_Token**: A JWT, valid 60 minutes, sent only to `api.awsevents.com`.
- **Refresh_Token**: An opaque token, valid 30 days, sent only to the token endpoint.
- **ID_Token**: A JWT, valid 60 minutes, exposed only to the passes module for the Compass API, never sent to the Events API.
- **PKCE**: Proof Key for Code Exchange, RFC 7636, used with the OAuth 2.0 authorization code flow.
- **Loopback_Server**: A short-lived HTTP server bound to `127.0.0.1` that receives the single OAuth redirect.
- **Builder_ID**: AWS Builder ID, the identity provider (`identity_provider=AWSBuilderID`).
- **Quota_Tracker**: The client-side per-operation rate counter.
- **Confirmed_Write_Helper**: A helper that performs a write, then reads `GetSchedule`, and returns both results.
- **Normalised_Session**: The internal session view defined by `NormalisedSessionSchema` in `@compass/contracts`.
- **Unrecognised_Refusal**: A per-session bulk failure whose code is not one of the known `BulkFailureCode` values; treated as a refusal, never a safe retry.
- **Catalog_Cache**: The on-disk copy of the normalised catalog in the OS app-data folder.
- **Event_Window**: The event start and end instants and timezone, read from `ListEvents` and `GetEvent`, never hard-coded.
- **Fixture**: A JSON file under `fixtures/api/<operation>/<scenario>.json` used by tests and the simulated transport.
- **Simulated_Mode**: The mode selected by `COMPASS_MODE=simulated` in which the Simulated_Transport serves fixtures instead of the live Events API.
- **Live_Smoke_Test**: A test that calls the live Events API, run only when `COMPASS_LIVE_TESTS=1` is set.

## Requirements

### Requirement 1: Sign-in with authorization code and PKCE

**User Story:** As an attendee, I want to sign in with my AWS Builder ID through a secure browser flow, so that Compass can read and manage my re:Invent schedule on my behalf.

#### Acceptance Criteria

1. WHEN sign-in begins, THE Auth_Module SHALL start a Loopback_Server bound to `127.0.0.1` at path `/callback`.
2. WHEN the Auth_Module binds the Loopback_Server, THE Auth_Module SHALL try ports 8484, 8485, 8486, 8487, 8488 and 8489 in ascending order and use the first port that binds.
3. IF none of ports 8484 to 8489 can be bound, THEN THE Auth_Module SHALL return an error that reports that no loopback port is available.
4. WHEN the Loopback_Server receives a request at `/callback`, THE Loopback_Server SHALL handle that single request, send a browser-visible completion response, and then shut down.
5. IF the Loopback_Server receives a request at a path other than `/callback`, THEN THE Loopback_Server SHALL respond with a not found response and SHALL NOT shut down.
6. IF no request reaches `/callback` within a configured sign-in timeout, THEN THE Auth_Module SHALL shut down the Loopback_Server and return a sign-in timeout error.
7. WHEN a sign-in attempt begins, THE Auth_Module SHALL generate a new PKCE code verifier and a new `state` value for that attempt.
8. WHEN the Auth_Module builds the PKCE code challenge, THE Auth_Module SHALL compute the S256 challenge as the base64url encoding of the SHA-256 of the code verifier without padding.
9. WHEN the Auth_Module builds the authorize request, THE Auth_Module SHALL send `code_challenge_method=S256` explicitly.
10. WHEN the Auth_Module builds the authorize request, THE Auth_Module SHALL send `identity_provider=AWSBuilderID`.
11. WHEN the Auth_Module builds the authorize request, THE Auth_Module SHALL use the authorize endpoint `https://oauth.awsevents.com/oauth2/authorize`, the client id `7vmom55m1qstvq8i71ph127bfq`, the scope `openid email events/access` and a redirect URI that is exactly `http://localhost:<bound port>/callback`, with lowercase scheme `http`, host `localhost`, the bound loopback port and path `/callback`.
12. WHEN the Loopback_Server receives the redirect, THE Auth_Module SHALL compare the returned `state` against the `state` generated for that attempt.
13. IF the returned `state` does not equal the `state` generated for that attempt, THEN THE Loopback_Server SHALL answer that request with a 400 response, SHALL NOT use up the single callback slot and SHALL keep listening within the same sign-in timeout (so a web page cannot end the sign-in with one request), AND IF three such wrong-state callbacks have been received, THEN THE Auth_Module SHALL reject the sign-in attempt and return a state mismatch error.
14. WHEN the Auth_Module exchanges the authorization code, THE Auth_Module SHALL call the token endpoint `https://oauth.awsevents.com/oauth2/token` with the code verifier for that attempt.
15. IF the token exchange fails, THEN THE Auth_Module SHALL return a sign-in failed error and SHALL NOT store any partial token.
16. WHEN a token exchange succeeds, THE Auth_Module SHALL obtain the Access_Token, the Refresh_Token and the ID_Token.

### Requirement 2: Token storage with keychain and memory fallback

**User Story:** As an attendee, I want my tokens stored safely on my own machine, so that my session is protected and I am told when it cannot persist.

#### Acceptance Criteria

1. WHERE a Keychain is available, WHEN a token is obtained or refreshed, THE Token_Store SHALL store the Access_Token, the Refresh_Token and the ID_Token in the Keychain through `@napi-rs/keyring`.
2. WHERE no Keychain is available, WHEN a token is obtained or refreshed, THE Token_Store SHALL hold the Access_Token, the Refresh_Token and the ID_Token in process memory only and SHALL NOT retain them after the process ends.
3. WHERE no Keychain is available, THE Auth_Module SHALL return an indication that tokens are held in memory only and that the attendee must sign in again each session.
4. THE Token_Store SHALL NOT write any token to a file.
5. WHEN any token value is held, THE Token_Store SHALL keep that token value out of all log and error message output.
6. IF a Keychain write fails, THEN THE Token_Store SHALL fall back to holding the tokens in process memory only and SHALL return an indication of the fallback that contains no token value.

### Requirement 3: Token refresh before expiry

**User Story:** As an attendee, I want my access token refreshed before it expires, so that my requests keep working without me signing in again.

#### Acceptance Criteria

1. WHILE a valid Refresh_Token is held, WHEN the Access_Token is within 300 seconds of its expiry time, THE Auth_Module SHALL refresh the Access_Token before it is used for the next request.
2. WHEN the Auth_Module refreshes tokens, THE Auth_Module SHALL send the Refresh_Token only to the token endpoint `https://oauth.awsevents.com/oauth2/token`.
3. WHEN a refresh succeeds, THE Token_Store SHALL replace the stored Access_Token and ID_Token with the refreshed values.
4. IF a refresh fails because the Refresh_Token is rejected, THEN THE Auth_Module SHALL clear all stored tokens and return an error that reports that the attendee must sign in again.
5. IF a refresh is requested while a refresh for the same Refresh_Token is already in progress, THEN THE Auth_Module SHALL reuse the result of the in-progress refresh rather than starting a second refresh.

### Requirement 4: Token audience separation

**User Story:** As an attendee, I want each token sent only to the system that should receive it, so that no component ever gets a credential it is not entitled to.

#### Acceptance Criteria

1. WHEN the Auth_Module provides a credential for an Events API request, THE Auth_Module SHALL provide the Access_Token and SHALL send it only to `api.awsevents.com`.
2. WHEN the Auth_Module performs a refresh or revoke, THE Auth_Module SHALL send the Refresh_Token only to the token or revoke endpoint at `oauth.awsevents.com`.
3. WHEN the passes module requests the ID_Token, THE Auth_Module SHALL expose the ID_Token to the passes module and SHALL NOT expose it to any other caller.
4. WHEN the Events_Client sends a request to the Events API, THE Events_Client SHALL send the Access_Token and SHALL NOT send the ID_Token.
5. IF a credential would be sent to an audience other than the one defined for that credential, THEN THE Auth_Module SHALL refuse to send the credential.

### Requirement 5: Sign-out

**User Story:** As an attendee, I want to sign out cleanly, so that my refresh token is revoked and my credentials are removed from this machine.

#### Acceptance Criteria

1. WHEN sign-out begins, THE Auth_Module SHALL first revoke the Refresh_Token at the revoke endpoint `https://oauth.awsevents.com/oauth2/revoke`, then clear the Access_Token, the Refresh_Token and the ID_Token from the Token_Store.
2. WHEN sign-out has cleared the Token_Store, THE Auth_Module SHALL return the Builder ID sign-out URL `https://idp.awsevents.com/oidc/logout`.
3. IF the revoke request fails or does not complete within 10 seconds, THEN THE Auth_Module SHALL still clear all tokens from the Token_Store and return the Builder ID sign-out URL.

### Requirement 6: Typed client for the twelve Events API operations

**User Story:** As a developer on Compass, I want one typed function per Events API operation with validated responses, so that every call is safe and predictable.

#### Acceptance Criteria

1. THE Events_Client SHALL provide exactly one operation each for ListEvents, GetEvent, ListSessions, GetSession, GetSchedule, ReserveSessions, CancelReservation, AssociateFavorites, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime and DeletePersonalTime, as one file each under `core/src/api/`.
2. WHEN the Events_Client sends a request, THE Events_Client SHALL attach the Access_Token as the bearer credential and SHALL NOT attach the ID token to the request.
3. WHEN the Events_Client receives a response with status 200 to 299, THE Events_Client SHALL validate the response body against the matching zod schema from `@compass/contracts`.
4. WHEN a response body passes schema validation, THE Events_Client SHALL return the parsed value produced by the matching zod schema to the caller.
5. IF a response body fails schema validation, THEN THE Events_Client SHALL return a typed validation error and SHALL NOT return the unvalidated body to the caller.
6. WHEN the Events_Client builds a response wrapper, THE Events_Client SHALL build that wrapper inside `core/src/api` from exported `@compass/contracts` schemas only, so that ListEvents returns `{items: EventSchema[]}`, GetEvent returns `{event}`, and ReserveSessions and AssociateFavorites each return `{result: BulkResultSchema}`.
7. WHEN the Events_Client receives a 204 response with an empty body for CancelReservation, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime or DeletePersonalTime, THE Events_Client SHALL treat that response as success with no body and SHALL NOT perform body validation.
8. THE events-client stream SHALL NOT edit `packages/contracts`.

### Requirement 7: Typed errors for HTTP status codes

**User Story:** As a developer on Compass, I want a distinct typed error per failure status, so that calling code can react correctly to each case.

#### Acceptance Criteria

1. IF the Events API responds with status 400, THEN THE Events_Client SHALL return a typed bad request error that carries the response status.
2. IF the Events API responds with status 403, THEN THE Events_Client SHALL return a typed forbidden error that carries the response status.
3. IF the Events API responds with status 404, THEN THE Events_Client SHALL return a typed not found error that carries the response status.
4. IF the Events API responds with status 409, THEN THE Events_Client SHALL return a typed conflict error that carries the response status.
5. IF the Events API responds with a status from 500 to 599, THEN THE Events_Client SHALL return a typed server error that carries the response status.
6. IF the Events API responds with a failure status that is not 400, 401, 403, 404, 409, 429 or in the range 500 to 599, THEN THE Events_Client SHALL return a typed unexpected response error that carries the response status.
7. WHEN the Events_Client builds any error, THE Events_Client SHALL exclude every access token, refresh token, ID token, email and Authorization header value from the error message and from all error fields.

### Requirement 8: Retry on 401 and 429

**User Story:** As an attendee, I want transient auth and rate limits handled once and safely, so that short-lived failures recover without risking duplicate writes.

#### Acceptance Criteria

1. IF a request that is not a ReserveSessions request responds with status 401, THEN THE Events_Client SHALL perform exactly one token refresh and then send exactly one retry of the original request.
2. IF the retried request after a 401 again responds with status 401, THEN THE Events_Client SHALL return a typed unauthorized error and SHALL NOT send a further retry.
3. IF a token refresh triggered by a 401 fails, THEN THE Events_Client SHALL return a typed unauthorized error and SHALL NOT send a retry of the original request.
4. IF a request that is not a ReserveSessions request responds with status 429 and the `Retry-After` response header is present and parses to a duration from 0 to 120 seconds inclusive, THEN THE Events_Client SHALL wait that duration once and then send exactly one retry of the request.
5. IF a request that is not a ReserveSessions request responds with status 429 and the `Retry-After` response header is absent or does not parse to a duration from 0 to 120 seconds inclusive, THEN THE Events_Client SHALL return a typed rate limited error and SHALL NOT send a retry.
6. IF the retried request after a 429 again responds with status 429, THEN THE Events_Client SHALL return a typed rate limited error and SHALL NOT send a further retry.

### Requirement 9: ReserveSessions automatic-refresh exception

**User Story:** As an attendee, I want reservations never re-sent behind my back, so that I never double-book a seat.

#### Acceptance Criteria

1. IF a ReserveSessions request responds with status 401, THEN THE Events_Client SHALL perform exactly one token refresh and then return a typed unauthorized error, and SHALL NOT re-send the ReserveSessions request after the refresh.
2. IF a token refresh triggered by a ReserveSessions 401 fails, THEN THE Events_Client SHALL return a typed unauthorized error and SHALL NOT re-send the ReserveSessions request.
3. IF a ReserveSessions request responds with status 429 or a status from 500 to 599, THEN THE Events_Client SHALL return the matching typed error and SHALL NOT re-send the ReserveSessions request.
4. WHEN a ReserveSessions request responds with any status, THE Events_Client SHALL NOT automatically re-send that ReserveSessions request.

### Requirement 10: Bulk write input and per-session results

**User Story:** As an attendee, I want bulk reserve and favorite requests validated and reported per session, so that I see exactly what succeeded and what was refused.

#### Acceptance Criteria

1. WHEN a ReserveSessions or AssociateFavorites request is built, THE Events_Client SHALL accept a list of session ids whose count is from 1 to 10 inclusive and whose values are all distinct.
2. IF a ReserveSessions or AssociateFavorites request is built with fewer than 1 or more than 10 session ids, THEN THE Events_Client SHALL return a typed validation error before sending the request and SHALL NOT send the request.
3. IF a ReserveSessions or AssociateFavorites request is built with two or more equal session ids, THEN THE Events_Client SHALL return a typed validation error before sending the request and SHALL NOT send the request.
4. WHEN the Events_Client returns a validated `BulkResult` for a ReserveSessions or AssociateFavorites response, THE Events_Client SHALL read `result.successful` and `result.failed` from that validated `BulkResult` and SHALL return the `successful` session ids and the `failed` per-session results, including the case where `successful` or `failed` is empty.
5. WHEN the events-client stream compiles, THE events-client build SHALL check the known `BulkFailureCode` list maintained in `core/src/api` against the generated `EventsApi` `BulkFailureCode` type at compile time.
6. IF a per-session failure in a validated `BulkResult` carries a code that is not one of the known `BulkFailureCode` values, THEN THE Events_Client SHALL classify that failure as an Unrecognised_Refusal, SHALL report it as a refusal and SHALL NOT report it as a success or as a safe retry. THE Events_Client SHALL annotate each failed entry it returns with refusal `known` or `unrecognised` according to that classification.

### Requirement 11: Confirmed-write helper

**User Story:** As an attendee, I want every write confirmed by reading my schedule back, so that I trust what actually changed rather than only the write response.

#### Acceptance Criteria

1. WHEN the Confirmed_Write_Helper is asked to perform a write and the write operation returns a success result, THE Confirmed_Write_Helper SHALL call GetSchedule exactly once after the write completes.
2. WHEN the Confirmed_Write_Helper has received a successful write result and a successful GetSchedule result, THE Confirmed_Write_Helper SHALL return both the write result and the confirmed schedule from that GetSchedule call.
3. IF the write operation returns an error, THEN THE Confirmed_Write_Helper SHALL return that error and SHALL NOT call GetSchedule.
4. IF the write operation returns a success result but the subsequent GetSchedule call returns an error, THEN THE Confirmed_Write_Helper SHALL return a result that includes the write result and an indication that confirmation was not obtained, and SHALL NOT re-send the write operation.

### Requirement 12: Client-side quota tracking

**User Story:** As an attendee, I want Compass to respect the per-minute Events API limits, so that I am not throttled or blocked.

#### Acceptance Criteria

1. THE Quota_Tracker SHALL count calls per operation within a rolling one-minute window measured in seconds from the first counted call of that operation.
2. WHEN the one-minute window for an operation elapses, THE Quota_Tracker SHALL reset the counted calls for that operation to zero.
3. IF a GetSession call would raise the count within the current window to more than 120, THEN THE Quota_Tracker SHALL prevent that GetSession call until the window resets.
4. IF a ListSessions call would raise the count within the current window to more than 120, THEN THE Quota_Tracker SHALL prevent that ListSessions call until the window resets.
5. IF a GetSchedule call would raise the count within the current window to more than 60, THEN THE Quota_Tracker SHALL prevent that GetSchedule call until the window resets.
6. IF a ReserveSessions call would raise the counted sessions within the current window to more than 30, THEN THE Quota_Tracker SHALL prevent that ReserveSessions call until the window resets.
7. IF an AssociateFavorites call would raise the counted sessions within the current window to more than 30, THEN THE Quota_Tracker SHALL prevent that AssociateFavorites call until the window resets.
8. IF any other write operation call would raise the count for that operation within the current window to more than 30, THEN THE Quota_Tracker SHALL prevent that call until the window resets.
9. IF the Events API returns a 429 response for an operation (any operation, including ReserveSessions and the unmetered ListEvents and GetEvent, and whether or not the call is then retried), THEN THE Quota_Tracker SHALL prevent the next call of that operation until the duration given by the Retry-After header has elapsed, or for 30 seconds when the Retry-After header is missing or invalid.

### Requirement 13: Catalog pagination

**User Story:** As an attendee, I want the whole catalog fetched completely, so that no sessions are missed from my options.

#### Acceptance Criteria

1. WHEN the Catalog_Module fetches sessions, THE Catalog_Module SHALL request successive pages and SHALL continue requesting the next page until it receives a response that contains no `nextToken`.
2. WHILE a response carries a non-empty `nextToken`, THE Catalog_Module SHALL request the following page using that `nextToken` even when the current page contains fewer items than any earlier page.
3. WHEN the Catalog_Module performs a fast pass, THE Catalog_Module SHALL send the request with `includeAbstracts=false`.
4. WHEN the Catalog_Module receives a response that contains no `nextToken`, THE Catalog_Module SHALL treat the catalog as fully fetched and SHALL stop requesting further pages.
5. IF a page request returns a 429 response, THEN THE Catalog_Module SHALL wait once for the duration indicated by the response `Retry-After` value and retry the same page, and IF that retry still fails THEN THE Catalog_Module SHALL fail with the error described in criterion 6, performing one wait only before surfacing the did-not-complete error.
6. IF a page request fails with a non-retryable error, THEN THE Catalog_Module SHALL stop fetching, SHALL NOT treat the catalog as fully fetched, and SHALL surface an error indicating the fetch did not complete.

### Requirement 14: Catalog cache on disk

**User Story:** As an attendee, I want my catalog cached locally and privately, so that planning is fast and offline-friendly.

#### Acceptance Criteria

1. WHEN the Catalog_Module writes the Catalog_Cache on Windows, THE Catalog_Module SHALL write the cache file under the directory named by the `%APPDATA%` environment variable joined with `reinvent-compass`.
2. WHEN the Catalog_Module writes the Catalog_Cache on macOS, THE Catalog_Module SHALL write the cache file under `~/Library/Application Support` joined with `reinvent-compass`.
3. WHEN the Catalog_Module writes the Catalog_Cache on Linux, THE Catalog_Module SHALL write the cache file under the directory named by the `$XDG_DATA_HOME` environment variable joined with `reinvent-compass`, and IF `XDG_DATA_HOME` is unset, THEN THE Catalog_Module SHALL use `~/.local/share` joined with `reinvent-compass`.
4. WHEN the Catalog_Module writes the Catalog_Cache, THE Catalog_Module SHALL set the file mode to octal `0600` so that only the owning user can read or write it.
5. WHEN the Catalog_Module writes the Catalog_Cache, THE Catalog_Module SHALL store, alongside the cached data, the fetch timestamp as an ISO 8601 value with offset.
6. WHEN a refresh is requested, THE Catalog_Module SHALL refetch the catalog and SHALL overwrite the existing Catalog_Cache file in place with the newly fetched data and a new fetch timestamp.
7. WHERE a maximum cache age is configured as a positive duration in seconds, WHEN the Catalog_Module is asked to read the catalog and the difference between the current time and the cached fetch timestamp is greater than the configured maximum cache age, THE Catalog_Module SHALL refetch the catalog before returning sessions.
8. IF the Catalog_Module cannot write the Catalog_Cache, THEN THE Catalog_Module SHALL leave any existing Catalog_Cache file unchanged and SHALL surface an error indicating the cache write failed.

### Requirement 15: Session normalisation

**User Story:** As an attendee, I want sessions normalised consistently and honestly, so that times, repeats and venues are reliable and gaps are visible.

#### Acceptance Criteria

1. WHEN the Catalog_Module normalises a session, THE Catalog_Module SHALL produce a Normalised_Session that validates against `NormalisedSessionSchema` from `@compass/contracts`.
2. WHEN a session has a usable wire session time, THE Catalog_Module SHALL set `startsAt` and `endsAt` to timezone-aware ISO 8601 values that include a UTC offset.
3. IF a session has no usable wire session time, THEN THE Catalog_Module SHALL leave `startsAt` and `endsAt` absent and SHALL record `startsAt` and `endsAt` in the `missingFields` list.
4. WHEN the session abbreviation or code matches the pattern `-R[0-9]?$`, THE Catalog_Module SHALL set `repeatOf` to the base code, meaning the code without the `-R` suffix.
5. WHEN the wire venue is present, THE Catalog_Module SHALL set `venue` from the wire venue, otherwise THE Catalog_Module SHALL recover `venue` from the room text using the injected venue list parsed through `VenueSchema`.
6. WHERE a venue list is supplied, THE Catalog_Module SHALL receive that venue list by injection and SHALL parse it through `VenueSchema`, and the tests SHALL supply their own venue fixture.
7. IF `data/venues.json` is missing, THEN THE Catalog_Module SHALL leave `venue` absent and SHALL record `venue` in the `missingFields` list.
8. WHEN the wire omits `isAllDay`, `isReservable`, `seatAvailability` or `code`, THE Catalog_Module SHALL set `isAllDay=false`, `isReservable=false`, `seatAvailability="unknown"` and `code=""`, and SHALL record each of those omitted field names in the `missingFields` list.
9. THE Catalog_Module SHALL read `data/venues.json` and SHALL NOT write `data/venues.json`.
10. WHEN a session omits an optional field, THE Catalog_Module SHALL record the name of each absent field in the Normalised_Session `missingFields` list and SHALL NOT substitute any invented or default value for that field.

### Requirement 16: Local catalog filters

**User Story:** As an attendee, I want to filter the cached catalog locally, so that I can narrow down sessions without extra API calls.

#### Acceptance Criteria

1. THE Catalog_Module SHALL filter the cached catalog locally by any combination of text, type, level, day, venue, service and topic criteria.
2. WHEN one or more filter criteria are applied, THE Catalog_Module SHALL return only the Normalised_Sessions in the Catalog_Cache that match all applied criteria.
3. WHEN no filter criteria are applied, THE Catalog_Module SHALL return every Normalised_Session in the Catalog_Cache.
4. WHILE filtering the cached catalog, THE Catalog_Module SHALL NOT send any search or list request to the Events API.

### Requirement 17: Event window and timezone from the API

**User Story:** As an attendee, I want the event dates and timezone taken from the live event, so that times are always correct for the real event.

#### Acceptance Criteria

1. WHEN the Events_Client needs the Event_Window, THE Events_Client SHALL obtain the event start, event end and event timezone by reading them from the responses of ListEvents and GetEvent.
2. THE Events_Client SHALL NOT use hard-coded event dates or a hard-coded timezone.
3. IF the event start, event end or event timezone is absent from the ListEvents and GetEvent responses, THEN THE Events_Client SHALL return an error indicating that the Event_Window could not be determined and SHALL NOT substitute a default value.
4. IF the event timezone read from the API is not a valid IANA timezone identifier, THEN THE Events_Client SHALL return an error indicating that the Event_Window could not be determined and SHALL NOT substitute a default value.

### Requirement 18: Simulated mode

**User Story:** As a developer or judge, I want a realistic offline mode, so that reserve, favorite and personal-time flows can be tried and tested without the live API.

#### Acceptance Criteria

1. WHERE `COMPASS_MODE=simulated` is set, THE Simulated_Transport SHALL serve responses from fixtures instead of calling the live Events API, and until `fixtures/synthetic` lands those simulated fixtures SHALL be self-made sessions stored in `fixtures/api/**` and built to validate against `SessionWireSchema`.
2. WHERE Simulated_Mode is active, THE Simulated_Transport SHALL present a signed-in attendee without performing a live sign-in and without calling any OAuth endpoint.
3. WHERE Simulated_Mode is active, WHEN a reserve, cancel, favorite, disassociate or personal-time operation completes within one process session, THE Simulated_Transport SHALL update an in-memory schedule so that a later GetSchedule call in the same process session returns the result of that operation.
4. WHERE Simulated_Mode is active, WHEN a ReserveSessions or AssociateFavorites request is served, THE Simulated_Transport SHALL derive the per-session bulk result from the in-memory schedule state, returning `sessionFull` for a configured full session, `scheduleConflict` carrying `conflictsWith` for a time clash, and `alreadyScheduled` for a session already reserved.
5. WHERE Simulated_Mode is active, WHEN a configured throttle scenario is requested, THE Simulated_Transport SHALL return a 429 response with a `Retry-After` header whose value is a whole number of seconds between 1 and 60 inclusive.
6. WHERE Simulated_Mode is active, WHEN a configured expired token scenario is requested, THE Simulated_Transport SHALL return a 401 response that indicates the token is expired.
7. WHILE Simulated_Mode is active, THE Simulated_Transport SHALL NOT send any request to the live Events API.

### Requirement 19: Fixtures

**User Story:** As a developer on Compass, I want fixtures for every operation and error path, so that tests cover real response shapes and edge cases.

#### Acceptance Criteria

1. THE events-client stream SHALL store each Fixture at the path `fixtures/api/<operation>/<scenario>.json`.
2. THE events-client stream SHALL provide at least one success Fixture for each of the twelve Events API operations (ListEvents, GetEvent, ListSessions, GetSession, GetSchedule, ReserveSessions, CancelReservation, AssociateFavorites, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime and DeletePersonalTime).
3. THE events-client stream SHALL provide at least one error-path Fixture for each of the status conditions 400, 401, 403, 404, 409, 429 and 500 to 599.
4. THE events-client stream SHALL provide a multi-page catalog Fixture set in which a non-final page carries a `nextToken` and the final page omits `nextToken`, spanning at least two pages.
5. THE events-client stream SHALL provide a ReserveSessions or AssociateFavorites Fixture whose bulk result contains at least one per-session failure whose code is not a known `BulkFailureCode` value.
6. THE events-client stream SHALL provide a Fixture that represents a 401 response indicating an expired token.
7. THE events-client stream SHALL name each fixture folder under `fixtures/api/` using the kebab-case operation name, for example `reserve-sessions`, `associate-favorites` and `get-schedule`.
8. THE events-client stream SHALL place unit tests under `packages/core/test/{auth,api,catalog,simulated}/`.

### Requirement 20: Security of logs and errors

**User Story:** As an attendee, I want proof that my credentials never leak, so that I can trust Compass with my account.

#### Acceptance Criteria

1. THE events-client code SHALL keep every Access_Token, Refresh_Token, ID_Token, email value and Authorization header value out of all log output.
2. THE events-client code SHALL keep every Access_Token, Refresh_Token, ID_Token, email value and Authorization header value out of all error messages and error fields.
3. THE events-client test suite SHALL include a security test that exercises sign-in, token refresh and at least one failing Events API operation, and SHALL assert that no Access_Token, Refresh_Token, ID_Token, email value or Authorization header value appears in captured log output or in any returned error message or error field.

### Requirement 21: Test coverage and live smoke tests

**User Story:** As the owner, I want full unit coverage and strictly gated live tests, so that quality is proven and the live API is never hit in CI.

#### Acceptance Criteria

1. THE events-client test suite SHALL achieve 100% coverage of lines, branches, functions and statements for the code this stream owns, with zero named coverage exclusions for the S1 stream.
2. WHILE the Live_Smoke_Tests are not enabled, THE events-client test suite SHALL NOT send any request to the live Events API.
3. WHERE `COMPASS_LIVE_TESTS=1` is set, THE events-client Live_Smoke_Tests SHALL cover sign-in, catalog, schedule, a favorite round trip, a personal-time round trip, and exactly one reservation performed only with a session id the owner supplies.
4. WHERE `COMPASS_LIVE_TESTS=1` is set, THE events-client Live_Smoke_Tests SHALL run against the live Events API.
5. WHERE `COMPASS_LIVE_TESTS=1` is not set, THE events-client Live_Smoke_Tests SHALL be skipped and SHALL report each skipped test as skipped rather than passed.
