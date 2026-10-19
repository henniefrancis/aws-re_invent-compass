# Spike and owner-check results

The owner ran these on the real platforms on 18 October 2026. This file holds no secret, token, key, device identifier or personal value: only public metadata, claim names and pass or fail results. The build plan (section 10) defines each spike; ADR-024 holds the SP1 result.

## SP2: ID token issuer and offline verification

Run: a fresh Builder ID sign-in through the S1 sign-in code (tokens held only in the OS keychain under a spike-only service name), then `spikes/sp2-id-token.ts` with the ID token passed only in that process's environment.

| Item                                                           | Result                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `alg`                                                          | `RS256`                                                                                                                                    |
| `iss`                                                          | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_NdvQjp0vF` (a Cognito user pool, as plan 5.4 step 1 expected)                       |
| `aud` equals the shared client id `7vmom55m1qstvq8i71ph127bfq` | yes                                                                                                                                        |
| `token_use`                                                    | `id`                                                                                                                                       |
| `sub` among the claims                                         | yes                                                                                                                                        |
| Other claim names                                              | `at_hash`, `auth_time`, `cognito:groups`, `cognito:username`, `email`, `email_verified`, `iat`, `identities`, `jti`, `nonce`, `origin_jti` |
| Discovery (`<iss>/.well-known/openid-configuration`)           | 200; `issuer` equals `iss`; `id_token_signing_alg_values_supported` is `["RS256"]`                                                         |
| `jwks_uri`                                                     | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_NdvQjp0vF/.well-known/jwks.json` (200, 2 keys)                                      |
| Offline verification                                           | `verified` (exit 0)                                                                                                                        |

Outcome: the assumption holds. Configuration: `ID_TOKEN_VERIFIER=cognito`, `ID_TOKEN_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_NdvQjp0vF`, `ID_TOKEN_CLIENT_ID` stays at its default. `ID_TOKEN_JWKS_URI` is not needed in `cognito` mode.

Notes:

- The ID token carries `email`, `cognito:username` and `identities`. The pass service must keep reading only `sub` (hashed to SubHash) and never log or store these claims (ADR-012).
- The spike uses the generic `JwtVerifier`, which ignores the `tokenUse` option it is given; `token_use` above comes from the decoded claims. The production verifier uses `CognitoJwtVerifier` with `tokenUse: "id"`, which does check it.

## SP5: real data shape

Run: the owner recorded the raw response bodies (not parsed through the zod schemas, so unknown fields are kept) of ListEvents, GetEvent, every ListSessions page with abstracts, and one GetSession into the git-ignored `fixtures/.raw/`. Then `spikes/sp5-shape-diff.ts`, plus an offline analysis of every recorded session against the Events API OpenAPI (`packages/contracts/events-api.openapi.json`) and the zod wire schemas. Only field names, types and counts were printed.

Recorded: 2 events, 2245 sessions over 9 pages (page size 250, `totalCount` present).

### Against the OpenAPI and the contracts

| Check                                                     | Result                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Fields in the recordings that the OpenAPI does not define | none                                                                                                       |
| Type differences against the OpenAPI                      | none                                                                                                       |
| `SessionWireSchema` over all 2245 sessions                | all parse                                                                                                  |
| `ListSessionsSchema` (page 1) and `GetSessionSchema`      | parse                                                                                                      |
| ListEvents, GetEvent envelopes                            | `items` and `event`; every Event field present, including `timezone`                                       |
| `sessionTime` formats                                     | `date` YYYY-MM-DD, `time` HH:MM, `length` whole minutes (2 or 3 digits), the same as the synthetic catalog |

Outcome: **no change is needed in `packages/contracts`.** The OpenAPI and the wire schemas already describe the real data.

### Against the synthetic catalog (`fixtures/synthetic/catalog.json`)

`spikes/sp5-shape-diff.ts` reported four field differences against the first synthetic session; the full analysis adds the counts and two behaviours:

