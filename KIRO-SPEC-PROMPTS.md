# Kiro spec prompts

re:Invent Compass is built as **eight Kiro specs (S0 to S7)** by up to six Kiro sessions working in parallel. Every prompt below comes from the approved build plan ([docs/architecture/build-plan.md](docs/architecture/build-plan.md)) and its decisions ([docs/decisions/](docs/decisions/)). The steering files in `.kiro/steering/` (product, tech, structure, workflow) load into every session automatically, so the prompts do not repeat them.

## How to run a spec

1. **Ask Claude (the integrator) for a worktree.** Each spec gets its own folder and branch, cut from `develop`. Claude runs, for example:
   ```bash
   git worktree add ../compass-wt/events-client -b feature/events-client develop
   ```
2. **Open that folder in Kiro**, start a new **Spec**, and paste the prompt for that spec.
3. **Review** Kiro's `requirements.md`, `design.md` and `tasks.md` before running any task. Check them against the plan sections the prompt names.
4. **Run the tasks.** Kiro commits locally on its branch and never pushes (workflow.md).
5. **Review gate:** tell Claude the spec is done. QA and security review the branch; Kiro fixes findings until no High or Critical is open. Claude then merges the branch into `develop` locally, removes the worktree, and every other stream rebases.

## Engineers and dates (plan section 9.3)

| Engineer | Specs                                                  | Starts | Spec freeze            | Review gate    | In `develop`   |
| -------- | ------------------------------------------------------ | ------ | ---------------------- | -------------- | -------------- |
| 1        | **S0** foundation-contracts, then **S1** events-client | 16 Oct | S0 16 Oct, S1 21 Oct   | 16 Oct, 22 Oct | 16 Oct, 22 Oct |
| 2        | **S2** itinerary-rules, then **S7** showcase-site      | 17 Oct | S2 20 Oct, S7 29 Oct   | 21 Oct, 29 Oct | 21 Oct, 29 Oct |
| 3        | **S3** compass-power                                   | 17 Oct | 26 Oct                 | 27 Oct         | 27 Oct         |
| 4        | **S4** boarding-passes                                 | 17 Oct | 23 Oct                 | 24 Oct         | 24 Oct         |
| 5        | **S5** pass-service                                    | 17 Oct | 24 Oct                 | 25 Oct         | 25 Oct         |
| 6        | **S6** infra                                           | 17 Oct | 24 Oct (dev up 21 Oct) | 25 Oct         | 25 Oct         |

**Only four sessions?** Engineer 2 also takes S4 after S2, and Engineer 5 takes S6 after S5. The site then starts on 24 Oct, and cut-list items 1 to 3 (plan section 12) are cut up front.

Milestones: contract lock and day-1 spikes **16 Oct**; first dev deploy **21 Oct**; real-phone checks **25 Oct**; feature freeze **28 Oct**; site freeze and `release/1.0.0` **29 Oct**; release gate and prod **30 Oct**; video **31 Oct**; **submit 1 Nov**.

**Contract lock (ADR-025, 16 Oct):** S0 tasks 1 to 7 (scaffold, dependencies, all shared schemas and the Compass API contract) were merged into `develop` early, so the other streams start now. S0 tasks 8 to 15 (scanners, synthetic catalog, spikes, CI, hooks, examples) finish on `feature/foundation-contracts` and merge later. Until the synthetic catalog lands, a stream that needs sample sessions creates a few made-up ones in its own `test/` folder from the `SessionWire` schema, and switches to `fixtures/synthetic/` once it is merged. Because engineer 1 is still finishing S0, **S1 starts in its own Kiro session**.

**Contracts are frozen.** Never edit `packages/contracts/**` or `contracts/**` from a stream. If a contract must change, stop and ask the integrator.

---

## S0: `foundation-contracts` (Engineer 1, 16 Oct, paste first)

