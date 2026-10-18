---
inclusion: always
---

# Technology

The approved build plan is the source of truth: #[[file:docs/architecture/build-plan.md]]. Decisions are in `docs/decisions/` (ADR-001 to ADR-030). If this file and the plan disagree, the plan wins; fix this file in the same change.

## Stack (ADR-006)

| Area                  | Choice                                                                                     | Notes                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Language              | TypeScript 6, `strict` everywhere                                                          | One language across client, MCP server, Lambdas and site                     |
| Runtime               | Node.js 24 LTS                                                                             | Lambda `nodejs24.x` on arm64 (supported until 30 April 2028)                 |
| Package manager       | **npm workspaces**                                                                         | `npm ci` in CI and scripts. Only the integrator changes `package-lock.json`. |
| Lint and format       | **ESLint** (flat config, typescript-eslint, angular-eslint for the site) plus **Prettier** | No Biome                                                                     |
| Unit tests            | **vitest 4**, v8 coverage, **100%** lines, branches, functions and statements              | Named exclusions only (build plan section 11.2)                              |
| Browser tests         | Playwright, site only, 7 device profiles, on demand                                        | No retries; tests wait on app state, never on URLs or sleeps                 |
| Showcase site         | **Angular 22**, zoneless, prerendered static output                                        | Hosted on S3 behind CloudFront                                               |
| MCP server            | `@modelcontextprotocol/sdk`, stdio                                                         | Published to npm as `reinvent-compass` (trusted publishing)                  |
| Validation            | `zod`                                                                                      | Every API response, tool input and Compass API request is parsed             |
| ID token verification | `aws-jwt-verify`                                                                           | Compass API only                                                             |
| Token storage         | OS keychain via `@napi-rs/keyring`; memory-only fallback                                   | Never write tokens to files                                                  |
| Apple passes          | `passkit-generator`                                                                        | Compass API Lambdas only                                                     |
| Calendar              | `ical-generator`                                                                           | Local                                                                        |
| Infrastructure        | **Terraform only**, HCP Terraform (personal org), `>= 1.15, < 2.0`, AWS provider `~> 6.0`  | No CDK, CloudFormation, SAM, console or CLI-made resources                   |

Pin exact versions. S0 installs every planned dependency; a stream that needs a new one asks the integrator. Prefer official SDKs and docs, and cite them.

## AWS Events API facts (official docs, checked 15 October 2026)

- Docs: https://docs.aws.amazon.com/events/latest/devguide/what-is-events-api.html
- REST base URL `https://api.awsevents.com/v1`; event ID `reinvent2026`. Generate types from the official OpenAPI document (S0).
- Remote MCP server `https://api.awsevents.com/mcp` (streamable HTTP); sign-in on every call.
- **12 operations:** ListEvents, GetEvent, ListSessions, GetSession, GetSchedule, ReserveSessions, CancelReservation, AssociateFavorites, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime, DeletePersonalTime.

### Sign-in (OAuth 2.0 authorization code with PKCE)

| Item                       | Value                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Authorize                  | `https://oauth.awsevents.com/oauth2/authorize`                                                                            |
| Token                      | `https://oauth.awsevents.com/oauth2/token`                                                                                |
| Revoke                     | `https://oauth.awsevents.com/oauth2/revoke`                                                                               |
| Logout                     | `https://oauth.awsevents.com/logout`                                                                                      |
| Builder ID sign-out        | `https://idp.awsevents.com/oidc/logout`                                                                                   |
| Client ID (public, shared) | `7vmom55m1qstvq8i71ph127bfq`                                                                                              |
| Scope                      | `openid email events/access`                                                                                              |
| Identity provider          | Always send `identity_provider=AWSBuilderID`                                                                              |
| Redirect URI               | `http://localhost:{8484..8489}/callback`, matched exactly                                                                 |
| Access token               | JWT, 60 minutes, sent only to `api.awsevents.com`                                                                         |
| ID token                   | JWT, kept in the keychain, sent only to the Compass API as proof of sign-in (ADR-009). The Events API does not accept it. |
| Refresh token              | Opaque, 30 days, sent only to the token endpoint                                                                          |

New PKCE verifier and `state` per attempt; S256 challenge, base64url without padding; `code_challenge_method=S256` sent explicitly.

### Official MCP server in the Power (ADR-017)

