# ADR-020 Dev environment before prod

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

The pass service needs real-device checks (iPhone, Android) and a live end-to-end run before release. Production must not be the first place the stack runs. The dev environment roughly doubles the monthly cost while it exists.

## Decision

- A `reinvent-compass-dev` workspace and `infra/envs/dev` deploy the same modules as prod.
- 21 Oct: first dev deploy (S6 slice: edge, API stub, data). The owner runs `bootstrap.sh`, then `release.sh dev`.
- 25 Oct: pass service on dev; real-device conformance.
- 26 to 27 Oct: integration on `develop`, with simulated E2E plus live E2E on dev using the owner's Builder ID.
- 30 Oct: release gate, then `release.sh prod` (backend, then site).
- The dev environment is **destroyed after submission** (1 Nov).

## Consequences

- Dev adds about the same as prod (about USD 12 to 13 a month) until it is destroyed.
- S6 acceptance includes "dev deploys from scratch".

## Source

- re:Invent Compass build plan sections 6, 7.1, 7.4, 8 (S6), 9.3.