```
Create a spec named "foundation-contracts" on branch feature/foundation-contracts.

Read first: docs/architecture/build-plan.md sections 3, 4.1, 5 (all), 8 (S0 row), 9.1, 9.2 and 11.1, and docs/decisions/ADR-006, ADR-007, ADR-008, ADR-016, ADR-018.

Goal: lock the shared contracts and scaffolding in one day, so six engineers can build in parallel tomorrow without touching each other's files.

You own: root configs, package.json workspaces and package-lock.json, packages/contracts/**, contracts/**, .github/**, fixtures/synthetic/**, spikes/**, .kiro/hooks/**, and the steering files.

Requirements:
1. npm workspaces monorepo: packages/contracts, packages/core, packages/mcp-server, packages/pass-service, site. TypeScript 6 strict, ESLint flat config (typescript-eslint; angular-eslint prepared for site), Prettier, vitest 4 with v8 coverage thresholds at 100% (named exclusions per plan 11.2). Pre-install every dependency the plan names, with exact pins, so other streams never edit package.json.
2. packages/core exposes subpath exports (@compass/core/auth, /api, /catalog, /simulated, /rules, /scanner, /spec, /passes) with empty, compiling entry points and no shared barrel file. The rules subpath must be importable in a browser (no Node imports).
3. packages/contracts:
   - Fetch the official Events API OpenAPI document (https://api.awsevents.com/v1/openapi.json, see the REST docs), commit it, record its URL, date and SHA-256 in docs/decisions/ADR-023-events-api-openapi-source.md, and generate TypeScript types from it.
   - Zod schemas and types: Session (every field optional except sessionId, read defensively), Schedule, Commitment (session or personal time), Venue, Verdict (allow, warn, block with reasons), PassFields (exact rules in plan 5.3), Compass API error type (application/problem+json), and the MCP tool input and output schemas for every tool in plan 8.1.
4. contracts/compass-api.openapi.yaml (OpenAPI 3.0.1) with every route in plan 5.2, its auth, request and response shapes and x-amazon-apigateway extensions. Byte-identical copies in packages/contracts/openapi.yaml and infra/modules/api/openapi.yaml, plus a script that checks the three SHA-256 hashes. Generate Compass API types from it.
5. Synthetic catalog: a deterministic generator and a committed catalog of about 120 made-up sessions in the real data shape across the real venues (made-up titles, speakers and codes; real venue names), including repeats (-R), all-day items, missing venues and missing end times. It must validate against the same zod schemas used for live data.
6. .github/workflows: check.yml (one job on pull_request into main only, steps in plan 11.1), e2e.yml (workflow_dispatch only), publish.yml (tag v* only, npm trusted publishing with provenance), dependabot.yml (monthly, open-pull-requests-limit 0). Pin every action by commit SHA. No push or schedule triggers.
7. .kiro/hooks for this repo: run lint and the owning package's tests on save of TypeScript files.
8. spikes/: two owner-run scripts for the day-1 spikes. spikes/sp2-id-token.mjs: after a local sign-in, prints only alg, kid, iss, aud, token_use, exp and claim NAMES (never values), fetches <iss>/.well-known/openid-configuration and the JWKS, and verifies the token with aws-jwt-verify. spikes/sp5-shape-diff.mjs: compares recordings in fixtures/.raw/ (git-ignored) with the synthetic catalog and the official OpenAPI and prints field-level differences only, never values.
9. Update CONCEPT.md dates if anything in this spec changes them, and the .example files (.env.example, infra/envs/*/terraform.tfvars.example, cloud.auto.tfbackend.example).

Acceptance: everything compiles; npm test passes with coverage on; the hash check passes; every later stream can import its types from @compass/contracts; the synthetic catalog validates; CI workflow files lint clean (actionlint).

Out of scope: any feature logic. Leave each package with an index that compiles and a placeholder test.
```

---

## S1: `events-client` (Engineer 1, after S0)

