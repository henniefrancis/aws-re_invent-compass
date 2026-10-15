# Kiro spec prompts

Build re:Invent Compass as five Kiro specs, in order, plus a sixth for the showcase website (to be written later). For each one: open Kiro, start a new **Spec**, paste the prompt, then review `requirements.md`, `design.md` and `tasks.md` before running any task.

The steering files in `.kiro/steering/` (product, tech, structure) load automatically, so the prompts don't repeat them.

**Review gate after each spec:** run the QA and security review agents (Claude Code) against the finished spec before starting the next. Do not start the next spec with open High or Critical findings.

| # | Spec name | Target dates |
|---|---|---|
| 1 | `events-client` | 15 to 18 Oct |
| 2 | `itinerary-rules` | 19 to 22 Oct |
| 3 | `compass-power` | 23 to 28 Oct |
| 4 | `boarding-passes` | 29 Oct to 1 Nov |
| 5 | `pass-signer-infra` | 30 Oct to 2 Nov |
| 6 | `showcase-site` (prompt to be written later) | 1 to 4 Nov |

---

## Spec 1: `events-client` (paste this first)

```
Create a spec named "events-client" for the foundation of re:Invent Compass: package @compass/core, folders auth/, api/, catalog/ and simulated/ as described in structure.md.

Goal: a typed, well-tested TypeScript client for the AWS Events API that every other part of Compass builds on. It must be correct about the API's real behaviour (see tech.md), work fully offline in simulated mode, and never leak tokens.

Requirements to cover (write them as EARS acceptance criteria):

1. Sign-in
   - OAuth 2.0 authorization code flow with PKCE against the endpoints in tech.md, always sending identity_provider=AWSBuilderID.
   - Loopback callback server on 127.0.0.1, trying ports 8484 to 8489 in order, path /callback, accepting exactly one request, validating state, then shutting down.
   - Fresh verifier and state for every attempt. S256 challenge, base64url without padding.
   - Store access and refresh tokens in the OS keychain only. Refresh the access token automatically before it expires (60 minute lifetime). If refresh fails, ask the attendee to sign in again.
   - Sign-out revokes the refresh token, clears the keychain, and returns the Builder ID sign-out URL for the attendee to open.

2. REST client for all 12 operations
   - ListEvents, GetEvent, ListSessions, GetSession, GetSchedule, ReserveSessions, CancelReservation, AssociateFavorites, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime, DeletePersonalTime.
   - One file per operation in api/, each with zod request and response schemas. Treat every session field as optional.
   - Before writing the schemas, fetch the official OpenAPI 3.1 document for the API and generate or check the schemas against it. Record its URL and version in docs/decisions/ADR-001-openapi-source.md.
   - Typed errors for 400, 401, 403, 404, 409, 429 and 5xx. On 429, wait for Retry-After seconds, then retry once. A 401 triggers one token refresh and one retry.
   - ReserveSessions and AssociateFavorites: batch 1 to 10 distinct IDs, return a per-session result (succeeded, or failed with reason code and any clash details). Unknown reason codes become a typed "unrecognised refusal". Never automatically re-send a reservation.
   - A "confirmed write" helper that performs any write and then calls GetSchedule and returns both the write result and the confirmed schedule.
   - Client-side quota tracking per operation so callers can avoid 429s (limits from tech.md).

3. Catalog cache
   - Fetch every page of ListSessions until nextToken is absent (never stop on a short page). Support includeAbstracts=false for a fast first pass.
   - Store the catalog locally as JSON with a fetch timestamp. Refresh on request or when older than a configurable age.
   - Normalise sessions into a stable internal Session type: parse start and end into timezone-aware values, detect repeats from "-R" in the session code, recover a missing venue from the room text using data/venues.json, and keep a list of fields that were missing.
   - Local filtering helpers (text, type, level, day, venue, service, topic), since the API has no search.

4. Simulated mode
   - A transport that serves recorded responses from fixtures/ instead of calling the network, selected by config (COMPASS_MODE=simulated), with a fake signed-in attendee.
   - Simulated writes update an in-memory schedule so the reserve, favorite and personal time flows behave realistically, including partial failures (full, clash, already reserved) and 429.
   - Fixtures for: multi-page catalog, a session with missing venue and end time, partial reservation failure, unknown failure code, 429 with Retry-After, expired token.

5. Quality
   - vitest unit and fixture tests for every operation and every error path above. CI never calls the live API; live smoke tests run only when COMPASS_LIVE_TESTS=1.
   - No token, authorization header or personal data ever appears in logs or thrown error messages. Add a test that proves it.

Out of scope for this spec: rules engine, MCP server, passes, infrastructure.

When designing, verify anything marked "reported by other participants" in tech.md against the OpenAPI document instead of assuming it.
```

