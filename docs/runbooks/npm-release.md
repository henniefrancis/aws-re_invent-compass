# Runbook: publish the npm package

Owner-run. The agent never publishes, tags or pushes. The package is `reinvent-compass` (workspace `packages/mcp-server`). The publish workflow is `.github/workflows/publish.yml`, triggered by a tag `v*` (ADR-018).

## One-time setup

1. Claim the name. Check that `reinvent-compass` is free on npm (`npm view reinvent-compass` must report 404). If it is taken, stop and decide on a scoped name before anything else changes.
2. First manual publish (ADR-018, R15). A trusted publisher can only be configured on a package that already exists, so the owner published a placeholder `0.0.1` once by hand to create the name. That version is spent: it holds no real build, and npm never lets a version be reused. The first real release must therefore be `0.1.0` or later, never `0.0.1` or `0.0.0`.
3. Configure the trusted publisher on npmjs.com: package settings, Trusted Publisher, GitHub Actions, with the repository owner and name, workflow file `publish.yml`, and the environment `npm-publish` (the workflow job runs in that environment, and the trusted publisher must name it or npm refuses the token exchange). In GitHub, the `npm-publish` environment has the owner as required reviewer, so every publish waits for the owner's approval in the Actions run.
4. Afterwards, revoke any npm token used for the manual publish. The workflow publishes with OIDC and provenance and needs no token.

## Prepare a release

Do these in one commit, in this order.

1. Remove `"private": true` from `packages/mcp-server/package.json`. It is there so that nothing can publish by accident; the packaging test that expects it must be updated in the same commit.
2. Set the version, `0.1.0` or later, in all of these places together. The version tests fail if any one differs:
   - `packages/mcp-server/package.json`
   - `power/plugin.json`
   - `power/POWER.md`
   - `power/mcp.json`
   - the hook template
   - every `npx --yes reinvent-compass@X` example in `packages/mcp-server/README.md` and under `power/` (the power test checks that each one equals the package version)
3. Set `COMPASS_API_BASE_URL` in `packages/mcp-server/src/config/compass-api.ts` to `https://reinvent-compass.vegas`, the production apex domain (ADR-031), with no trailing slash. The address is known before the prod apply, but tag only after prod answers `GET /api/v1/health` (see `release.md`). While the value is the `.invalid` placeholder, a live run fails loudly, so never tag before this step.
4. Run `npx eslint .`, `npx prettier --check .`, `npx tsc -b` and `npx vitest run --coverage`. The pack smoke test builds, packs and runs the package from the unpacked archive.
5. Check the file list by hand once: `npm pack --dry-run --workspace packages/mcp-server`. The listing must hold only `package.json`, `README.md`, `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.txt` (the build writes the last three into the package folder), `dist/bin.js`, `dist/scan-worker.js`, `dist/github-scan-worker.js` and the `dist/data`, `dist/sample-repo` and `dist/fixtures` folders (63 files for 0.1.0, checked 29 October 2026).

## Tag order

1. Deploy `prod` first (`release.md`), so `https://reinvent-compass.vegas` answers `GET /api/v1/health`.
2. Commit the release changes above, with the real domain, and merge them to `main`.
3. Only then create the tag `vX.Y.Z` on that commit, where `X.Y.Z` equals the package version, and push it. The publish job then waits for your approval in the `npm-publish` environment.

Never tag before the prod domain is set in the source: a published package cannot be changed, and a version with the placeholder URL is useless to every user.

## What the workflow does

Two jobs, so the job that holds the npm OIDC token runs none of the repository's code.

1. `verify` has `contents: read` only: no `id-token` and no environment. On the tag it runs `npm ci`, the type check, lint and the tests with coverage, checks that the tag equals the package version, builds the workspace and the package, asserts the packed file list with `packages/mcp-server/scripts/check-pack.mjs` (any missing or unexpected file stops the run), packs the real tarball with `npm pack` and uploads it as the `npm-tarball` artifact.
2. `publish` needs `verify` and runs only when the ref is a `v*` tag. It holds `id-token: write` and the `npm-publish` environment, so it waits for your approval. It runs no checkout, no `npm ci` and no package script: it sets up Node with the npm registry, checks that npm is 11.5.1 or later (trusted publishing needs it) and fails if not, downloads the tarball and runs `npm publish <tarball> --provenance --access public`. What is published is exactly the file `verify` built and checked.

## Hardening (owner, in the npm and GitHub settings)

- Keep two-factor authentication on for the npm account, including for publishing, so a stolen password alone cannot publish or change the trusted publisher.
- In GitHub, open Settings, Environments, `npm-publish`, Deployment branches and tags, choose selected branches and tags, and add a tag rule `v*`. Only a `v*` tag can then deploy to the environment, whatever a workflow file says.

## If a publish fails

- Failed file list check: the message names each `missing:` or `unexpected:` path. Fix the `files` list or the build script; do not edit the checker to make it pass.
- Tag and version differ: delete the tag locally and on the remote, fix the version, and tag again.
- A published version is wrong: it cannot be overwritten. Publish a new patch version and run `npm deprecate` on the bad one.