1. `sessionTime.timezone` is **never** present in the real data (0 of 2245); every synthetic session has it. The code already falls back to the event timezone (`normalise.ts`), so the real path is the fallback path, which the synthetic data never exercises.
2. `seatAvailability` is absent on 780 of 2245 sessions: exactly the sessions with `isReservable: false` (771, plus 9 all-day sessions). Every synthetic session has it. The contract has it optional, and normalising maps a missing value to `unknown`. Values seen on 18 October: `unavailable` 1252, `veryLimited` 121, `limited` 76, `available` 16; `walkUp` was not seen.
3. `topics` (2230 sessions) and `features` (2223) are present in the real data and absent from the synthetic catalog. `areasOfInterest` (1870), `roles` (1800), `services` (1612) and `industries` (207) are partial. `tracks`, `segments`, `customerPersonas`, `experiences`, `additionalActivities` and `focusAreas` never appear (the OpenAPI keeps them optional).
4. Repeat codes: in the real catalog a repeated session **never** has an unsuffixed code. The first offering is `<code>-R` and later ones are `-R1` to `-R4` (469 groups of two, 14 of three, one of four, one of five, nine single `-R`). The synthetic catalog has the base code plus `-R` and `-R2`. 297 real codes end in `-S` (and 2 in `-S-R` or `-S-R1`); `-S` is not a repeat marker and never has an unsuffixed sibling. The rebooking rules match repeats by base code, so they work; `repeatOf` names a base code that is not itself in the catalog.
5. In 14 repeat groups the titles differ between offerings.

Suggested fixture follow-up (not contracts; for the fixture owner): drop `sessionTime.timezone`, leave `seatAvailability` out of the non-reservable sessions, add `topics` and `features`, and model repeats as `-R`, `-R1` with no unsuffixed original, plus a few `-S` codes. Then add a test that a repeat group with no unsuffixed original still offers its siblings as rebooking options.

Spike tool gap: `spikes/sp5-shape-diff.ts` diffs only the first element of each recording and does not compare with the OpenAPI, which foundation-contracts Requirement 10.1 asks for. The full analysis above covered both by hand this time.

### Event window (GetEvent, through `resolveEventWindow`)

- `EVENT_WINDOW_START=2026-11-30T05:30:00.000-08:00`
- `EVENT_WINDOW_END=2026-12-04T23:59:00.000-08:00`
- `EVENT_TIMEZONE=America/Los_Angeles`

The spike tokens were revoked and removed after the recording.

## Live smoke test

Deferred by the owner on 18 October. The reads it covers (sign-in, keychain storage, ListEvents, GetEvent, every ListSessions page, GetSession) already ran against the real API during SP5. Still to run before release: the schedule read and the favourite, personal-time and single-reservation round trips.

## Terraform provider lock files (ADR-027 item 3)

Generated by the owner for linux_amd64, windows_amd64 and darwin_arm64 and committed in `infra/bootstrap`, `infra/envs/dev` and `infra/envs/prod`: `hashicorp/aws` 6.69.1 in all three, `hashicorp/tfe` 0.82.0 in bootstrap. `node --test "infra/tests/static/*.test.mjs"` now runs the lock test and it passes (63 pass, 0 fail; the one skip is the separate jq check). The release gate is cleared.

`terraform validate` passes in all three roots with warnings from aws 6.69.1: `range_key` on `aws_dynamodb_table` is deprecated in favour of `key_schema` (`infra/modules/data/main.tf`, plus one similar deprecation warning), and the bootstrap's `tfe_variable.aws_provider_auth` has a write-only `value_wo` alternative (the value is the non-secret `"true"`, so no change is needed there).

## npm name

`reinvent-compass` was free and is claimed: the owner published a placeholder `0.0.1` (README only, no code, no scripts) on 18 October. The placeholder replaces the runbook's first manual publish of the real package, because that needs the prod CloudFront domain in the source. Consequences:

