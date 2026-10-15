---
inclusion: always
---

# Project structure

```
aws-re_invent-compass/
├── .kiro/
│   ├── steering/              # product.md, tech.md, structure.md (this file)
│   ├── specs/                 # One folder per build spec (created by Kiro)
│   │   ├── events-client/
│   │   ├── itinerary-rules/
│   │   ├── compass-power/
│   │   ├── boarding-passes/
│   │   └── pass-signer-infra/
│   └── hooks/                 # Hooks used while BUILDING this project (lint, test on save)
├── packages/
│   ├── core/                  # @compass/core: API client, auth, cache, rules engine, repo scanner
│   │   ├── src/
│   │   │   ├── auth/          # PKCE sign-in, refresh, revoke, keychain
│   │   │   ├── api/           # Typed client, one file per operation, zod schemas
│   │   │   ├── catalog/       # Pagination, cache, normalization, venue recovery
│   │   │   ├── rules/         # Pure functions: boarding, connections, clashes, layovers, rebooking
│   │   │   ├── scanner/       # Repo to services: terraform, cdk, sdk-js, boto3
│   │   │   ├── spec/          # Week spec generator (requirements, design, tasks markdown)
│   │   │   ├── passes/        # Pass model, signer client, .ics generator, sync diff
│   │   │   └── simulated/     # Fixture-backed transport for simulated mode
│   │   └── test/
│   ├── mcp-server/            # @compass/mcp-server: local stdio MCP server exposing Compass tools
│   │   ├── src/
│   │   └── test/
│   └── pass-signer/           # @compass/pass-signer: Lambda handler, fixed pass template
│       ├── src/
│       ├── template/          # Pass layout, icons (original artwork only, no AWS branding)
│       └── test/
├── power/                     # The distributable Kiro Power (Agent Plugins format)
│   ├── plugin.json
│   ├── mcp.json               # compass (local stdio) + awsevents (official remote)
│   └── skills/
│       ├── plan-my-week/      # SKILL.md: repo scan to week spec workflow
│       ├── first-timer-guide/ # SKILL.md + references/ (sourced from official pages)
│       └── install-hooks/     # SKILL.md + templates for the attendee's .kiro/hooks
├── infra/                     # Terraform only (us-east-1)
│   ├── modules/
│   │   ├── pass-signer/
│   │   └── showcase-site/     # Later: hosting for the showcase website
│   └── envs/prod/             # backend.hcl and terraform.tfvars are git-ignored; .example files are committed
├── site/                      # Later: showcase website source
├── data/
│   └── venues.json            # Curated venues, coordinates, walking-time matrix, with sources
├── fixtures/                  # Scrubbed API responses for tests and simulated mode (no personal data)
│   └── .raw/                  # Git-ignored raw recordings, input to the scrub script
├── docs/
│   ├── article/               # Builder Center post draft and images
│   ├── demo/                  # Demo script and recordings
│   └── decisions/             # Short architecture decision records (ADR-001-*.md)
├── .github/workflows/         # CI (lint, test, gitleaks, terraform checks) and OIDC deploy
├── CONCEPT.md
├── README.md                  # Later: setup, dependencies, how to run (hackathon requirement)
├── CONTRIBUTING.md            # Later: how to contribute, DCO sign-off
├── SECURITY.md                # Later: private vulnerability reporting
├── LICENSE                    # Apache-2.0
└── NOTICE                     # Copyright and attribution for Hennie Francis
```

Private values never go in the tree above. See "Public and private" in tech.md.

## Conventions

- **Files:** kebab-case (`reserve-sessions.ts`). One API operation per file in `api/`.
- **Types:** PascalCase. Zod schemas end in `Schema` (`SessionSchema`); inferred types share the base name (`Session`).
- **Functions:** camelCase verbs (`checkConnection`, `issuePasses`).
- **Domain names follow the airline metaphor** in product.md: `BoardingPass`, `Connection`, `Layover`, `Standby`, `rebook`.
- **MCP tool names:** snake_case, verb first (`scan_repo`, `plan_week`, `check_itinerary`, `reserve_with_guardrails`, `issue_boarding_passes`, `sync_passes`).
- **Tests** sit in each package's `test/` folder and mirror `src/` paths. Name: `<module>.test.ts`.
- **Fixtures:** `fixtures/<operation>/<scenario>.json`, for example `fixtures/reserve-sessions/partial-failure.json`. Strip all personal data before committing.
- **Decisions:** any choice that changes tech.md gets an ADR in `docs/decisions/` and an update to tech.md in the same change.
- **Commits:** Conventional Commits (`feat(core): add pagination`). No em dashes or en dashes anywhere.
- **Dependencies between packages:** `mcp-server` depends on `core`. `pass-signer` does not depend on `core` except for the shared pass schema, which lives in `core/src/passes/schema.ts` and is the single source of truth for pass fields.