```
Create a spec named "events-client" on branch feature/events-client.

Read first: .kiro/steering/tech.md (Events API facts and behaviour rules), docs/architecture/build-plan.md sections 3.3 (flows 1 to 3), 4.2 (P1 to P5), 4.3 (local MCP server rows), 8 (S1 row) and 11.2.

You own: packages/core/src/{auth,api,catalog,simulated}/** and fixtures/api/**. Types come from @compass/contracts only.

Requirements (write them as EARS acceptance criteria):
1. Sign-in: OAuth 2.0 authorization code with PKCE, loopback server on 127.0.0.1 trying ports 8484 to 8489 at path /callback, one request then shut down, state validated, identity_provider=AWSBuilderID always sent. Store access, refresh and ID tokens in the OS keychain (@napi-rs/keyring); when no keychain exists (headless Linux, WSL), keep them in memory only and say so. Refresh before expiry. Sign-out revokes the refresh token, clears the keychain and returns the Builder ID sign-out URL. Expose the ID token only to the passes module (for the Compass API).
2. A typed client for all 12 operations, one file each, validating every response with the contract schemas. Typed errors for 400, 401, 403, 404, 409, 429, 5xx. A 401 triggers one refresh and one retry; a 429 waits Retry-After once. Never retry a reservation automatically.
3. ReserveSessions and AssociateFavorites: 1 to 10 distinct IDs, per-session results, unknown failure codes become an "unrecognised refusal". A confirmed-write helper performs any write, then GetSchedule, and returns both.
4. Client-side quota tracker per operation (limits in tech.md).
5. Catalog: walk every page until nextToken is absent (never stop on a short page), with includeAbstracts=false for a fast pass. Cache in the OS app-data folder (plan P4 paths, mode 0600), with a fetch timestamp and refresh on request or age. Normalise sessions: timezone-aware start and end, repeat detection from "-R", venue recovery from room text using data/venues.json (read through its schema; S2 owns the file), and a list of missing fields. Local filters: text, type, level, day, venue, service, topic.
6. Event window and timezone come from ListEvents and GetEvent, never hard-coded.
7. Simulated mode (COMPASS_MODE=simulated): serves fixtures built on the synthetic catalog, with a fake signed-in attendee and an in-memory schedule, so reserve, favorite and personal-time flows behave realistically, including partial failures (full, clash, already reserved), 429 and an expired token.

Tests: fixtures for every operation and error path, multi-page catalogs, unknown codes; a test proving no token, ID token, email or authorization header ever reaches logs or error messages. 100% coverage.

Live smoke tests exist but run only with COMPASS_LIVE_TESTS=1 (owner, locally).
```

---

## S2: `itinerary-rules` (Engineer 2, from 17 Oct)

```
Create a spec named "itinerary-rules" on branch feature/itinerary-rules.

Read first: .kiro/steering/product.md (metaphor and rules), tech.md (re:Invent rules), docs/architecture/build-plan.md section 8 (S2 row) and 11.2.

You own: packages/core/src/rules/** and data/venues.json. This code must be pure (no I/O) and browser-safe (no Node imports): the showcase site runs it.

Requirements:
1. Boarding: boardingCloses = start minus 10 minutes for reservable session types; know which types are reservable and which are not (keynotes, lecture-style breakouts).
2. Connections: for each pair of consecutive commitments, walking minutes from data/venues.json plus a configurable buffer, classified comfortable, tight, impossible or unknown against the next boardingCloses. Unknown venue gives "unknown" with the reason.
3. Clashes, including all-day items and anything crossing midnight in the event timezone.
4. Layovers: days with no meal window (default 11:30 to 14:00 needs 30 free minutes) and long unbroken stretches, with suggested personal-time blocks.
5. Energy budget per day (commitments, total walking, venue changes), explainable, flags overloaded days. (Cut-list item 2: build it last.)
6. Rebooking for a full or problematic session: repeats (same base code with -R), favorites on standby, walk-up options, each with a reason.
7. Safe swap: ordered steps (reserve the repeat first if it does not clash, confirm with GetSchedule, then cancel the original). If the repeat clashes with the original, say the swap cannot be made safely and why.
8. checkReservation(candidate, schedule, context) returns a Verdict (allow, warn or block) with plain-English reasons. The MCP server, the Kiro hook and the site demo all call this one function.
9. data/venues.json: the main re:Invent 2026 venues, coordinates and a walking-time matrix, each value with a source note (official AWS re:Invent pages); values without an official source are marked "estimate". Validated by the Venue schema.

All reasons and warnings follow the voice rules (plain English, no em dashes or en dashes). Tests: property-style edge cases (midnight, all-day, missing venue, missing end, DST-safe arithmetic, identical times). 100% branch coverage.
```