- The first real release must be `0.1.0` or later. Afterwards deprecate the placeholder: `npm deprecate reinvent-compass@0.0.1 "placeholder, use 0.1.0 or later"`.
- The trusted publisher must name the environment `npm-publish`, because `.github/workflows/publish.yml` runs in it. `docs/runbooks/npm-release.md` (one-time setup, step 3) says to leave the environment empty and needs correcting, and its step 2 should describe the placeholder.
- Trusted publisher, set up on 18 October and checked with `npm trust list reinvent-compass`: GitHub Actions, repository `henniefrancis/aws-re_invent-compass`, workflow `publish.yml`, environment `npm-publish`, permissions `publish, stage publish`. The first setup allowed only `stage publish`, which would have refused the workflow's plain `npm publish`; it was revoked and created again with `--allow-publish`.
- GitHub environment `npm-publish` (checked with `gh api` on 18 October): deployments only from tags matching `v*`, and the owner (`henniefrancis`) as required reviewer with self-review allowed, so every publish waits for the owner's approval. npm warns that anyone with write access to the repository could otherwise publish.
- The owner signed out of npm (`npm logout`), which invalidates the token from the manual publish (runbook step 4), and set the package's publishing access to "Require two-factor authentication and disallow tokens", so only a two-factor publish or the trusted publisher (OIDC) can publish.

## SP1: Kiro hooks

Recorded in [ADR-024](decisions/ADR-024-kiro-hook-input-and-blocking.md). In short: PreToolUse exit 2 blocks and the agent gets stderr; exit 1 does not block; hook output on exit 0 never reaches the agent; a Power's tools reach hooks as the built-in `kiro_powers` tool with the real tool in `tool_input`, so the shipped guardrail hook must unwrap it; a Power cannot ship hooks; `awsevents` belongs in the workspace settings with the full `AWSEventsPublicApi-Mcp-prod___<Operation>` names in `disabledTools`. Steps 12 to 14 (import from GitHub) wait for the push.

## SP3: PassKit on a real iPhone

Run on 19 October 2026 by the owner on his iPhone against dev (`https://dev.reinvent-compass.vegas`), through the real product path: Kiro with the local MCP server built from develop and pointed at dev (`COMPASS_API_URL` with `COMPASS_ALLOW_API_OVERRIDE=1`), a live Builder ID sign-in, then `issue_boarding_passes`, `send_to_phone`, the `/board` page in Safari, and `sync_passes` for changes. Two of the owner's real reservations (BIZ332, Monday 30 November, and MAM411, Thursday 3 December) carried the passes; a throwaway reservation (INV531) was made and cancelled for the void test. Device registration and fetches were read from the passkit Lambda's request log lines (route template and status only), so no device id, push token or serial was seen.

| #   | Point                                                                                                                  | Result                         |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Issue and add: right fields, boarding closes at start minus 10 minutes, the disclaimer, no barcode, sharing prohibited | Pass, after two fixes (below)  |
| 2   | The device registers with the PassKit web service                                                                      | Pass                           |
| 3   | Update and push: production APNs with the Pass Type ID certificate, the pass updates by itself                         | Pass, within about two minutes |
| 4   | Void: the pass moves out of the main stack to the expired state                                                        | Pass                           |
| 5   | A `.pkpasses` bundle with more than one pass in Safari                                                                 | Pass (one sheet, two passes)   |
| 6   | `webServiceURL` path join: no double slash, the device calls `/api/passkit/v1/devices/...`                             | Pass                           |

What was observed:

