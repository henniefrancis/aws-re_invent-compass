---
inclusion: always
---

# How we work (every Kiro session reads this)

Several Kiro sessions ("engineers") build re:Invent Compass at the same time, one spec each. These rules keep them from colliding. Source: build plan sections 9 and 11.3, ADR-002 and ADR-007.

## Branches and worktrees

- `main` is production. Nobody commits to it directly.
- `develop` is the integration branch. Each spec is built on `feature/<spec-name>`, cut from `develop`.
- **Each Kiro session works in its own git worktree** (its own folder) on its own `feature/*` branch. Never two sessions in one worktree.
- Releases go `develop` to `release/x.y.z` to a PR into `main`. Post-launch fixes go on `hotfix/x.y.z` from `main`.

## File ownership

- Edit only the folders your spec owns (structure.md marks each folder with its stream: S0 to S7). If you need a change in another stream's files, stop and write it up as a request in your spec's `tasks.md` notes for the integrator.
- `package.json` and `package-lock.json` change only through the integrator after day 1. If you need a dependency, ask; do not run `npm install <pkg>`.
- Shared types, schemas and the Compass API contract live in `packages/contracts` and `contracts/` (S0). After the day-1 lock they change only through an S0 change request that every stream rebases onto.
- Code that depends on another stream that is not merged yet is written against the contract with a mock, never against that stream's unmerged code.

## Commits and pushes

- Commit locally, in small steps, only after `npm test` passes for your package. Check that every edit landed.
- **Never push, merge, open a PR or tag.** The integrator (Claude) merges reviewed `feature/*` branches into `develop` locally; the owner approves every push.
- Conventional Commits with your spec as the scope. No em dashes or en dashes.

## Definition of done for a spec

1. Every task in `tasks.md` is complete and the spec files are committed.
2. 100% unit coverage for the code you own (named exclusions only), lint, format and typecheck clean.
3. No token, email or other personal data can reach logs or error messages (with a test that proves it, where relevant).
4. Docs for what you built: a short `README.md` in your package or folder, plus any runbook the owner needs.
5. Two or three screenshots or short terminal captures of the feature working, saved to `docs/article/screenshots/<spec-name>/`, for the Builder Center post.
6. Then the review gate: QA and security review the branch; you fix findings until no High or Critical is open.

## Safety

- Never call the live Events API from tests. Use `COMPASS_MODE=simulated` and fixtures. Live checks run only when the owner sets `COMPASS_LIVE_TESTS=1`.
- Never read, print, paste or commit a secret, certificate, key, token or account ID. Use the `.example` files.
- Never create AWS resources outside Terraform, and never run `terraform apply` or deploy scripts: the owner runs every deploy.