---

## Spec 2: `itinerary-rules`

```
Create a spec named "itinerary-rules" for the pure rules engine in @compass/core (rules/). No I/O. Every function is deterministic and unit tested.

Implement the airline rules from product.md on top of the normalised Session and Schedule types from the events-client spec:

1. Boarding time: for each reservable session, boardingCloses = start minus 10 minutes. Know which session types are reservable (list in tech.md); keynotes and lecture-style breakouts are not.
2. Connections: for each pair of consecutive commitments (sessions and personal time), compute the walk from data/venues.json plus a configurable buffer. Classify as comfortable, tight or impossible against boardingCloses of the next session. If a venue is unknown, mark the connection "unknown" and say why.
3. Clashes: detect overlaps, including all-day sessions and items that cross midnight.
4. Layovers: detect days with no meal window (configurable, default 11:30 to 14:00 needs 30 free minutes) and long unbroken stretches. Suggest personal time blocks to fix them.
5. Energy budget: a simple, explainable score per day from the number of commitments, total walking and venue changes. Flag overloaded days.
6. Rebooking: for a full or problematic session, list repeats (same base code, "-R"), favorites on standby, and walk-up options, ranked with a reason each.
7. Safe swap plan: when moving to a repeat, produce the ordered steps (reserve the repeat first if it does not clash, confirm with GetSchedule, then cancel the original). If the repeat clashes with the original, say the swap cannot be made safely and explain the risk.
8. Guardrail verdict: a single function checkReservation(candidate, schedule) that returns allow, warn or block with human-readable reasons. This is what the Kiro PreToolUse hook will call.

Also create data/venues.json: the main re:Invent 2026 venues, coordinates, and a walking-time matrix, each value with a source note. Use official AWS re:Invent pages as sources. Where an official source is missing, mark the value "estimate".

All copy produced by rules (reasons, warnings) follows the voice rules in product.md, including no em dashes or en dashes.
```

---

## Spec 3: `compass-power`

```
Create a spec named "compass-power" covering three parts: the local MCP server (@compass/mcp-server), the repo scanner and week spec generator (in @compass/core scanner/ and spec/), and the distributable Kiro Power in power/.

1. Repo scanner (runs locally, reads only, never sends code anywhere)
   - Detect AWS service usage from: Terraform (aws_* resource and data types), AWS CDK TypeScript (aws-cdk-lib/aws-* imports and constructs), AWS SDK for JavaScript v3 (@aws-sdk/client-* packages and imports), and boto3 (client and resource calls).
   - Output per service: evidence (file paths and counts), a depth estimate (none, exploring, building, production) and a suggested session level (100 to 400), with the reasoning.
   - Map detected services to the catalog's services taxonomy values seen in the cached catalog. Keep the mapping table in code with tests.
   - Respect .gitignore and skip node_modules, build output and very large files.

2. Week spec generator
   - Inputs: scanner output, attendee goals (asked in conversation), arrival and departure times, the cached catalog, the current schedule.
   - Writes .kiro/specs/my-reinvent-week/ in the attendee's workspace:
     - requirements.md: the attendee's goals as EARS statements.
     - design.md: the itinerary by day, with a reason for every pick, connection times and status, layovers and the energy budget per day.
     - tasks.md: one task per API action (reserve, favorite as standby, create personal time for layovers and transit), each with the session code, time, venue and reason. The final task is "Issue boarding passes".
   - Re-running the generator updates the spec without losing the attendee's manual edits to goals.

3. Local MCP server (stdio)
   - Tools: sign_in, sign_out, refresh_catalog, find_sessions, scan_repo, plan_week, check_itinerary, reserve_with_guardrails, cancel_reservation, add_standby, add_layover, issue_boarding_passes, sync_passes.
   - Every write tool runs checkReservation (or the matching rule) first, uses the confirmed-write helper, and returns per-session results in plain English.
   - Tool descriptions state clearly when a tool changes the attendee's real schedule.
   - Works in simulated mode.

4. Kiro Power (Agent Plugins format, see https://kiro.dev/docs/powers/create/)
   - power/plugin.json with name, version, description, author, keywords (reinvent, re:Invent, conference, sessions, schedule, boarding pass, first-timer).
   - power/mcp.json with two servers: "compass" (local stdio, launched with npx) and "awsevents" (official remote MCP, config from tech.md).
   - Skills: plan-my-week (the end-to-end flow), first-timer-guide (with references/ sourced only from official AWS pages, each with its URL), install-hooks (copies hook templates into the attendee's .kiro/hooks).
   - Hook templates: a PreToolUse hook on reservation tools (both the compass server and the awsevents server) that runs the guardrail and blocks with reasons; a PostToolUse hook on write tools that re-reads the schedule and runs sync_passes. Verify the exact hook JSON schema and MCP tool matcher syntax against https://kiro.dev/docs/hooks/ during design.

Include an end-to-end test in simulated mode: scan a sample repo in fixtures/, plan a week, run all tasks, and confirm the schedule.
```