Used as `awsevents` for read exploration. It is NOT bundled in `power/mcp.json`: SP1 showed that Kiro does not honour `disabledTools` inside a Power (ADR-024), and that a bare tool name hides nothing even in the workspace file. An attendee who wants it adds it to the workspace `.kiro/settings/mcp.json` with the seven write tools in `disabledTools` by their full names, `AWSEventsPublicApi-Mcp-prod___<Operation>` (ReserveSessions, CancelReservation, AssociateFavorites, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime, DeletePersonalTime). Kiro starts no MCP server until Settings, "Kiro Agent: Configure MCP", is Enabled. A folder import of `power/` registers the server `compass` as `power-power-compass`. Kiro config:

```json
{
  "mcpServers": {
    "awsevents": {
      "url": "https://api.awsevents.com/mcp",
      "oauth": {
        "clientId": "7vmom55m1qstvq8i71ph127bfq",
        "redirectUri": "http://127.0.0.1:8976",
        "oauthScopes": ["openid", "email", "events/access"]
      },
      "disabledTools": [
        "AWSEventsPublicApi-Mcp-prod___ReserveSessions",
        "AWSEventsPublicApi-Mcp-prod___CancelReservation",
        "AWSEventsPublicApi-Mcp-prod___AssociateFavorites",
        "AWSEventsPublicApi-Mcp-prod___DisassociateFavorite",
        "AWSEventsPublicApi-Mcp-prod___CreatePersonalTime",
        "AWSEventsPublicApi-Mcp-prod___UpdatePersonalTime",
        "AWSEventsPublicApi-Mcp-prod___DeletePersonalTime"
      ]
    }
  }
}
```

### Behaviour rules

- **Pagination:** stop only when `nextToken` is absent. `includeAbstracts=false` for fast scans.
- **Optional fields:** every session field may be missing. Parse defensively; never invent data.
- **No server-side search:** filter locally over the cached catalog.
- **ReserveSessions:** 1 to 10 distinct IDs; per-session results; a 200 can hold failures; unknown codes are refusals; re-sending is not a safe retry. Confirm every write with `GetSchedule`.
- **Quotas per attendee per minute:** GetSession 120, ListSessions 120, GetSchedule 60, ReserveSessions 30 sessions, AssociateFavorites 30 sessions, other writes 30. On 429 wait `Retry-After`.
- **Event window and timezone** come from `GetEvent`; reservability from session data. Never hard-code them.

## re:Invent rules Compass enforces (official FAQ)

- A reserved seat is released to walk-ups if the attendee is not in the room 10 minutes before start.
- Reservable types: bootcamps, technical sessions, chalk talks, code talks, exam prep, gamified learning, select labs, workshops. Keynotes and lecture-style breakouts need no reservation.
- No two reservations at the same time. Favoriting is not reserving. Reserved seats cannot be transferred. Repeats carry `-R`.

## Compass API (ADR-008 to ADR-013)

- **Contract first:** `contracts/compass-api.openapi.yaml` (OpenAPI 3.0.1) is the single source. Byte-identical copies in `infra/modules/api/openapi.yaml` and `packages/contracts/openapi.yaml`, checked by SHA-256 in CI. TypeScript types are generated from it.
- **Routes and shapes:** build plan section 5.2. **PassFields rules:** section 5.3, defined once in `packages/contracts/src/pass-fields.ts`.
- **Edge:** one CloudFront distribution: site at `/`, API at `/api/*` (API Gateway REST, regional, imported from the OpenAPI file, request validation). WAF (CLOUDFRONT scope) on the distribution. An origin-verify header shields the `execute-api` URL.
- **Auth:** attendee routes need a Builder ID ID token verified for signature, `iss`, `aud = 7vmom55m1qstvq8i71ph127bfq`, `token_use = id`, `exp`, RS256 only. Hand-off routes use a 128-bit capability in the URL fragment. PassKit routes use `ApplePass <authenticationToken>` per Apple's spec.
- **Pass lifecycle:** Apple PassKit web service plus APNs pushes with the Pass Type ID certificate (empty payload); void sets `voided: true` and `expirationDate: now`. Google objects patched to `INACTIVE`. Every pass expires at session end.
- **Data:** DynamoDB single table, on demand, TTL for clean-up only (code checks `expiresAt` on every read), deletion protection, and no point-in-time recovery (owner decision 2026-10-17, ADR-015, so forget_me is a real erasure). Identifiers are opaque: UUID v4 serials; `subHash` and `deviceHash` are HMAC-SHA256 with a pepper from Secrets Manager. Full field list: plan section 4.2.
- **Logging:** request id, route template, status, latency and outcome only. Never paths with identifiers, headers, bodies, tokens or emails. 14-day retention.