---

## S3: `compass-power` (Engineer 3, from 17 Oct)

```
Create a spec named "compass-power" on branch feature/compass-power.

Read first: docs/architecture/build-plan.md sections 3 (all), 4.3 (local MCP server, Kiro hooks and remote awsevents rows), 8 (S3 row) and 8.1 (tools and API use), docs/decisions/ADR-005, ADR-017, and the day-1 SP1 result (Kiro hook input and blocking) recorded in docs/decisions or tech.md. Kiro Powers docs: https://kiro.dev/docs/powers/create/ ; hooks: https://kiro.dev/docs/hooks/

You own: packages/mcp-server/**, packages/core/src/{scanner,spec}/**, power/**, fixtures/sample-repo/**. Build against S1, S2 and S4 through their contracts with mocks until they are merged.

Requirements:
1. Repo scanner (local, read-only): Terraform aws_* types, AWS CDK TypeScript imports and constructs, AWS SDK for JavaScript v3 client packages and imports, boto3 client and resource calls. Per service: evidence counts (no file contents, no file paths leave the scanner), depth (none, exploring, building, production) and a suggested level (100 to 400) with the reasoning. Map services to the catalog's services taxonomy with a tested mapping table. Respect .gitignore; skip node_modules, build output and large files. (boto3 is cut-list item 3: build it last.)
2. Week spec generator: writes .kiro/specs/my-reinvent-week/ (requirements.md as EARS goals, design.md with the itinerary by day, a reason per pick, connections, layovers and energy, tasks.md with one task per API action and a final "Issue boarding passes" task). Offers to add the folder to .gitignore and explains why. Re-running writes a new dated file and shows the diff instead of merging (cut-list item 4 default).
3. Local MCP server (stdio) with the tools in plan 8.1. Write tools run checkReservation inside the server, use the confirmed-write helper, return per-session results in plain English, and state in their description that they change the attendee's real schedule. Catalog text is returned as labelled data, never as instructions. Read tools may be auto-approved; write tools never.
4. CLI in the same package: `npx reinvent-compass` starts the server; `npx reinvent-compass demo` runs the whole flow in simulated mode in the terminal (scan the sample repo, plan, a blocked clash, a safe swap, reserve, issue passes, QR hand-off, cancel, void), so judges can see it in one command; `npx reinvent-compass hook <name>` is what the Kiro hooks call (input as JSON per SP1, fixed argv, never a shell).
5. Kiro Power (Agent Plugins format): power/plugin.json (name, version, description, author, keywords: reinvent, re:Invent, conference, sessions, schedule, boarding pass, first-timer), power/mcp.json with "compass" (stdio via npx, pinned version) and "awsevents" (remote, config from tech.md, write tools in disabledTools), skills plan-my-week, first-timer-guide (references only from official AWS pages, each with its URL) and install-hooks, and power/hook-templates (PreToolUse guardrail on Compass and awsevents write tools; PostToolUse sync after writes).
6. Document setup for other MCP clients (Claude Desktop, VS Code, Kiro CLI) in the package README, noting that hooks are Kiro-only and the guardrail runs in the server regardless.

Tests: simulated end-to-end of the whole flow above; scanner fixtures; prompt-injection test (a session abstract containing instructions must not trigger a write). 100% coverage (bin.ts excluded).
```

---

## S4: `boarding-passes` (Engineer 4, from 17 Oct)

