# ADR-002 Branching model

Status: Accepted (owner, kickoff answer 2, 2026-10-15). The `develop` integration branch, one git worktree per Kiro session and Claude as integrator were accepted by the owner on 2026-10-15 with the build plan.

## Decision (owner)

- `main` is the production branch. Nothing is committed to it directly.
- Every feature is built on its own `feature/*` branch.
- Every release is prepared on a `release/*` branch.
- Every fix after launch is made on a `hotfix/*` branch and merged into `main` once fixed.

## Integration branch (owner accepted, 2026-10-15)

- `develop` is the integration branch: `feature/*` merges into `develop`; `release/*` is cut from `develop` and merges into `main` (tagged) and back into `develop`; `hotfix/*` is cut from `main` and merges into `main` and back into `develop`.
- This matches the playbook rule "one integration branch per repo per release; push once when the release is ready".
- Branch protection on `main`: pull request required, the single `check` CI job required, no force pushes (owner task O4).

## Parallel work (owner accepted, 2026-10-15)

- Each Kiro session works in its own git worktree, on its own `feature/<spec>` branch. Kiro writes all code.
- Claude is the integrator: it merges reviewed `feature/*` branches into `develop` locally, after the QA and security review gate, and owns the lockfile (`package-lock.json`).

## Consequences

- Kiro works on `feature/<spec-name>` branches, one spec per branch.
- A stream that needs a new dependency asks the integrator, who adds it and rebases (ADR-007).
- The first docs commit (9540f52, 2026-10-15) was pushed straight to `main` before this decision, when the repo was set up.
- Each push and PR needs the owner's go (playbook section 3). The owner merges the `release/*` PR into `main` and tags it.
- Update, 29 October 2026: release 0.1.0 used no `release/*` branch. The owner opened the PR from `develop` into `main`, ran `release.sh prod` from `main`, and tagged `v0.1.0` after prod answered its health check (see `docs/runbooks/release.md`).

## Source

- re:Invent Compass build plan status line, sections 9.1, 9.2, 9.3, 11.3, 14 (O4).