## Terraform and deploy (ADR-001, ADR-014, ADR-015, ADR-020)

- HCP Terraform in the owner's **personal organisation**: workspaces `reinvent-compass-bootstrap` (local execution, run once by the owner), `reinvent-compass-dev` and `reinvent-compass-prod` (remote, CLI-driven), with **HCP dynamic provider credentials**. No AWS keys anywhere and no GitHub deploy role.
- Region `us-east-1` for everything.
- Passembly file conventions: `versions.tf`, `provider.tf` with `default_tags`, validated `variables.tf`, `locals.tf`, one file per concern, `tests/*.tftest.hcl` with mock providers. Checks: `terraform fmt`, `validate`, `tflint`, `terraform test`, Trivy config scan.
- Retained resources with `prevent_destroy` and roll-forward notes: the CloudFront distribution, the DynamoDB table, the four secrets (apple-pass, google-wallet, app, origin-verify) and the site bucket.
- **The owner runs every deploy** with `scripts/release.sh <env>` (shellchecked): build, saved plan, refuse destroy or replace of retained resources and unexpected resource types, typed `yes`, apply, site sync and invalidation, health check. Dev is deployed before prod.

## CI (ADR-018)

- `check.yml`: one job on `pull_request` into `main` only, the required check, under 8 minutes (full list in plan section 11.1).
- `e2e.yml`: `workflow_dispatch` only. `publish.yml`: tag `v*` only, npm trusted publishing with provenance.
- No push triggers, no cron, no deploy workflow. Actions pinned by SHA. Dependabot monthly, paused until after 1 November.

## Public and private

The repository is public. Only security-sensitive and account-specific material stays private.

| Public (commit it)                                                                             | Private (never commit)                                                                                                        | Where it lives                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All code, tests, steering, specs, hooks, docs, ADRs                                            | Apple Pass Type ID certificate and key, WWDR certificate                                                                      | AWS Secrets Manager, loaded by the owner with `scripts/load-secrets.sh`                                                                                                                                         |
| Terraform modules, envs, tests                                                                 | Google Wallet service account key and issuer ID                                                                               | AWS Secrets Manager                                                                                                                                                                                             |
| `*.example` files (`terraform.tfvars.example`, `cloud.auto.tfbackend.example`, `.env.example`) | Real `terraform.tfvars`, `cloud.auto.tfbackend`, `.env`, HCP organisation and workspace settings, AWS account ID, alert email | Local git-ignored files and HCP workspace variables                                                                                                                                                             |
| Synthetic catalog in `fixtures/synthetic/`                                                     | Real API recordings                                                                                                           | `fixtures/.raw/`, git-ignored                                                                                                                                                                                   |
| The CloudFront domain (attendees need it)                                                      | HMAC pepper, origin-verify value                                                                                              | Generated locally by the owner script `scripts/load-secrets.sh`, never by Terraform (ADR-012). The origin-verify value and the API key also sit in the CloudFront origin headers and HCP state (ADR-027 item 2) |

Never read, print or paste a secret value. Repository protections: secret scanning with push protection, CodeQL default setup, branch protection on `main`, private vulnerability reporting.

## Testing rules

- 100% unit coverage; named exclusions only.
- Fixture tests for all 12 operations, including partial failures, 429 with `Retry-After`, multi-page catalogs, unknown codes and expired tokens.
- Contract tests: Compass API responses validated against the OpenAPI file.
- Security tests: tokens and emails never reach logs or errors; JWT negative cases; PassKit authorisation; hand-off expiry; PassFields rejection cases. Ambiguous input is refused, never reinterpreted.
- Live tests only with `COMPASS_LIVE_TESTS=1`, run by the owner locally. CI never calls the live API.

## Day-1 spikes that may change this file (plan section 10)

SP1 Kiro hook input and blocking, SP2 ID token verification, SP3 PassKit on a real iPhone, SP4 Google Wallet demo mode, SP5 real data shape against the synthetic catalog, SP6 account and cost checks. Record each result in an ADR or this file.