```
Create a spec named "boarding-passes" on branch feature/boarding-passes.

Read first: docs/architecture/build-plan.md sections 3.3 (flows 4 to 7), 4.2 (P4, P5, P9), 5.2 and 5.3, 8 (S4 row), and docs/decisions/ADR-010, ADR-011.

You own: packages/core/src/passes/**. The Compass API is used only through the client generated from contracts/compass-api.openapi.yaml; test against a mock server built from that contract.

Requirements:
1. PassFields builder from a confirmed session and the schedule (boarding closes, walk from previous, next connection), validated by the contract schema (5.3); title truncation; optional attendee name only when the attendee opted in locally.
2. Compass API client: issue (POST /api/v1/passes), download, update (PUT), void, hand-off create, forget_me (DELETE /api/v1/me), all with the ID token from the auth module as bearer, problem+json errors, 429 handling.
3. Issued-pass record in the app-data folder (serial, session code, fields hash, platform), mode 0600.
4. Sync: diff GetSchedule against the issued-pass record (added, changed, cancelled, unchanged) and call issue, update or void. Idempotent: re-running changes nothing.
5. Hand-off: create a hand-off for chosen serials and render its boardUrl as a QR code for the terminal and for chat (text and PNG).
6. .ics export: one event per commitment, two alarms per reserved session (leave now, from the walk; boarding closes), valid RFC 5545.
7. Offline itinerary page: a single HTML file, inline CSS, no JavaScript and no network, readable on a phone, WCAG 2.2 AA. (Cut-list item 1: build it last.)

Tests: snapshot tests for PassFields, .ics and the itinerary page; sync diff cases; an RFC 5545 validator; contract tests against the mock server. 100% coverage.
```

---

## S5: `pass-service` (Engineer 5, from 17 Oct)

```
Create a spec named "pass-service" on branch feature/pass-service.

Read first: docs/architecture/build-plan.md sections 3 (all), 4 (all), 5 (all), 6, 8 (S5 row) and 11.2, docs/decisions/ADR-009 to ADR-013 and ADR-022, and the day-1 SP2, SP3 and SP4 results. Apple: https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes ; Google: https://developers.google.com/wallet/generic/rest/v1/genericobject

You own: packages/pass-service/**. Infrastructure is S6's; you deliver a Lambda bundle and its documented environment variables.

Requirements:
1. Two Lambdas (Node 24, arm64, esbuild, deterministic zip): "api" (issue, download, update, void, hand-off, me, health) and "passkit" (Apple's device web service: register, list updatable, latest pass with If-Modified-Since, unregister, log).
2. Every route matches contracts/compass-api.openapi.yaml exactly; problem+json errors; input never echoed.
3. ID token verification with aws-jwt-verify (signature against JWKS, iss, aud = 7vmom55m1qstvq8i71ph127bfq, token_use = id, exp, RS256 only, JWKS cached by kid), with the fallback in plan 5.4 behind a config switch. Owner match on update, void and download (subHash).
4. Rate limits per subHash (60 pass writes per hour, 10 hand-offs per hour, 80 active passes) in DynamoDB with TTL.
5. Apple: build passes from the fixed server template with passkit-generator (boarding pass style, generic transit type, no barcode, sharingProhibited, the disclaimer "Unofficial. Your badge is your ticket.", expirationDate = endsAt, relevantDates, webServiceURL, authenticationToken of 32 random bytes with only its SHA-256 stored). Bundles of up to 10 passes (.pkpasses). Original artwork only, no AWS branding.
6. Void and update: bump lastUpdated, push over APNs (HTTP/2, the Pass Type ID certificate, empty payload) to every registered device, and patch the Google object (INACTIVE on void). Delete a registration on an APNs invalid-token reply.
7. Google Wallet: generic class and objects, insert, patch, and the "Save to Google Wallet" JWT link; validTimeInterval.end = endsAt.
8. Hand-off: 128-bit id, only its hash stored, 15-minute expiry enforced in code, bundles signed on demand and never stored; same 404 for unknown and expired.
9. DynamoDB single-table access per plan 4.2 (P10 to P13), with expiresAt checked on every read. forget_me voids and deletes everything for the caller.
10. Origin-verify header check; secrets from Secrets Manager cached at runtime; logs carry request id, route template, status, latency and outcome only.

Tests: JWT negative cases (wrong aud, wrong iss, alg none, expired, unknown kid); PassKit 200, 201, 204, 304, 401; hand-off expiry; 429; PassFields rejection (URLs, bidi, control characters, out-of-window dates, oversized); a log-redaction test; contract tests for every route. 100% coverage (lambda-entry adapters excluded).
```

