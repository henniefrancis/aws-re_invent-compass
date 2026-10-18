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
3. Set `COMPASS_API_BASE_URL` in `packages/mcp-server/src/config/compass-api.ts` to the production CloudFront domain, `https://` plus the `cloudfront_domain_name` output of the prod environment, with no trailing slash. This needs the prod first apply to be finished (see `release.md`, first-time setup). While the value is the `.invalid` placeholder, a live run fails loudly, so never tag before this step.
4. Run `npx eslint .`, `npx prettier --check .`, `npx tsc -b` and `npx vitest run --coverage`. The pack smoke test builds, packs and runs the package from the unpacked archive.
5. Check the file list by hand once: `npm pack --dry-run --workspace packages/mcp-server`. The listing must hold only `package.json`, `README.md`, `dist/bin.js`, `dist/scan-worker.js` and the `dist/data`, `dist/sample-repo` and `dist/fixtures` folders.

## Tag order

1. Deploy `prod` first (`release.md`), so the CloudFront domain exists and answers `GET /api/v1/health`.
2. Commit the release changes above, with the real domain, and merge them to `main`.
3. Only then create the tag `vX.Y.Z` on that commit, where `X.Y.Z` equals the package version, and push it. The publish job then waits for your approval in the `npm-publish` environment.

Never tag before the prod domain is set in the source: a published package cannot be changed, and a version with the placeholder URL is useless to every user.

## What the workflow does

On the tag it runs lint, the type check and the tests with coverage, checks that the tag equals the package version, builds the workspace, builds the package, packs with `npm pack --dry-run --json` and asserts the file list with `packages/mcp-server/scripts/check-pack.mjs` (any missing or unexpected file stops the run), and publishes with provenance.

## If a publish fails

- Failed file list check: the message names each `missing:` or `unexpected:` path. Fix the `files` list or the build script; do not edit the checker to make it pass.
- Tag and version differ: delete the tag locally and on the remote, fix the version, and tag again.
- A published version is wrong: it cannot be overwritten. Publish a new patch version and run `npm deprecate` on the bad one.
