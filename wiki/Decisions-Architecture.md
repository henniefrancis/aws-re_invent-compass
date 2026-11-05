_For architects: why the contracts, the pass API, the hand-off and the edge are built the way they are, and how every booking stays behind the guardrail._

Each section is one decision with four parts: the context, the decision, why, and the trade-off. Where a later decision or the code changed it, the section says so. The [Key decisions](Key-Decisions) page lists every decision on every theme.

## One OpenAPI contract copied byte for byte

**Context:** The [Compass API](Glossary#compass-api) was written, deployed and called by three streams working at the same time. [API Gateway](Glossary#api-gateway) REST can import an [OpenAPI](Glossary#openapi) file and validate requests against it. Every stream needed the same types on day one.

**Decision:**

- One source: [contracts/compass-api.openapi.yaml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/contracts/compass-api.openapi.yaml), OpenAPI 3.0.1, holding the `x-amazon-apigateway-*` extensions.
- Two byte-identical copies: [infra/modules/api/openapi.yaml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/api/openapi.yaml), which Terraform gives API Gateway as the API body, and [packages/contracts/openapi.yaml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/contracts/openapi.yaml), from which `openapi-typescript` generates the TypeScript types. The CI hash check (`npm run check:hash`) fails on any difference.
- The MCP tool schemas live in [packages/contracts/src/mcp-tools.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/contracts/src/mcp-tools.ts) and the printable pass fields in [packages/contracts/src/pass-fields.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/contracts/src/pass-fields.ts) (zod).
- Errors use `application/problem+json` with `type`, `title`, `status` and `code`.

**Why:** Every stream builds against one shape, and API Gateway turns away a malformed request before any Lambda runs.

**Trade-off:** After the lock, any contract change needs a change request that every stream rebases onto. The file stays on OpenAPI 3.0.1 because API Gateway REST import supports 3.0, not 3.1.

**Today:** The contract has 16 operations: 11 attendee routes under `/api/v1` and the 5 Apple [PassKit](Glossary#passkit) web service routes under `/api/passkit/v1`. See [Pass API](Pass-API).

## The Events API contract pinned in the repository

**Context:** Every stream generates its [Events API](Glossary#events-api) types from the official document. CI never calls the live API, so the document has to live in the repository.

**Decision:** The official document from `https://api.awsevents.com/v1/openapi.json` is committed as [packages/contracts/events-api.openapi.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/contracts/events-api.openapi.json), with its provenance recorded: source URL, retrieval date, OpenAPI 3.1.0, title "AWS Events API" version 1.0.0, size and SHA-256. Only an operator refresh with [packages/contracts/scripts/fetch-events-api.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/contracts/scripts/fetch-events-api.mjs) changes it, and a unit test checks that the recorded SHA-256 equals the hash of the committed file.

**Why:** One accurate shape for all 12 Events API operations, and any drift shows up as a failing test.

**Trade-off:** The copy can go stale between refreshes, so someone has to re-check it by hand. It was last refreshed on 31 October 2026 (first retrieved 15 October), when AWS changed three personal time descriptions: personal time is wall-clock time in the event's own time zone, and a block must end on the same date it starts. The committed file is 100,728 bytes with SHA-256 `2688566112c6205379fe15011e72512c5f0ff5c575b4c1e608e932eb5bb03f94`.

## An attendee-only pass API

**Context:** Passes must be signed on a server, and only attendees should be able to use the signer. Compass must not send the Events API access token to its own server. [AWS Builder ID](Glossary#aws-builder-id) sign-up is free, so any holder could try to abuse the signer.

**Decision:**

- Compass sends the Builder ID ID token as a bearer token. The access token never leaves the attendee's machine.
- The pass service verifies the token with `aws-jwt-verify`: RS256 only (checked before any key lookup), signature against the issuer's public key set, issuer, audience (the Builder ID client id), `token_use` of `id`, and expiry with no grace period. The issuer is a Cognito user pool, so the service uses `CognitoJwtVerifier`.
- The token is never logged or stored. Only a keyed hash of its `sub` claim is kept (see [Personal data on the server](Decisions-Security-and-Privacy#personal-data-on-the-server)).
- Per caller: 60 pass writes an hour, 10 hand-offs an hour and at most 80 active passes ([packages/pass-service/src/data/rate-limiter.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/data/rate-limiter.ts)). Update, void and download check that the pass belongs to the caller.

**Why:** It reuses the sign-in attendees already have, adds no account, and keeps the one token that can change a schedule on the attendee's machine.

**Trade-off:** Any Builder ID holder can call the API, so it needs abuse controls: [WAF](Glossary#waf) rate rules, API Gateway throttling, the per-caller limits, a kill switch and a budget alarm. A fallback with unauthenticated issuance and per-pass manage tokens was prepared but not needed: the day-one ID token spike passed on 18 October 2026.

## Cloud hand-off to the phone

**Context:** Passes are made on the computer but needed on the phone. Amazon S3 lifecycle rules work in days, which is far too coarse for a 15-minute link.

**Decision:**

- `POST /api/v1/handoffs`, with the ID token, takes 1 to 80 pass serials and returns a hand-off id, a board URL and an expiry. Compass shows the QR code in the terminal and the chat.
- The hand-off id is 16 random bytes, base64url (22 characters). It sits in the URL fragment (`/board#h=...`), which the browser never sends to the server, and only its SHA-256 is stored.
- The static `/board` page checks the fragment and calls `GET /api/v1/handoffs/{handoffId}`.
- A [hand-off](Glossary#hand-off) expires after 15 minutes, enforced in code. DynamoDB [TTL](Glossary#ttl) only cleans up. Unknown and expired ids get the same 404.
- Apple gets `.pkpasses` bundles of up to 10 passes, signed on demand from the pass record. Google gets a save link. Nothing is stored as a file.
- At most 10 hand-offs an hour per caller, a read limit per hand-off, a WAF rate rule and a strict content security policy on `/board`.

**Why:** Scanning a QR code is the smoothest way from computer to phone, with no account on the phone. The fragment and the stored hash keep the link out of logs and out of the table.

**Trade-off:** The pass service holds short-lived state, and the link works for anyone who has it for 15 minutes. No S3 bucket and no presigned URLs.

**Today:** The calendar file is also served through the hand-off (`GET /api/v1/handoffs/{handoffId}/calendar.ics`). A route for one Apple pass was added for the per-session buttons (see [Board page buttons](Decisions-Passes-and-Wallets#board-page-buttons-at-the-top-or-on-each-session)), and the read limit is 30 plus 2 for each pass in the hand-off.

## API Gateway REST behind CloudFront

**Context:** The site and the Compass API need one public address, protection and request validation at low cost. Apple Wallet's registration call cannot send the `x-amz-content-sha256` header, which rules out a Lambda function URL behind CloudFront origin access control.

**Decision:**

- One [CloudFront](Glossary#cloudfront) distribution. `/` goes to the private S3 site bucket through origin access control. `/api/*` goes to the API Gateway stage `live`.
- API Gateway REST (regional), imported from the OpenAPI file, with request validation, stage and route throttling, binary media types for passes, and access logs that hold the route template and no IP address.
- Caching off for `/api/*`.
- WAF on the distribution: per-IP rate rules, the AWS managed common, known bad inputs and IP reputation rule groups, and a [kill switch](Kill-Switch) rule. WAF logging and request sampling are off.
- CloudFront adds an `x-origin-verify` header, and the Lambdas refuse a request without it.
- Response headers: content security policy, HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer` and `Permissions-Policy`.

**Why:** REST, not HTTP API, because HTTP API has no request validation. One WAF at the edge, not a second regional WAF on API Gateway, because of cost.

**Trade-off:** WAF is most of the monthly bill. The regional `execute-api` address still answers direct calls, which skip WAF.

**Later:**

- A custom domain replaced the CloudFront default address: see [A custom domain for the site and the API](Decisions-Infrastructure#a-custom-domain-for-the-site-and-the-api).
- An API key enforced at API Gateway now rejects direct calls: see [API key enforced at API Gateway](Decisions-Security-and-Privacy#api-key-enforced-at-api-gateway).
- The CloudFront flat-rate Free plan was not adopted, so WAF stays on pay-as-you-go: see [CloudFront flat-rate Free plan](Decisions-Infrastructure#cloudfront-flat-rate-free-plan).

**Today:** The web ACL in [infra/modules/edge/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/edge/main.tf) has 8 rules: three per-IP rate rules over 5 minutes (API 600, PassKit 300, site 3,000), the three managed rule groups, the kill switch, and a 64 KB body size limit on `/api/*`. The prod stage throttle is 50 requests a second with a burst of 100, with tighter limits on the routes that write. The distribution serves HTTP/2 and HTTP/3. See [AWS architecture](AWS-Architecture).

## All bookings go through the Compass guardrail

**Context:** AWS publishes an official `awsevents` remote MCP server that can also write to the attendee's schedule. An agent that books through it skips the Compass [guardrail](Glossary#guardrail). Prompt injection through session abstracts or repository files could lead to bookings nobody wanted.

**Decision:**

- All writes go through Compass tools (`reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby` and `add_layover`), which run the guardrail check inside the server.
- Write tools are never auto-approved: a human approves each call.
- The Kiro PreToolUse [hook](Glossary#kiro-hook) runs the same check first, as defence in depth. The hook is a convenience, not the control.
- The `awsevents` server is for reading only. Its write tools are disabled, and a hook blocks them as a backup.

**Why:** One place enforces the rules, whatever the client or the agent does.

**Trade-off:** An attendee who adds the `awsevents` server must disable its writes themselves, and Compass cannot force a client to ask before a write.

**Later:** The first plan bundled `awsevents` in the Power, with its write tools in `disabledTools`. The Kiro hook spike showed that Kiro does not honour `disabledTools` inside a Power, so the remote `awsevents` server is not bundled: [power/mcp.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/mcp.json) lists only the Compass server. An attendee who wants `awsevents` adds it to the workspace `.kiro/settings/mcp.json` with the seven write tools in `disabledTools` by their full names. See [Kiro hooks block only with exit 2](#kiro-hooks-block-only-with-exit-2).

**Today:** In live mode the schedule tools change nothing unless the attendee sets `COMPASS_ALLOW_WRITES=1` (see [Read-only by default](Read-Only-By-Default)). The Power ships no auto-approve list, and only `refresh_catalog` and `find_sessions` may be auto-approved (`check_itinerary` left that list in 0.1.3, when it began listing the whole schedule) ([power/POWER.md](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/POWER.md)).

## Kiro hooks block only with exit 2

**Context:** The hook design rested on assumptions taken from the [Kiro](Glossary#kiro) documentation. On 18 October 2026 the owner ran the Kiro hook spike in Kiro IDE 1.3.11 on Windows, with a toy Power, logging hooks and the official `awsevents` server. It found:

- Only exit code 2 blocks a PreToolUse call, and the agent then sees the hook's stderr. Exit 1 does not block. Output from a hook that exits 0 never reaches the agent. PostToolUse cannot block.
- Kiro routes every call to a Power's tools through one built-in tool, `kiro_powers`, with the real tool name and arguments inside `tool_input`.
- Tools of a server in the workspace settings arrive lower-cased, as `mcp_<server>_<tool>`, and regular expression matchers are compared case-sensitively against that lower-cased id.
- A Power cannot ship hooks.
- Kiro does not honour `disabledTools` inside a Power, and a re-import can skip an `awsevents` entry with `oauth` as invalid.
- Kiro starts no MCP server until "Kiro Agent: Configure MCP" is enabled.

**Decision:**

1. A block exits 2, everything else exits 0 ([packages/mcp-server/src/hooks/exit-policy.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/hooks/exit-policy.ts)). The in-server guardrail stays the control.
2. The guardrail hook unwraps `kiro_powers`: it acts only on a `use` call to the Compass server and reads the tool and its arguments from `tool_input` ([packages/mcp-server/src/hooks/hook-input.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/hooks/hook-input.ts)).
3. The template's matchers are the forms that fire: `kiro_powers` for Compass, and a lower-case suffix pattern for the seven `awsevents` write tools ([power/hook-templates/reinvent-compass.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/hook-templates/reinvent-compass.json)).
4. Hooks carry no warnings or reminders. The PostToolUse sync hook was removed from the template, and the reminder to run `sync_passes` comes from the Compass tool results.
5. The Power ships no hooks. The `install-hooks` skill copies the template into the workspace `.kiro/hooks/` after the human approves.
6. `awsevents` stays out of the Power. The README and [power/skills/install-hooks/SKILL.md](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/skills/install-hooks/SKILL.md) tell the attendee to add it to the workspace settings with the seven write tools listed by their full `AWSEventsPublicApi-Mcp-prod___<Operation>` names.
7. The README tells Kiro users to enable MCP before importing the Power.

**Why:** The hooks are built on what Kiro was seen to do, not on what the documentation suggested. Without the unwrap, the shipped hook would have seen only `kiro_powers` and let every Compass write past the hook unchecked (the server would still check it).

**Trade-off:** Hooks need a separate install step and work in Kiro only. They add nothing a non-Kiro client can rely on, which is why the server check is the control.

**Today:** The hook also unwraps a `kiro_powers` call to an `awsevents` server inside a Power. The command line still accepts `hook post-write-sync`, but the template no longer calls it. The spike's last step, importing the Power from GitHub, has no recorded result; the README tells attendees to import it from the repository URL. See [Steering and hooks](Steering-and-Hooks).

## Related pages

- [Key decisions](Key-Decisions)
- [Architecture overview](Architecture-Overview)
- [Contracts](Contracts)
- [Pass API](Pass-API)
- [Kiro Power](Kiro-Power)