---

## S6: `infra` (Engineer 6, from 17 Oct)

```
Create a spec named "infra" on branch feature/infra.

Read first: .kiro/steering/tech.md (Terraform and deploy, public and private), docs/architecture/build-plan.md sections 6, 7 (all), 8 (S6 row), 11.3 and 13, and docs/decisions/ADR-001, ADR-013, ADR-014, ADR-015, ADR-019, ADR-020, ADR-021.

You own: infra/** (except infra/modules/api/openapi.yaml, an S0-owned copy), scripts/** (not spikes/), docs/runbooks/**.

Requirements:
1. Terraform only, us-east-1, HCP Terraform with a cloud block (organisation and workspace from git-ignored cloud.auto.tfbackend or TF_CLOUD_ORGANIZATION and TF_WORKSPACE; commit the .example). Terraform >= 1.15, < 2.0; AWS provider ~> 6.0; Passembly file conventions (versions.tf, provider.tf with default_tags, validated variables.tf, locals.tf, one file per concern).
2. infra/bootstrap (local execution, owner runs once): the HCP OIDC provider and separate plan and apply roles per environment, trusted only for this organisation, project, workspace and run phase.
3. Modules per plan 7.2: site, edge (CloudFront with the site and /api/* origins, origin-verify header, response headers policy with CSP and HSTS, WAF CLOUDFRONT scope with the listed rules, logging off, API rule sampling off, kill-switch rule), api (REST API imported from openapi.yaml, stage "live" with throttling, access log format using the route template and no IP, binary media types, both Lambdas), data (DynamoDB with TTL, PITR, deletion protection, the two GSIs), secrets (three secret containers; pepper and origin-verify generated, sensitive, never output), observability (SNS topic, alarms on 5xx, throttles, APNs failures and Lambda errors, AWS Budgets at USD 20 with 50, 80 and 100 percent alerts).
4. Retained resources with prevent_destroy (CloudFront distribution, DynamoDB table, secrets, site bucket) and roll-forward notes in docs/runbooks/rollback.md.
5. envs/dev and envs/prod compose the modules; dev comes up by 21 Oct.
6. Owner-run scripts, shellcheck clean: scripts/bootstrap.sh; scripts/release.sh <env> (environment setup, build the Lambda bundle and site, saved plan, refuse any destroy or replace of retained resources or any unexpected resource type, typed yes, apply, site sync, cache invalidation, health check through https://<cf>/api/v1/health); scripts/load-secrets.sh (reads certificate and key files from paths the owner gives, never echoes, puts them into Secrets Manager); scripts/google-wallet-class.mjs (idempotent class set-up).
7. Runbooks: release, rollback, secret loading, Google class, kill switch.

Tests: native terraform test with mock providers asserting prevent_destroy, log retention, tags, no sampled requests on API rules, no IP in the access log format; terraform fmt, validate, tflint and Trivy config clean. Never run terraform apply or any deploy: the owner runs every deploy.
```

---

## S7: `showcase-site` (Engineer 2, after S2)

