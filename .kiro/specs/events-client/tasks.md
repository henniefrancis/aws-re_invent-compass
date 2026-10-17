# Implementation Plan: events-client (S1)

## Overview

This plan turns the events-client design into incremental TypeScript coding steps for `@compass/core`, owning `packages/core/src/{auth,api,catalog,simulated}/**` and `fixtures/api/**`, with tests under `packages/core/test/{auth,api,catalog,simulated}/`.

The build order is bottom up: shared seams first (transport, errors, redacting logger, client context), then the pure or input-driven helpers (PKCE, retry parser, bulk guard, failure classifier, quota tracker, app-data dir, normaliser, venue recovery, filter, event window), then the twelve operation functions, then auth (token store, sign-in, refresh, sign-out), then catalog (pagination, cache), then the simulated transport, then the fixtures, and finally the wiring (subpath index exports), the security test and the owner-gated live smoke tests. Each step builds on the previous and ends integrated; nothing is left orphaned.

Every correctness property from the design (Properties 1 to 38) is implemented with `fast-check` (minimum 100 iterations), tagged `// Feature: events-client, Property {n}: {text}`, and placed next to the code it checks. All tests are mandatory; there are no optional tasks, because S1's definition of done requires 100% coverage.

Conventions followed: kebab-case files, one Events API operation per file, PascalCase types, `Schema` suffix for zod schemas, shared types imported from `@compass/contracts` only (never redefined, `packages/contracts` never edited), vitest 4 with v8 coverage at 100% for S1-owned code, no live API in tests (`COMPASS_MODE=simulated` and fixtures), Conventional Commits scoped `events-client`.

## Execution rules (read before starting)

1. **Tasks run sequentially in numeric order.** Do task 1 fully, then task 2, and so on. There are no parallel waves.
2. **Do each task yourself in this chat.** Do not delegate tasks to the spec-task-execution subagent. Save files after each step.
3. **File ownership is strict.** Every file you touch must be under `packages/core/src/{auth,api,catalog,simulated}/**`, `packages/core/test/{auth,api,catalog,simulated}/**`, `fixtures/api/**`, or `.kiro/specs/events-client/`. Never edit `packages/contracts/**`, `contracts/**`, `data/venues.json`, `package.json` or `package-lock.json`. If you need a dependency (for example `fast-check`) or a contract change, stop and tell the owner; do not run `npm install`.
4. **Each top-level task ends with a local commit, made only after that task's tests pass** (`npm test` green for the package) and after `npx eslint .` and `npx prettier --check .` both pass with zero errors (the CI job enforces both). Use Conventional Commits with scope `events-client`, subject and body passed via multiple `-m` flags (never a commit message file). Never push, merge, open a PR or tag. The first commit (task 1) also includes `.kiro/specs/events-client/`.
5. **Live smoke tests run only with `COMPASS_LIVE_TESTS=1` and are never run by you.** When the flag is unset they must report as skipped, never passed, and send no live request.
6. `data/venues.json` (S2) and `packages/contracts` (S0) are read-only here; tests supply their own venue fixture.
7. **Simulated-mode fixtures are built from the S0 synthetic catalog at `fixtures/synthetic/catalog.json`** (read-only, S0 owns it). Do not invent sessions and do not edit that file.
8. `fast-check` 4.10.2 is already a root devDependency and resolves from `packages/core` tests; no install is needed.

## Tasks

- [x] 1. Establish shared API seams and the redacting logger
  - [x] 1.1 Define the transport seam and client context
    - Create `src/api/transport.ts` with `OperationName`, `ClientRequest`, `RawResponse`, `Transport` and `ClientContext` (`{ transport, accessToken, quota, logger, now, sleep }`), importing wire/domain types from `@compass/contracts`
    - Add `selectTransport(env, deps)` returning the simulated transport when `COMPASS_MODE=simulated`, else the HTTP transport factory (HTTP body filled in task 2.1)
    - _Requirements: 6.1, 4.4, 18.1_

  - [x] 1.2 Implement the redacting logger
    - Create the redacting logger in `src/api` that scrubs every access token, refresh token, ID token, email value and `Authorization` header value from each line, as the single logging mechanism for all components
    - _Requirements: 2.5, 7.7, 20.1_

  - [x] 1.3 Write property test for the redacting logger and no-secret invariant seam
    - **Property 7: No secret ever appears in logs or errors** (partial: logger scrubbing; full flow asserted in task 17.1)
    - **Validates: Requirements 2.5, 7.7, 20.1, 20.2**

  - [x] 1.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Include `.kiro/specs/events-client/` in this first commit. Verify every edit landed. Never push.

