---
inclusion: always
---

# Technology

## Stack

| Area | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict mode) everywhere | One language across the client, MCP server and Lambda |
| Runtime | Node.js 24 LTS | Lambda runtime `nodejs24.x`. Confirm availability in the target region during design. |
| Package manager | pnpm workspaces | Monorepo; see structure.md |
| MCP server | `@modelcontextprotocol/sdk` (official TypeScript SDK), stdio transport | Local server bundled in the Kiro Power |
| Validation | `zod` | Every API response and every tool input is parsed, never trusted |
| Tests | `vitest` | Unit tests plus fixture-based integration tests |
| Lint and format | Biome | One tool, no ESLint/Prettier split |
| Token storage | OS keychain via `@napi-rs/keyring` | Never write tokens to plain files |
| Apple Wallet | `passkit-generator` | Runs only in the signer Lambda |
| Google Wallet | Signed JWT "Save to Google Wallet" link | Runs only in the signer Lambda |
| Calendar fallback | `ical-generator` | Runs locally, no keys needed |
| Infrastructure | **Terraform only** (AWS provider, current major) | No CDK, CloudFormation, SAM, console or CLI-created resources. No exceptions. |

Pin exact dependency versions. Before adding a dependency, confirm it is actively maintained and check its latest version on the official registry. Prefer official SDKs and documentation as sources.

## AWS Events API facts (official docs, checked 15 October 2026)

- Docs: https://docs.aws.amazon.com/events/latest/devguide/what-is-events-api.html
- REST base URL: `https://api.awsevents.com/v1`. Event ID: `reinvent2026`.
- Remote MCP server: `https://api.awsevents.com/mcp` (streamable HTTP). Requires sign-in on every call, including catalog reads.
- **12 operations:** ListEvents, GetEvent, ListSessions, GetSession, GetSchedule, ReserveSessions, CancelReservation, AssociateFavorites, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime, DeletePersonalTime.

### Sign-in (OAuth 2.0 authorization code with PKCE)

| Item | Value |
|---|---|
| Authorize | `https://oauth.awsevents.com/oauth2/authorize` |
| Token | `https://oauth.awsevents.com/oauth2/token` |
| Revoke | `https://oauth.awsevents.com/oauth2/revoke` |
| Logout | `https://oauth.awsevents.com/logout` |
| Builder ID sign-out | `https://idp.awsevents.com/oidc/logout` |
| Client ID (public, shared) | `7vmom55m1qstvq8i71ph127bfq` |
| Scope | `openid email events/access` |
| Identity provider | Always send `identity_provider=AWSBuilderID` |
| Redirect URI | `http://localhost:{8484..8489}/callback`, matched exactly. Any other port fails. |
| Access token | JWT, 60 minutes. The only token sent to the API. |
| Refresh token | Opaque, 30 days, used only at the token endpoint |

- New PKCE verifier (43 to 128 chars, cryptographically random) and new `state` for every attempt. Challenge is SHA-256, base64url, no padding. Send `code_challenge_method=S256` explicitly.
- The ID token is not accepted by the API.
- There is no hosted redirect URI. The app must run on the attendee's machine.

### Kiro MCP config for the official server (from the docs)

```json
{
  "mcpServers": {
    "awsevents": {
      "url": "https://api.awsevents.com/mcp",
      "oauth": {
        "clientId": "7vmom55m1qstvq8i71ph127bfq",
        "redirectUri": "http://127.0.0.1:8976",
        "oauthScopes": ["openid", "email", "events/access"]
      }
    }
  }
}
```

End `redirectUri` at the port. Kiro adds `/oauth/callback` itself.

### Behaviour rules

- **Pagination:** stop only when `nextToken` is absent. Short pages do not mean the last page. Use `includeAbstracts=false` for fast scans.
- **Optional fields:** any session field can be missing. Parse defensively. Never invent missing data.
- **Search:** the API has no search or filter. Filter locally over the cached catalog.
- **ReserveSessions:** 1 to 10 distinct IDs per request. Results are per session. A 200 can contain failures (full, clash, already reserved). Unknown failure codes are refusals. Re-sending is **not** a safe retry because "already reserved" counts as a failure. After any write, call `GetSchedule` to confirm.
- **GetSchedule** is the source of truth and returns IDs the write operations do not.
- **Quotas (per attendee, per minute):** GetSession 120, ListSessions 120, GetSchedule 60, ReserveSessions 30 sessions, AssociateFavorites 30 sessions, all other writes 30. On 429, wait `Retry-After` seconds. A refused request spends no quota.
- **Reported by other participants (verify against the OpenAPI spec before relying on it):** ListSessions returns `items`; GetSession wraps its result in `session`; timing is `sessionTime: { date, time, length, timezone }`; venue is empty for many sessions and can often be recovered from the room text.

