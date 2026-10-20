---
inclusion: always
---

# Project structure

Layout and ownership follow the approved build plan (section 9.1, ADR-007). Each folder below has **one owning stream**; a stream never edits another stream's files (see workflow.md).

```
aws-re_invent-compass/
├── .kiro/
│   ├── steering/                 # S0: product, tech, structure, workflow
│   ├── specs/                    # One folder per Kiro spec, committed (proof of spec-driven work)
│   └── hooks/                    # S0: hooks used while building this repo (lint, test on save)
├── contracts/
│   └── compass-api.openapi.yaml  # S0: the single source for the Compass API (OpenAPI 3.0.1)
├── packages/
│   ├── contracts/                # S0: @compass/contracts
│   │   ├── openapi.yaml          #   byte-identical copy (hash-checked)
│   │   └── src/                  #   Session, Schedule, Commitment, Venue, Verdict, PassFields,
│   │                             #   error types, MCP tool schemas, generated Events and Compass API types
│   ├── core/                     # @compass/core, subpath exports (no shared barrel file)
│   │   └── src/
│   │       ├── auth/             # S1: PKCE sign-in, refresh, revoke, keychain with memory fallback
│   │       ├── api/              # S1: one file per Events API operation
│   │       ├── catalog/          # S1: pagination, cache, normalisation, venue recovery
│   │       ├── simulated/        # S1: fixture-backed transport (COMPASS_MODE=simulated)
│   │       ├── rules/            # S2: pure, browser-safe rules engine (also used by the site)
│   │       ├── scanner/          # S3: repo to services (terraform, cdk-ts, sdk-js-v3, boto3)
│   │       ├── spec/             # S3: week spec generator
│   │       └── passes/           # S4: PassFields builder, Compass API client, sync, .ics, itinerary HTML, QR
│   ├── mcp-server/               # S3: local stdio MCP server and CLI, published as `reinvent-compass`
│   └── pass-service/             # S5: Compass API Lambdas (api, passkit), original pass artwork
├── power/                        # S3: the Kiro Power (Agent Plugins format)
│   ├── plugin.json
│   ├── mcp.json                  #   compass (local stdio); awsevents is added only after SP1 (ADR-024)
│   ├── skills/                   #   plan-my-week, first-timer-guide, install-hooks
│   └── hook-templates/           #   PreToolUse guardrail (copied into the attendee's .kiro/hooks); the PostToolUse sync hook was removed (ADR-024)
├── site/                         # S7: Angular 22 showcase site (story, demo, install, privacy, /board)
├── infra/                        # S6: Terraform only (us-east-1, HCP Terraform)
│   ├── bootstrap/                #   HCP OIDC provider and plan/apply roles (owner runs once)
│   ├── modules/                  #   site, edge, api (openapi.yaml copy owned by S0), data, secrets, observability
│   └── envs/{dev,prod}/          #   cloud.auto.tfbackend and terraform.tfvars are git-ignored; .example committed
├── spikes/                       # S0: day-1 spike scripts (owner-run, print no secret values)
├── scripts/                      # S6: release.sh, bootstrap.sh, load-secrets.sh, google-wallet-class.mjs (owner-run)
├── data/
│   └── venues.json               # S2: venues, coordinates, walking-time matrix, a source note per value
├── fixtures/
│   ├── synthetic/                # S0: made-up catalog in the real data shape (public)
│   ├── api/                      # S1: scrubbed per-operation fixtures built on the synthetic catalog
│   ├── sample-repo/              # S3: sample project for the scanner and the demo
│   └── .raw/                     # git-ignored: the owner's real recordings (SP5)
├── docs/
│   ├── architecture/             # build-plan.md (mirror of the approved plan)
│   ├── decisions/                # ADR-001 onwards
│   ├── runbooks/                 # S6: release, rollback, secrets, Google class, kill switch
│   ├── article/                  # Claude: Builder Center post drafts and screenshots
│   └── demo/                     # Claude and owner: video script
├── .github/                      # S0: check.yml, e2e.yml, publish.yml, dependabot.yml
├── CONCEPT.md, README.md, CONTRIBUTING.md, SECURITY.md, LICENSE, NOTICE
└── package.json, package-lock.json   # S0; after day 1 only the integrator changes them
```

## Conventions

- **Files:** kebab-case (`reserve-sessions.ts`). One Events API operation per file in `core/src/api/`.
- **Types:** PascalCase. Zod schemas end in `Schema` (`SessionSchema`); inferred types share the base name (`Session`). Shared types live only in `@compass/contracts`.
- **Functions:** camelCase verbs (`checkConnection`, `issuePasses`).
- **Domain names follow the airline metaphor** (product.md): `BoardingPass`, `Connection`, `Layover`, `Standby`, `rebook`, `voidPass`.
- **MCP tools:** snake_case, verb first (full list in plan section 8.1).
- **Imports:** packages import each other only through declared subpath exports (`@compass/core/rules`), never deep relative paths across packages.
- **Tests:** in each package's `test/` folder, mirroring `src/`, named `<module>.test.ts`.
- **Fixtures:** `fixtures/api/<operation>/<scenario>.json`, for example `fixtures/api/reserve-sessions/partial-failure.json`. Never commit real recordings.
- **Decisions:** a choice that changes steering gets an ADR in `docs/decisions/` and a steering update in the same change.
- **Commits:** Conventional Commits with the spec as scope (`feat(events-client): add pagination`). No em dashes or en dashes anywhere.
