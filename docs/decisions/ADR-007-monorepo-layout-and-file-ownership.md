# ADR-007 Monorepo layout and file ownership

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

Up to 6 Kiro sessions build eight specs (S0 to S7) at the same time. Merge conflicts between sessions are a named risk (R5). The old Spec 5 `pass-signer-infra` mixed Lambda code and Terraform, so two engineers could not work on it at once.

## Decision

- Layout: `packages/contracts`, `packages/core`, `packages/mcp-server` (published as `reinvent-compass`), `packages/pass-service`, `contracts/`, `power/`, `site/`, `infra/`, `scripts/`, `data/venues.json`, `fixtures/`.
- `packages/core` uses subpath exports (`@compass/core/*`). The `rules` subpath is browser-safe, so the site demo can use it. No shared barrel file.
- `packages/pass-signer` is renamed `packages/pass-service`. Old Spec 5 is split into S5 (code) and S6 (Terraform).
- One Kiro spec per stream, one `feature/<spec>` branch each. Each Kiro session works in its own git worktree.
- File ownership: no two streams edit the same file (ownership table in plan section 9.1). S0 owns root configs, workspaces, `packages/contracts/**`, `contracts/**`, `.github/**`, `fixtures/synthetic/**` and steering docs. S6 owns `infra/**` except `infra/modules/api/openapi.yaml`, which is an S0 copy.
- `package-lock.json`: after day 1, only the integrator (Claude on `develop`) changes it.
- Contract changes after day 1 go through an S0 change request: a small PR into `develop` that every stream rebases onto.

## Consequences

- A stream that needs a new dependency asks the integrator, who adds it and rebases.
- With only 4 sessions, streams merge as set out in plan section 9.3.

## Source

- re:Invent Compass build plan status line, sections 3.1, 8, 9.1, 9.3, 13 (R5).
