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
- Still for the owner: create the `npm-publish` environment in the GitHub repository with the owner as required reviewer, limited to `v*` tags (npm warns that anyone with write access to the repository can otherwise publish), and revoke the npm token from the manual publish once the placeholder is out (runbook step 4).

## SP1: Kiro hooks

Recorded in [ADR-024](decisions/ADR-024-kiro-hook-input-and-blocking.md). In short: PreToolUse exit 2 blocks and the agent gets stderr; exit 1 does not block; hook output on exit 0 never reaches the agent; a Power's tools reach hooks as the built-in `kiro_powers` tool with the real tool in `tool_input`, so the shipped guardrail hook must unwrap it; a Power cannot ship hooks; `awsevents` belongs in the workspace settings with the full `AWSEventsPublicApi-Mcp-prod___<Operation>` names in `disabledTools`. Steps 12 to 14 (import from GitHub) wait for the push.

## SP3: PassKit on a real iPhone

Not run yet. The owner runs it once against dev after the first deploy (checklist step 8 needs dev anyway), with the Pass Type ID certificate from owner task O1.