1. Issue. The pass service verified the live Builder ID token and issued both passes (the first real use of the dev API with a live token). After the fixes, one Safari sheet offered both passes and Add All added them; adding the same bundle again did nothing, as expected for the same serials. On each pass: BOARDING CLOSES 9:50 AM for a 10:00 start and 12:50 PM for a 13:00 start; SESSION, GATE (venue), TITLE, STARTS, ENDS and NOTICE "Unofficial. Your badge is your ticket."; no barcode; no Share action; Automatic Updates on. An offline check of the downloaded bundle (a throwaway script that printed only booleans, file names, image sizes and field labels) confirmed: manifest hashes match; the detached signature verifies; the signer certificate's UID and OU equal `passTypeIdentifier` and `teamIdentifier`; it is issued by Apple WWDR G4, which is included and valid; icon 29, 58 and 87 px and logo 160 by 50, 320 by 100 and 480 by 150 px; Wallet accepted that artwork.
2. Register. Two `POST /api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}` with 201, one per pass, followed by `GET .../registrations/{passTypeIdentifier}` 200 and `GET /api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}` 200.
3. Update and push. A test layover at MGM Grand before BIZ332, then `sync_passes` (1 updated): the phone fetched the changed serials and the new pass by itself and showed "WALK FROM PREVIOUS: 55 min from MGM Grand" on the back within the owner's two-minute wait. Deleting the layover and syncing again removed the line the same way. No `apns-push-type` header was needed (`APNS_PUSH_TYPE` stays unset) and `apns-topic` equal to the Pass Type ID works. Wallet sends `If-Modified-Since`: one latest-pass fetch answered 304. The update is silent (no lock-screen notice), because no field sets a change message.
4. Void. Reserve INV531, issue and add its pass, cancel the reservation, `sync_passes` (1 voided): the phone fetched the voided pass and Wallet moved it out of the main stack as expired. Wallet also sent one `POST /api/passkit/v1/log` (200); its text is counted, never stored, so its content is unknown.
5. Bundle. The hand-off's `.pkpasses` with two passes added from one Safari sheet.
6. Path join. Every device request matched the `/api/passkit/v1/...` templates, so Wallet joins `webServiceURL` (`https://dev.reinvent-compass.vegas/api/passkit`, no trailing slash) and `/v1/...` with one slash. `PASSKIT_WEB_SERVICE_PATH` keeps its default `/api/passkit`.

Fixes made during the run, and why:

- `325d34e` `fix(foundation-contracts)`: Wallet first refused the bundle ("cannot be installed"). Safari's Add to Apple Wallet link sends `Accept: text/html,...` first and API Gateway honours only the first Accept media type, so the bundle arrived as base64 text (the same URL with `Accept: application/vnd.apple.pkpasses` returned a zip). This was pass-service design Open Question 6. The contract now lists `*/*` as a binary media type, as AWS documents for browser clients; the Lambdas already decode base64 request bodies. Kiro task foundation-contracts 16.
- `0a8c282` `fix(infra)`: after that deploy, `get-rest-api` still listed only the three original types; updating the body of an existing REST API did not change them. The api module now sets `binary_media_types` from its contract copy with `yamldecode`, and the deployment trigger includes the list. After this deploy the API listed `*/*` and the bundle arrived as binary. Kiro task infra 21, design item 39.

Not affected by the fixes: the JSON routes (issue, hand-off, registration, log) all worked after `*/*` was added.

Found, not fixed here (follow-ups):

- The ROOM line never appears: catalog rooms are written like "Level 1 | Academy 409" and the pass text rule does not allow `|`, so the room falls back to empty.
- No Compass tool lists the attendee's reservations, favourites or personal time; `export_calendar` with no input is the only read of the live schedule, and its UIDs (`session-<id>`, `layover-<id>`) were needed to find ids. `add_layover` returns the new `personalTimeId` in the structured result only, so a client that shows only text (Kiro) cannot see it.
- The wanted hero shot (the pass on the lock screen) cannot be taken before the event: Wallet shows a pass there only around its `relevantDates` (30 November to 3 December). The pass's header label is "BOARDING CLOSES", not "Seat released at".
- No screenshots or video were taken in this run.

Fallback: not needed. Pushes work, so `APNS_ENABLED` stays `true`.
