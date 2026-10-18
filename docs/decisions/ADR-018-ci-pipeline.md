# ADR-018 CI pipeline

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

The playbook caps CI minutes, even though standard runners are free for public repos. Deploys are owner-run through HCP Terraform (ADR-014), so CI does not need cloud access. `feature/*` branches merge into `develop` locally, so CI only needs to guard `main`.

## Decision

| Workflow      | Trigger                                                  | Job                                                                                                                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check.yml`   | `pull_request` into `main` only (the required check)     | One job, under 8 minutes: `npm ci`, contract hash check, `prettier --check`, `eslint`, `tsc -b`, `vitest --coverage` (100% thresholds), build, gitleaks, `npm audit --omit=dev --audit-level=high`, `terraform fmt -check`, `validate`, `tflint`, `terraform test`, Trivy fs and config, shellcheck |
| `e2e.yml`     | `workflow_dispatch` only                                 | Playwright, 7 profiles plus axe plus Lighthouse                                                                                                                                                                                                                                                     |
| `publish.yml` | Tag `v*`                                                 | Build and `npm publish` through trusted publishing with provenance                                                                                                                                                                                                                                  |
| CodeQL        | Default setup                                            |                                                                                                                                                                                                                                                                                                     |
| Dependabot    | Monthly, `open-pull-requests-limit: 0` until after 1 Nov |                                                                                                                                                                                                                                                                                                     |

- No deploy workflow, no push trigger, no cron. Actions are pinned by SHA.
- Soft cap: 300 minutes for the project; expected use about 150. Check usage before every push.

## Consequences

- Unit coverage must be 100% (lines, branches, functions, statements), with named exclusions only: `packages/mcp-server/src/bin.ts`, `packages/pass-service/src/lambda-entry/*.ts` and generated types.
- The npm trusted publisher may need a first manual publish of `0.0.1` by the owner (R15).

## Source

- re:Invent Compass build plan sections 11.1, 11.2, 11.3, 13 (R15).
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers).