## re:Invent rules Compass enforces (official FAQ)

- Reserved seat released to walk-ups if the attendee is not in the room **10 minutes before start**.
- Reservable types: bootcamps, technical sessions, chalk talks, code talks, exam prep, gamified learning, select labs, workshops. Keynotes and lecture-style breakouts need no reservation.
- No two reservations at the same time. Favoriting is not reserving. Reserved seats cannot be transferred.
- Repeats carry `-R` in the session ID.

## Architecture rules

1. `packages/core` has no I/O side effects outside the API client and cache modules. The rules engine is pure functions and fully unit tested.
2. All writes go through one module that: validates input, runs the guardrail rules, sends the request, parses per-session results, then confirms with `GetSchedule`.
3. Every module that calls the API must work in **simulated mode** against recorded fixtures. Simulated mode is selected by config, never by code changes.
4. The MCP server exposes small, well-described tools with zod input schemas. Write tools must state in their description that they change the attendee's real schedule.
5. The pass signer is stateless. It receives only pass fields, builds the pass from a fixed server-side template, and returns it. It never receives tokens, code or schedule data beyond what is printed.

## Security rules

- Never log tokens, authorization headers, or full API responses containing personal data.
- Tokens live in the OS keychain only. Sign-out revokes the refresh token, clears the keychain and offers the Builder ID sign-out link.
- Loopback callback server binds to `127.0.0.1`, accepts one request, validates `state`, then shuts down.
- Signer: API Gateway **REST** API (regional; AWS WAF cannot attach to HTTP APIs) with throttling, AWS WAF rate-based rule and managed rule groups, strict zod validation with maximum field lengths, fixed disclaimer text, no client-supplied images or URLs, least-privilege IAM, signing material in AWS Secrets Manager resolved at runtime and never committed.
- No secrets in the repo, in Terraform state outputs, or in environment variable defaults. Run gitleaks in a pre-commit hook and in CI.

## Accounts and deployment

- AWS: Hennie's personal account, region **`us-east-1`** for everything.
- Deploys run from GitHub Actions using an IAM role assumed through **GitHub OIDC**, trusted only for this repository's `main` branch. No long-lived AWS access keys anywhere.
- Terraform state: S3 backend with native locking, in the same account and region.

## Public and private

The repository is public (Apache-2.0). Only security-sensitive material stays private.

| Public (commit it) | Private (never commit) | Where the private item lives |
|---|---|---|
| All source code, tests, Kiro steering, specs and hooks | Apple Pass Type ID certificate and key, Apple WWDR certificate | AWS Secrets Manager |
| Terraform modules and environment code | Google Wallet service account key and issuer ID | AWS Secrets Manager |
| `*.example` templates (`backend.hcl.example`, `terraform.tfvars.example`, `.env.example`) | Real `backend.hcl`, `terraform.tfvars`, `.env`, AWS account ID, state bucket name | Local git-ignored files; GitHub Actions variables and secrets |
| Scrubbed fixtures in `fixtures/` | Raw recorded API responses (may contain personal data) | `fixtures/.raw/`, git-ignored; a scrub script produces the committed fixtures |
| The signer's public endpoint URL (attendees need it) | Deploy role ARN | GitHub Actions variable |
| Docs, article drafts, website source | Terraform state and plan files | S3 state bucket only |

Repository protections: GitHub secret scanning with push protection, Dependabot, CodeQL, branch protection on `main`, private vulnerability reporting enabled with a `SECURITY.md`.

## Testing rules

- Unit tests for every rule in the rules engine, including edge cases (midnight, all-day sessions, missing venue, missing end time).
- Fixture-based tests for every API operation, including partial failures, 429 with `Retry-After`, multi-page catalogs and unknown failure codes.
- Live smoke tests only behind `COMPASS_LIVE_TESTS=1`. CI never calls the live API.

## Things to verify during design (do not assume)

- Exact Apple Wallet pass fields for lock-screen relevance in current iOS (relevant dates, locations, boarding pass style with a generic transit type).
- Whether personal time created through the API appears in the official AWS Events app.
- Exact Kiro hook JSON schema and the tool-matcher syntax for MCP tools (`@mcp`, `@<server>`).
- Lambda Node.js runtime availability.