```
Create a spec named "showcase-site" on branch feature/showcase-site.

Read first: .kiro/steering/product.md (story, metaphor, principles), docs/architecture/build-plan.md sections 4.3 (site row), 5.2 (hand-off routes), 8 (S7 row) and 11.2 (browser matrix and budgets), docs/decisions/ADR-005, ADR-011, ADR-016. Angular prerendering: https://angular.dev/guide/ssr

You own: site/**. The demo uses @compass/core/rules (S2, merged) and the synthetic catalog; the /board page uses the hand-off routes from the contract.

Requirements:
1. Angular 22, zoneless, prerendered to static files (outputMode static). No sign-in, no cookies, no analytics, no third-party requests.
2. Pages: home (the "Seat released at" story and the airline metaphor; Plan, Board, Fly), demo, install (Kiro Power one-click and other MCP clients, plus the npx one-liner), privacy ("what leaves your machine", from plan 4.2 in plain words), /board (the hand-off page), and links to the repo, the Builder Center post and the video.
3. Demo: pick made-up sessions from the synthetic catalog into a small week, see connections and layovers, try to book a clash and watch checkReservation block it with its reasons, take the suggested safe swap, see a sample boarding pass image, download a sample .ics. Works on any phone with no install.
4. /board reads the hand-off id from the URL fragment only (validate base64url, 22 chars), calls the hand-off route, and shows Add to Apple Wallet, Save to Google Wallet and Download calendar; a clear expired message otherwise.
5. WCAG 2.2 AA: contrast at least 4.5:1 at the worst point of any gradient, forced-colors styles, 44 px targets, keyboard and screen reader friendly. Responsive on desktop, iPad and iPhone in both orientations, with a short-viewport test for anything positioned.
6. Budgets: initial JS at most 250 kB compressed, demo chunk at most 150 kB, LCP under 2.5 s on Lighthouse mobile.
7. Original design only: no AWS logos, colours or wording that suggests an official AWS product. A footer line: independent community project, not affiliated with AWS.

Tests: unit 100%; Playwright on the 7 device profiles with axe and forced colors (on demand), tests waiting on app state (focus, heading), never on URLs or sleeps.
```

---

## Day-1 spikes (16 Oct, plan section 10)

| Spike                            | Who                                            | How                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SP1 Kiro hook input and blocking | Engineer 3, in a scratch Kiro workspace        | Prompt: "Build a throwaway Kiro Power with one stdio MCP tool and PreToolUse and PostToolUse command hooks. Record exactly how the hook receives the tool name and input, which exit code or output blocks the call and shows a reason, whether a Power can ship hooks, and whether disabledTools works for a Power's remote server. Write the findings as docs/decisions/ADR-024 (ADR-023 is the Events API OpenAPI source record from S0)." |
| SP2 ID token verification        | Owner runs `spikes/sp2-id-token.mjs` from S0   | Prints claim names only, never values                                                                                                                                                                                                                                                                                                                                                                                                         |
| SP3 PassKit on a real iPhone     | Engineer 5 with the owner's iPhone             | Local Node server on the LAN, a pass signed with the new certificate: register, push, fetch, void, check it moves to Expired. Record a short video for the post.                                                                                                                                                                                                                                                                              |
| SP4 Google Wallet demo mode      | Owner with Engineer 5                          | Issuer and class, owner's Android account as test user, save and patch to INACTIVE. Request publishing access the same day.                                                                                                                                                                                                                                                                                                                   |
| SP5 Real data shape              | Owner runs `spikes/sp5-shape-diff.mjs` from S0 | Field differences only, never values                                                                                                                                                                                                                                                                                                                                                                                                          |
| SP6 Account and cost checks      | Owner                                          | Lambda concurrency, account plan, CloudFront flat-rate subscription in Terraform                                                                                                                                                                                                                                                                                                                                                              |

Spike results change the specs that depend on them. Record each result before S1, S3 and S5 write their designs.

---

## After the build

Claude (with the owner) handles: README (setup, dependencies, how to run), the Builder Center post (outline 18 Oct, drafts 24 and 28 Oct, final 31 Oct), the demo video script, TAM Go/No-Go and CTO sign-off on 29 Oct, the release gate and release on 30 Oct (owner runs every deploy), and submission on 1 Nov.