- [x] 2. Implement the HTTP transport and typed errors
  - [x] 2.1 Implement the HTTP transport
    - In `src/api/transport.ts`, implement `HttpTransport` over global `fetch` targeting `https://api.awsevents.com/v1`, attaching the bearer access token from `EventsApiCredential` and never the ID token
    - _Requirements: 6.2, 4.1, 4.4_

  - [x] 2.2 Implement the typed error taxonomy and redacting factory
    - Create `src/api/errors.ts` with `EventsApiError` base and `ValidationError`, `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitedError`, `ServerError`, `UnexpectedResponseError`, `EventWindowError`, `QuotaExceededError`
    - Build errors through a factory that accepts only operation name and status so no token, email or header can be carried
    - Implement the status-to-error mapper (400, 403, 404, 409, 500 to 599, and any other failure status to unexpected-response), each carrying the status
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 20.2_

  - [x] 2.3 Write property test for error mapping
    - **Property 15: Every failure status maps to its typed error carrying the status**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**

  - [x] 2.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 3. Implement response validation and wrappers
  - [x] 3.1 Implement response validation and response wrappers
    - Create `src/api/validate.ts` that parses a 2xx body with the matching `@compass/contracts` schema, returns the parsed value, and returns `ValidationError` (never the raw body) on failure; treats a 204 empty body for the five no-body operations as success with no validation
    - Create `src/api/response-wrappers.ts` using `z.object` composed from `EventSchema`, `BulkResultSchema`, `SessionWireSchema` so ListEvents returns `{items}`, GetEvent returns `{event}`, ReserveSessions and AssociateFavorites return `{result}`
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 3.2 Write property test for 2xx validation and wrappers
    - **Property 13: Valid 2xx bodies are returned parsed; invalid bodies yield a validation error**
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6**

  - [x] 3.3 Write property test for 204 no-body success
    - **Property 14: A 204 for no-body operations is success without validation**
    - **Validates: Requirements 6.7**

  - [x] 3.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 4. Implement the retry policy and Retry-After parser
  - [x] 4.1 Implement the retry policy
    - Create `src/api/retry.ts` with `parseRetryAfter` (whole seconds in `[0,120]`, else undefined) and a `RetryPolicy` that, for non-ReserveSessions, does one refresh plus one retry on 401 and one wait plus one retry on a parseable 429, and special-cases ReserveSessions so it is never automatically re-sent for any status
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2, 9.3, 9.4_

  - [x] 4.2 Write property test for non-reserve 401 and 429 retry
    - **Property 16: Non-reserve 401 and 429 retry at most once**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**

  - [x] 4.3 Write property test for ReserveSessions sent exactly once
    - **Property 17: ReserveSessions is sent exactly once for any status**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [x] 4.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 5. Implement the quota tracker
  - [x] 5.1 Implement the quota tracker
    - Create `src/api/quota-tracker.ts` with `check`, `record`, `note429` over rolling one-minute per-operation windows (limits GetSession 120, ListSessions 120, GetSchedule 60, ReserveSessions 30 counted sessions, AssociateFavorites 30 counted sessions, other writes 30; ListEvents and GetEvent unmetered), raising `QuotaExceededError` before send, resetting on window elapse, and blocking after a 429 until `Retry-After` elapses
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_

  - [x] 5.2 Write property test for the quota tracker
    - **Property 22: Quota tracker blocks exactly the call that would exceed a per-operation limit**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9**

  - [x] 5.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 6. Implement bulk input guard, failure codes and confirmed write
  - [x] 6.1 Implement the bulk input guard and failure classification
    - Create `src/api/bulk-input.ts` with `assertBulkInput` (1 to 10 distinct ids, else `ValidationError` before send)
    - Create `src/api/bulk-failure-codes.ts` with `KNOWN_BULK_FAILURE_CODES`, the bidirectional compile-time assertion against the generated `EventsApi` `BulkFailureCode` type, and `classifyFailure` returning `known` or `unrecognised-refusal`
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6_

  - [x] 6.2 Write property test for bulk input validation
    - **Property 18: Bulk input is accepted only when 1 to 10 distinct ids, else rejected before send**
    - **Validates: Requirements 10.1, 10.2, 10.3**

  - [x] 6.3 Write property test for unrecognised failure codes
    - **Property 20: Unrecognised failure codes are refusals, never successes**
    - **Validates: Requirements 10.6**

  - [x] 6.4 Implement the confirmed-write helper
    - Create `src/api/confirmed-write.ts` with `confirmedWrite<W>` that calls `GetSchedule` once after a successful write and returns both; returns the write error without calling `GetSchedule` on write failure; returns `confirmed: false` without re-sending when the write succeeds but `GetSchedule` fails
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 6.5 Write property test for the confirmed-write helper
    - **Property 21: Confirmed-write helper confirms, reports, and never re-sends**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

  - [x] 6.6 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the twelve Events API operation functions
  - [x] 8.1 Implement the read operations and bulk pass-through
    - Create one file each: `list-events.ts`, `get-event.ts`, `list-sessions.ts`, `get-session.ts`, `get-schedule.ts`, applying quota, retry, validation and wrappers through `ClientContext`
    - Implement `reserve-sessions.ts` and `associate-favorites.ts` reading `result.successful` and `result.failed` from the validated `BulkResult` (including empty cases) and reporting unrecognised codes as refusals
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 10.4, 10.6_

  - [x] 8.2 Write property test for bulk result pass-through
    - **Property 19: Bulk results pass through successful and failed faithfully**
    - **Validates: Requirements 10.4**

  - [x] 8.3 Implement the no-body write operations
    - Create `cancel-reservation.ts`, `disassociate-favorite.ts`, `create-personal-time.ts`, `update-personal-time.ts`, `delete-personal-time.ts`, treating 204 with an empty body as success with no validation, each applying quota and the non-reserve retry policy
    - _Requirements: 6.1, 6.7_

  - [x] 8.4 Write unit tests for the no-body operations
    - Assert 204 success and error-status mapping for each of the five operations
    - _Requirements: 6.7_

  - [x] 8.5 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 9. Implement PKCE, the loopback server and the credential provider seam
  - [x] 9.1 Implement PKCE and state generation
    - Create `src/auth/pkce.ts` with `createPkcePair` (challenge is base64url of SHA-256 of the verifier, no padding) and `createState`
    - _Requirements: 1.7, 1.8_

  - [x] 9.2 Write property test for the PKCE S256 challenge
    - **Property 1: PKCE S256 challenge is correct base64url without padding**
    - **Validates: Requirements 1.8**

  - [x] 9.3 Implement the loopback server and port binding
    - Create `src/auth/loopback-server.ts` with `bindLoopback` trying 8484 to 8489 in ascending order (a port is free only if `127.0.0.1:P` binds and `[::1]:P` binds or is unsupported), erroring if none bind, and `awaitCallback` handling one `/callback` request then shutting down, 404 on other paths without shutdown, rejecting `/callback?error=` at once, and timing out
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 9.4 Write property test for port selection
    - **Property 2: Loopback binds the lowest free port in range**
    - **Validates: Requirements 1.2, 1.3**

  - [x] 9.5 Write unit tests for loopback request handling
    - Single `/callback` request then shutdown; 404 on other paths with the server still up; sign-in timeout
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

  - [x] 9.6 Implement the credential provider and audience guard
    - Create `src/auth/credential-provider.ts` with `EventsApiCredential` (access token to the api layer, refreshes within 300s of expiry), a separate `IdTokenProvider` for the passes module only, and `assertAudience(credentialKind, targetHost)` refusing any mismatch
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.2_

  - [x] 9.7 Write property test for audience separation
    - **Property 11: Credentials are released only to their own audience**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 6.2**

  - [x] 9.8 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 10. Implement the token store
  - [x] 10.1 Implement the token store with keychain and memory fallback
    - Create `src/auth/token-store.ts` with `createTokenStore(keyring?)` using one `@napi-rs/keyring` `Entry` per token (service `reinvent-compass`, accounts `access`/`refresh`/`id`, each `{ linux: { store: 'secret-service' } }`), `setSecret`/`getSecret`, memory fallback plus best-effort delete on any throw, never writing a token to a file, and `kind`/`load`/`save`/`clear`
    - _Requirements: 2.1, 2.2, 2.4, 2.6_

  - [x] 10.2 Write property test for keychain round-trip
    - **Property 5: Token storage round-trips through the keychain**
    - **Validates: Requirements 2.1, 3.3**

  - [x] 10.3 Write property test for memory fallback and no file write
    - **Property 6: Keychain absence or failure falls back to memory and never writes a file**
    - **Validates: Requirements 2.2, 2.4, 2.6**

  - [x] 10.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 11. Implement sign-in, refresh and sign-out
  - [x] 11.1 Implement the sign-in flow
    - Create `src/auth/sign-in.ts` building the authorize request (endpoint, client id `7vmom55m1qstvq8i71ph127bfq`, scope `openid email events/access`, `code_challenge_method=S256`, `identity_provider=AWSBuilderID`, exact `http://localhost:<port>/callback`), returning the URL and using an injected browser opener, comparing returned `state`, exchanging the code at the token endpoint, storing all three tokens, storing no partial token on failure, and returning the memory-only notice when applicable
    - _Requirements: 1.7, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 2.3_

  - [x] 11.2 Write property test for authorize request construction
    - **Property 3: Authorize request is built correctly for any bound port**
    - **Validates: Requirements 1.9, 1.10, 1.11**

  - [x] 11.3 Write property test for state mismatch rejection
    - **Property 4: State mismatch is rejected**
    - **Validates: Requirements 1.12, 1.13**

  - [x] 11.4 Write unit tests for token exchange failure and memory-only notice
    - No partial token stored on exchange failure; memory-only notice text returned when no keychain is available
    - _Requirements: 1.15, 1.16, 2.3_

  - [x] 11.5 Implement single-flight refresh
    - Create `src/auth/refresh.ts` with `refreshIfNeeded` and `refreshNow` single-flight on the current refresh token, refreshing within 300s of expiry (expiry from `expires_in`, no JWT decoded), sending the refresh token only to the token endpoint, replacing stored access/ID tokens on success, and clearing all tokens only on `invalid_grant`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 11.6 Write property test for the refresh window boundary
    - **Property 8: Access token is refreshed exactly within 300 seconds of expiry**
    - **Validates: Requirements 3.1**

  - [x] 11.7 Write property test for invalid_grant clearing behaviour
    - **Property 9: Only an invalid_grant refresh clears all tokens**
    - **Validates: Requirements 3.4**

  - [x] 11.8 Write property test for single-flight refresh
    - **Property 10: Concurrent refreshes are single-flight**
    - **Validates: Requirements 3.5**

  - [x] 11.9 Implement sign-out
    - Create `src/auth/sign-out.ts` revoking the refresh token at the revoke endpoint, then clearing all tokens and returning `https://idp.awsevents.com/oidc/logout`, clearing regardless of revoke failure or a 10-second timeout
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 11.10 Write property test for sign-out
    - **Property 12: Sign-out always clears tokens and returns the logout URL**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 11.11 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement the catalog module
  - [x] 13.1 Implement app-data directory resolution
    - Create `src/catalog/app-data-dir.ts` with `resolveAppDataDir(env, homeDir, platform)` for Windows `%APPDATA%`, macOS `~/Library/Application Support`, Linux `$XDG_DATA_HOME` or `~/.local/share`, each joined with `reinvent-compass`
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 13.2 Write property test for app-data directory resolution
    - **Property 25: App-data directory resolves per platform**
    - **Validates: Requirements 14.1, 14.2, 14.3**

  - [x] 13.3 Implement pagination
    - Create `src/catalog/paginate.ts` with `fetchAllSessions(ctx, { includeAbstracts })` requesting pages until a response omits `nextToken`, following a non-empty `nextToken` even on a short page, sending `includeAbstracts=false` on a fast pass, doing no retry of its own, and surfacing a did-not-complete error on a non-retryable page error or a persistent 429 after the operation's single wait
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x] 13.4 Write property test for pagination ordering and stop condition
    - **Property 23: Pagination returns every page in order and stops only when nextToken is absent**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**

  - [x] 13.5 Write property test for page failure handling
    - **Property 24: Page 429 waits once then fails; non-retryable stops without completing**
    - **Validates: Requirements 13.5, 13.6**

  - [x] 13.6 Implement venue recovery and session normalisation
    - Create `src/catalog/venue-recovery.ts` with `recoverVenue(roomText, venues)` and `src/catalog/normalise.ts` with `normaliseSession(wire, venues, eventTimezone)` producing a value valid against `NormalisedSessionSchema`, setting offset-aware `startsAt`/`endsAt` through `Intl` when usable else recording them in `missingFields`, deriving `repeatOf` from `-R[0-9]?$`, recovering venue from the injected `VenueSchema`-parsed list, applying documented defaults (`isAllDay=false`, `isReservable=false`, `seatAvailability="unknown"`, `code=""`) while recording omissions, reading but never writing `data/venues.json`, and never inventing values
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10_

  - [x] 13.7 Write property test for normalisation validity
    - **Property 29: Normalisation always produces a valid normalised session**
    - **Validates: Requirements 15.1**

  - [x] 13.8 Write property test for session times
    - **Property 30: Session times are offset-aware when usable, absent and recorded otherwise**
    - **Validates: Requirements 15.2, 15.3**

  - [x] 13.9 Write property test for repeatOf derivation
    - **Property 31: repeatOf is derived from the -R suffix**
    - **Validates: Requirements 15.4**

  - [x] 13.10 Write property test for venue recovery
    - **Property 32: Venue is taken from the wire, else recovered, else absent and recorded**
    - **Validates: Requirements 15.5, 15.6, 15.7**

  - [x] 13.11 Write property test for missingFields and defaults
    - **Property 33: missingFields records exactly the absent tracked fields with documented defaults applied**
    - **Validates: Requirements 15.8, 15.10**

  - [x] 13.12 Write unit test that the normaliser never writes data/venues.json
    - Assert through a recording fs that no write targets `data/venues.json`
    - _Requirements: 15.9_

  - [x] 13.13 Implement the on-disk cache
    - Create `src/catalog/cache.ts` with `writeCache` (atomic temp-then-rename, dir created `0o700`, file mode `0o600` on POSIX, leaves old file on failure), `readCache`, `readCatalog` (refetch when older than configured max age), and `refreshCatalog` (overwrite in place with new data and ISO 8601 `fetchedAt` with offset), storing `{ fetchedAt, entries }` where each entry is `{ session, wire }`
    - _Requirements: 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x] 13.14 Write property test for cache round-trip
    - **Property 26: Cache write and read round-trip atomically with an ISO-8601 timestamp** (mode asserted on POSIX only)
    - **Validates: Requirements 14.4, 14.5, 14.6**

  - [x] 13.15 Write property test for stale-cache refetch
    - **Property 27: Stale cache is refetched**
    - **Validates: Requirements 14.7**

  - [x] 13.16 Write property test for failed cache write
    - **Property 28: A failed cache write leaves the existing file unchanged**
    - **Validates: Requirements 14.8**

  - [x] 13.17 Implement local filtering and the event window
    - Create `src/catalog/filter.ts` with `filterCatalog(sessions, filter)` combining text (title and abstract), type, level, day (local date of `startsAt`), venue, service and topic conjunctively, returning all when empty, and sending no API request
    - Create `src/catalog/event-window.ts` with `resolveEventWindow(listEvents, getEvent)` reading start, end and timezone from the API, erroring (`EventWindowError`) when any is absent or the timezone is not a valid IANA id, and never substituting a default
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 17.1, 17.2, 17.3, 17.4_

  - [x] 13.18 Write property test for local filtering
    - **Property 34: Local filtering is a conjunctive subset with no API call**
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.4**

  - [x] 13.19 Write property test for the event window
    - **Property 35: Event window comes from the API or errors, never a default**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4**

  - [x] 13.20 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 14. Implement the simulated transport
  - [x] 14.1 Implement the in-memory schedule and simulated transport
    - Create `src/simulated/in-memory-schedule.ts`, `src/simulated/fixtures.ts` and `src/simulated/simulated-transport.ts` with `createSimulatedTransport(cfg, fixtures)` serving `fixtures/api/**` (valid against `SessionWireSchema`), sourcing its session data from the S0 synthetic catalog at `fixtures/synthetic/catalog.json` (read-only), presenting a signed-in attendee with no OAuth call, updating an in-memory schedule so a later `GetSchedule` reflects a write, deriving bulk results (`sessionFull`, `scheduleConflict` with `conflictsWith`, `alreadyScheduled`), returning a configured 429 with `Retry-After` of 1 to 60 seconds and a configured 401 expired-token response, and never calling the live API
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

  - [x] 14.2 Write property test for simulated conformance and no live call
    - **Property 36: Simulated responses conform to configuration and never reach the live API**
    - **Validates: Requirements 18.1, 18.5, 18.7**

  - [x] 14.3 Write property test for simulated writes reflected by GetSchedule
    - **Property 37: Simulated writes are reflected by a later GetSchedule**
    - **Validates: Requirements 18.3**

  - [x] 14.4 Write property test for simulated bulk results
    - **Property 38: Simulated bulk results are derived from in-memory state**
    - **Validates: Requirements 18.4**

  - [x] 14.5 Write unit tests for simulated signed-in presentation and expired-token 401
    - Zero OAuth calls when presenting a signed-in attendee; configured expired-token 401 scenario
    - _Requirements: 18.2, 18.6_

  - [x] 14.6 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 15. Create fixtures for every operation and error path
  - [x] 15.1 Create success and error fixtures for all twelve operations
    - Create `fixtures/api/<operation>/<scenario>.json` with kebab-case folders, drawing all session data from the S0 synthetic catalog at `fixtures/synthetic/catalog.json` (read-only, do not invent sessions and do not edit that file), with at least one success fixture per operation and at least one error fixture per status condition (400, 401, 403, 404, 409, 429, 500 to 599), a 401 expired-token fixture, a two-or-more-page catalog set (non-final page carries `nextToken`, final omits it), and a ReserveSessions or AssociateFavorites fixture with at least one unknown `BulkFailureCode`
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_

  - [x] 15.2 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 16. Wire the subpath exports and the structural checks
  - [x] 16.1 Wire the api, auth, catalog and simulated index exports
    - Fill `src/api/index.ts` (exactly the twelve operation functions plus the confirmed-write helper and selector), `src/auth/index.ts`, `src/catalog/index.ts` and `src/simulated/index.ts` as the subpath entry points, with no shared barrel across streams
    - _Requirements: 6.1_

  - [x] 16.2 Write the structural export test for the twelve operations
    - Assert the `api` index exposes exactly the twelve operation functions, one file each, in `packages/core/test/api/`
    - _Requirements: 6.1_

  - [x] 16.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [x] 17. Implement the required security test
  - [x] 17.1 Write the required no-secret security test
    - **Property 7: No secret ever appears in logs or errors** (full named required run)
    - Exercise sign-in, token refresh and at least one failing Events API operation with token, refresh token, ID token, email and `Authorization` needles, asserting none appear in captured logs or in any returned or thrown error message or field
    - _Requirements: 20.1, 20.2, 20.3_

  - [x] 17.2 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [ ] 18. Implement the owner-gated live smoke tests
  - [ ] 18.1 Write the owner-gated live smoke tests
    - Guard with `COMPASS_LIVE_TESTS=1`: when unset, every test is reported skipped (never passed) and sends no live request; when set, cover sign-in, catalog, schedule, a favorite round trip, a personal-time round trip and exactly one reservation using only an owner-supplied session id
    - Do not run these tests yourself; they run only with `COMPASS_LIVE_TESTS=1`, set by the owner locally
    - _Requirements: 21.2, 21.3, 21.4, 21.5_

  - [ ] 18.2 Commit
    - After `npm test` (with the live tests skipped), `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

- [ ] 19. Final checkpoint - Ensure all tests pass and coverage is complete
  - Ensure all tests pass with 100% lines, branches, functions and statements for S1-owned code and zero named exclusions, lint, format and typecheck clean, ask the user if questions arise.
  - _Requirements: 21.1_

- [ ] 20. Capture feature screenshots for the Builder Center post
  - [ ] 20.1 Save two or three captures of the feature working in simulated mode
    - Run the client in `COMPASS_MODE=simulated` and save two or three screenshots or short terminal captures showing the feature working (for example sign-in presentation, a catalog read and a confirmed write) to `docs/article/screenshots/events-client/`
    - _Requirements: 21.1_

  - [ ] 20.2 Commit
    - After `npx eslint .` and `npx prettier --check .` both pass with zero errors, commit the captures with scope `events-client` (subject plus body via multiple `-m` flags). Never push.

## Notes

- There are no optional tasks. 100% coverage (Requirement 21.1) is part of S1's definition of done, so every test task is mandatory.
- Each task references specific granular requirements for traceability; every property test references its property number and the requirements it validates.
- Property-based tests use `fast-check` (minimum 100 iterations each) and are tagged `// Feature: events-client, Property {n}: {text}`. `fast-check` 4.10.2 is already a root devDependency and resolves from `packages/core` tests; no install is needed.
- `packages/contracts` (S0) and `data/venues.json` (S2) are read-only for this stream; tests supply their own venue fixture. Simulated-mode fixtures draw their session data from the S0 synthetic catalog at `fixtures/synthetic/catalog.json` (read-only); do not invent sessions and do not edit that file.
- Never call the live Events API from tests; use `COMPASS_MODE=simulated` and fixtures. Live smoke tests run only with `COMPASS_LIVE_TESTS=1`, set by the owner locally, and are never run by you.
- Commits use Conventional Commits scoped `events-client`, with subject and body passed via multiple `-m` flags (no commit message file), committed only after `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors. The first commit (task 1) includes `.kiro/specs/events-client/`. Never push, merge, open a PR or tag (the integrator handles those). No em dashes or en dashes anywhere.
- Do each task yourself in this chat in numeric order; do not delegate to the spec-task-execution subagent and do not run tasks as parallel waves. Save files after each step.
- Checkpoints (tasks 7, 12, 19) validate incrementally; the final checkpoint confirms the definition of done for coverage, lint, format and typecheck.

## Task Dependency Graph

Tasks run sequentially in numeric order. There are no parallel waves: every leaf task is placed in a single ordered wave so no task is started before the ones listed before it.

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": [
        "1.1",
        "1.2",
        "1.3",
        "1.4",
        "2.1",
        "2.2",
        "2.3",
        "2.4",
        "3.1",
        "3.2",
        "3.3",
        "3.4",
        "4.1",
        "4.2",
        "4.3",
        "4.4",
        "5.1",
        "5.2",
        "5.3",
        "6.1",
        "6.2",
        "6.3",
        "6.4",
        "6.5",
        "6.6",
        "8.1",
        "8.2",
        "8.3",
        "8.4",
        "8.5",
        "9.1",
        "9.2",
        "9.3",
        "9.4",
        "9.5",
        "9.6",
        "9.7",
        "9.8",
        "10.1",
        "10.2",
        "10.3",
        "10.4",
        "11.1",
        "11.2",
        "11.3",
        "11.4",
        "11.5",
        "11.6",
        "11.7",
        "11.8",
        "11.9",
        "11.10",
        "11.11",
        "13.1",
        "13.2",
        "13.3",
        "13.4",
        "13.5",
        "13.6",
        "13.7",
        "13.8",
        "13.9",
        "13.10",
        "13.11",
        "13.12",
        "13.13",
        "13.14",
        "13.15",
        "13.16",
        "13.17",
        "13.18",
        "13.19",
        "13.20",
        "14.1",
        "14.2",
        "14.3",
        "14.4",
        "14.5",
        "14.6",
        "15.1",
        "15.2",
        "16.1",
        "16.2",
        "16.3",
        "17.1",
        "17.2",
        "18.1",
        "18.2",
        "20.1",
        "20.2"
      ]
    }
  ]
}
```