---

## Spec 4: `boarding-passes`

```
Create a spec named "boarding-passes" for issuing and syncing unofficial boarding passes from the local side (@compass/core passes/) and the pass layout used by the signer (@compass/pass-signer template/).

1. Pass model: one shared zod schema in core/src/passes/schema.ts with only printable fields: session code, title (truncated), venue, room, start, boardingCloses, walk from previous commitment, next connection, and the fixed disclaimer "Unofficial. Your badge is your ticket." No tokens, no email, no attendee name unless the attendee opts in.
2. Apple Wallet: boarding pass style with a generic transit type, relevance by time (and by venue location where supported), original artwork only, no AWS logos or colours. Verify current PassKit relevance fields during design.
3. Issue flow: for every reserved session in GetSchedule, build the pass fields locally, send them to the signer, and save the returned .pkpass files to a folder the attendee can open or AirDrop. Show a summary of what was issued.
4. Sync: compare the confirmed schedule with a local record of issued passes. Issue passes for new reservations, reissue changed ones, and list passes to remove for cancelled sessions with clear instructions.
5. Calendar fallback: an .ics file with one event per commitment and two alarms per reserved session (leave now, based on the walk; boarding closes). Works with no signer and no keys.
6. Google Wallet: a generic or event ticket pass with the same fields and disclaimer, delivered as a "Save to Google Wallet" link. The signer signs the JWT. Note: until the issuer account has publishing access, only test users listed in the Google Pay and Wallet Console can save passes.

Tests: snapshot tests for pass fields and the .ics output, plus sync diff tests (added, changed, cancelled, unchanged).
```

---

## Spec 5: `pass-signer-infra`

```
Create a spec named "pass-signer-infra" for the hosted, stateless pass signer: Lambda handler in @compass/pass-signer and Terraform in infra/.

Deploy to Hennie's personal AWS account in us-east-1. Follow "Public and private" in tech.md: the code and Terraform are public, account-specific values and signing material are not.

1. Lambda (Node.js 24 runtime, TypeScript, bundled): accepts POST with the pass schema from core, validates strictly with zod (maximum lengths, allowed characters, no URLs or images from the client), builds the pass from the fixed template, and returns either a signed .pkpass (Apple) or a signed "Save to Google Wallet" link (Google). Stateless: no database, no logging of request bodies.
2. Signing material in AWS Secrets Manager, read at runtime with caching: Apple Pass Type ID certificate and key, Apple WWDR certificate, Google Wallet issuer service account key and issuer ID. Terraform creates the empty secret containers only; values are loaded out of band and never appear in the repo, Terraform state, outputs or environment variable values.
3. API Gateway REST API (regional), because AWS WAF cannot attach to HTTP APIs. Stage and method throttling, an AWS WAF web ACL with a rate-based rule and AWS managed rule groups, request body size limit, no CORS (the caller is a local Node process, not a browser).
4. Terraform only: a reusable module in infra/modules/pass-signer and a prod environment in infra/envs/prod. Remote state in an S3 backend with native locking; the backend settings live in a git-ignored backend.hcl with a committed backend.hcl.example. Least-privilege IAM: the Lambda can read only its own secrets. CloudWatch log retention set. Tags on everything. Resource names and descriptions use hyphens, never em dashes.
5. Deployment from GitHub Actions through an IAM role assumed with GitHub OIDC, scoped to this repository and the main branch. No long-lived AWS keys anywhere.
6. Follow the AWS Well-Architected security and cost pillars. Expected cost at hackathon scale should be near zero; document it, and add an AWS Budgets alert in Terraform.
7. Tests: handler unit tests (valid Apple pass, valid Google link, oversized fields, injected URLs, missing fields) and terraform fmt, validate and a plan check in CI.
```
