_For developers: how to install, build and test every part of re:Invent Compass on your own machine, and what each npm script does._

Everything here runs offline. Tests use [simulated mode](Glossary#simulated-mode) and never call the live AWS [Events API](Glossary#events-api), Apple, Google or AWS. The same commands run in CI, in the order described on [Quality gate](Quality-Gate).

## Prerequisites

| Tool                 | Version                         | Where it is set                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js              | 24                              | `engines` is `>=24` in the root [package.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/package.json) and in [packages/mcp-server/package.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/package.json); the site asks for `^24.15.0` in [site/package.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/package.json); [.nvmrc](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.nvmrc) says `24`. CI uses Node 24.                                            |
| npm                  | the one that ships with Node 24 | The repository is one npm workspaces monorepo: [packages/contracts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/contracts), [packages/core](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/core), [packages/mcp-server](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server), [packages/pass-service](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service) and [site](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site). |
| Git                  | any recent version              | The dash check lists files with `git ls-files`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Terraform and tflint | Terraform 1.15, tflint v0.64.0  | Optional. Only for the infrastructure checks below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Every dependency is pinned to an exact version ([.npmrc](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.npmrc) sets `save-exact=true`), so `npm ci` gives every machine the same tree as the lockfile.

## First run

```sh
git clone https://github.com/henniefrancis/aws-re_invent-compass.git
cd aws-re_invent-compass
npm ci
npx tsc -b               # build the four packages (needed before lint)
npm test                 # unit and property tests, with coverage
npm run test:site        # site unit tests, with coverage
```

`npm test` needs no build: Vitest resolves the `@compass/source` export condition, so each package is imported from its TypeScript source. ESLint is type-aware and reads the workspace packages through their built type declarations, so run `npx tsc -b` before `npm run lint`.

## Root scripts

Every script in the root [package.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/package.json):

| Script               | Command                                                                                                                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`              | `tsc -b`                                                                                                                             | Type checks and builds the four packages through the project references in [tsconfig.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/tsconfig.json). It does not build the site or the npm bundle.                                                                                                                                                                                   |
| `test`               | `vitest run --coverage`                                                                                                              | Runs every `packages/**/test/**/*.test.ts` and `spikes/test/**/*.test.ts` with v8 coverage and 100% thresholds, with `COMPASS_MODE=simulated` set. Config: [vitest.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/vitest.config.ts).                                                                                                                                           |
| `lint`               | `eslint .`                                                                                                                           | ESLint over the whole repository. Config: [eslint.config.js](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/eslint.config.js).                                                                                                                                                                                                                                                            |
| `format:check`       | `prettier --check .`                                                                                                                 | Fails on any file Prettier would change. Config: [.prettierrc.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.prettierrc.json).                                                                                                                                                                                                                                                     |
| `gen:copy`           | [gen-copy.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/scripts/gen-copy.mjs)                     | Copies the Compass API contract byte for byte from [contracts/compass-api.openapi.yaml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/contracts/compass-api.openapi.yaml) to its two copies, writing each atomically. See [Contracts](Contracts).                                                                                                                                        |
| `gen:types`          | [gen-types.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/scripts/gen-types.mjs)                   | Runs openapi-typescript on the Compass API copy and on the Events API document, and writes `compass-api.ts` and `events-api.ts` under [packages/contracts/src/generated](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/contracts/src/generated) with a "do not edit" banner. Run `gen:copy` first.                                                                              |
| `check:hash`         | [hash-check.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/scripts/hash-check.mjs)                 | Proves the three Compass API contract files are byte-identical by SHA-256. On a mismatch it names the file and prints hash prefixes only, never contents.                                                                                                                                                                                                                                                      |
| `check:placeholders` | [placeholder-safety.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/scripts/placeholder-safety.mjs) | Scans the three contract files for anything account-specific: a twelve-digit run (plain or grouped), a hard-coded `arn:aws`, a Terraform percent-brace marker, or any dollar-brace marker other than the two Lambda invoke placeholders. It reports line and column only.                                                                                                                                      |
| `check:dash`         | [dash-check.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/scripts/dash-check.mjs)                 | Fails when any tracked file contains an em dash or an en dash. `LICENSE` is the one exception. It reports file, line and dash kind, never the line text.                                                                                                                                                                                                                                                       |
| `check:catalog`      | [catalog-check.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/scripts/catalog-check.mjs)           | Regenerates the [synthetic catalog](Glossary#synthetic-catalog) from [fixtures/synthetic/generate.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/fixtures/synthetic/generate.ts), compares it byte for byte with the committed `catalog.json` and `index.json`, and validates every session against the wire schema. `npm run check:catalog -- --write` rewrites the committed files. |
| `test:site`          | `npm run test --workspace site`                                                                                                      | The site unit tests with coverage.                                                                                                                                                                                                                                                                                                                                                                             |
| `build:site`         | `npm run build --workspace site`                                                                                                     | The site build with its output and budget checks.                                                                                                                                                                                                                                                                                                                                                              |
| `e2e`                | `npm run e2e --workspace site`                                                                                                       | The Playwright browser tests.                                                                                                                                                                                                                                                                                                                                                                                  |

There is no separate `typecheck` script: `npx tsc -b` (or `npm run build`) is the type check. One more CI script has no npm alias: `node .github/scripts/audit-check.mjs` runs `npm audit --omit=dev` and fails on any high or critical advisory that is not on its reviewed allowlist.

## Measured results

Measured on 2 November 2026 on the `develop` branch:

| Run                 | Test files | Tests              | Coverage                                                                                                                                                                                                      |
| ------------------- | ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`          | 245        | 3,025, all passing | 100% of statements, branches, functions and lines over the packages, the spikes and the CI scripts                                                                                                            |
| `npm run test:site` | 40         | 453, all passing   | 100% of [site/src/lib](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/src/lib) and [site/scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/scripts) |

The coverage exclusions are named in [Quality gate](Quality-Gate#coverage).

## The site

The [site/package.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/package.json) scripts, run from the root with `--workspace site` or through the root aliases:

| Script  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build` | `ng build`, then [check-build-output.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/scripts/check-build-output.mjs) (every prerendered page exists, carries the notice and cannot break the Content Security Policy) and [check-budgets.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/scripts/check-budgets.mjs) (initial JavaScript at most 250,000 bytes gzip; the demo route at most 150,000 bytes gzip). |
| `test`  | `vitest run --coverage` with [site/vitest.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/vitest.config.ts): 100% thresholds over `src/lib` and `scripts`, no exclusions.                                                                                                                                                                                                                                                               |
| `e2e`   | `playwright test` with [site/playwright.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/playwright.config.ts).                                                                                                                                                                                                                                                                                                                          |

### Browser tests

The browser suite needs a built site and the Playwright browsers:

```sh
npm run build:site
npx playwright install --with-deps chromium webkit firefox
npm run e2e
```

Playwright starts [serve-static.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/scripts/serve-static.mjs) on `127.0.0.1:4173`, which serves the build under the site's Content Security Policy (less `upgrade-insecure-requests`, because it speaks plain http) and answers 403 for an unknown path, as CloudFront does. The tests run with axe on 7 device profiles, listed in [site/e2e/support/profiles.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/e2e/support/profiles.ts): desktop Chromium, Firefox and WebKit, an iPad in portrait and landscape, and an iPhone in portrait and landscape. No test calls a deployed API, and there are no retries.

## The pass service Lambda build

```sh
npm run build:lambda --workspace packages/pass-service
```

This runs [scripts/build.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/scripts/build.ts) through [scripts/run.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/scripts/run.mjs). esbuild bundles each of the two [Lambda](Glossary#lambda) functions (`api` and `passkit`) into one ES module for Node.js 24 and zips it deterministically into `packages/pass-service/dist/lambda/api.zip` and `passkit.zip`. The build fails when a zip reaches 5 MB, and it prints only each bundle's name, size and SHA-256. See [Pass service](Pass-Service).

## The MCP server build and pack

```sh
npm run build --workspace packages/mcp-server
npm pack --dry-run --json --workspace packages/mcp-server > pack.json
node packages/mcp-server/scripts/check-pack.mjs pack.json
npm pack --workspace packages/mcp-server
```

[build.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/scripts/build.mjs) bundles the server and its scan workers with esbuild into `dist/`. Everything is bundled except `@napi-rs/keyring`, a native module. It copies the venue list, the sample repo and the simulated fixtures next to the bundles, copies `LICENSE` and `NOTICE`, and writes `THIRD-PARTY-NOTICES.txt` with the licence of every bundled package. `prepack` runs the same build. [check-pack.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/scripts/check-pack.mjs) fails when the packed file list holds anything other than the bundles, data, fixtures, README, licence files and manifest. The publish workflow runs these same steps; see [Release](Release).

## Simulated mode and the demo

After the MCP server build you can run Compass locally on made-up data:

```sh
node packages/mcp-server/dist/bin.js demo                 # the ten-step demo, no network
node packages/mcp-server/dist/bin.js demo --repo <folder> # scan a copy of your own folder
COMPASS_MODE=simulated node packages/mcp-server/dist/bin.js   # the stdio server on made-up data
```

`demo` always forces simulated mode. In simulated mode the server serves the synthetic catalog and canned Events API responses, presents a signed-in attendee, runs an in-process pass service and never opens a socket to the outside. Every result starts with `SIMULATED MODE: no real data.` Simulated mode is refused when `NODE_ENV` is `production`, unless `COMPASS_ALLOW_SIMULATED=1` is set. The published package runs the same way: `npx --yes reinvent-compass@0.1.1 demo`.

## Live tests (owner only)

A small smoke suite in [live-smoke.live-test.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/test/api/live-smoke.live-test.ts) talks to the real Events API: sign-in, catalog, schedule, a favourite round trip, a personal time round trip and exactly one reservation that is cancelled again. It is not part of `npm test`, because its file name does not end in `.test.ts`. It has its own config:

```sh
COMPASS_LIVE_TESTS=1 COMPASS_LIVE_CONFIRM=yes COMPASS_LIVE_SESSION_ID=<id> \
  npx vitest run --config packages/core/test/api/vitest.live.config.ts
```

The gate is `isLiveEnabled` in [live-gate.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/test/api/live-gate.ts):

```ts
env.COMPASS_LIVE_TESTS === '1' && env.COMPASS_LIVE_CONFIRM === 'yes' && !isCi(env);
```

Both opt-ins are needed, and any `CI` value other than empty, `0` or `false` closes the gate, so the suite can never run in CI. Without the gate every live test is reported as skipped. The suite uses its own keychain service name, `reinvent-compass-livetest`, so it never touches the owner's real sign-in.

## Infrastructure checks

The Terraform checks run in CI and never call AWS or [HCP Terraform](Glossary#hcp-terraform). To run them yourself, with Terraform 1.15 and tflint v0.64.0:

```sh
terraform fmt -check -recursive infra
# for each of infra/modules/*, infra/bootstrap, infra/envs/dev, infra/envs/prod:
terraform -chdir=<dir> init -backend=false -input=false
terraform -chdir=<dir> validate
tflint --recursive --config="$PWD/infra/.tflint.hcl" --chdir=infra
# for each folder that holds a tests folder (and infra/ itself):
terraform -chdir=<dir> test
node --test "infra/tests/static/*.test.mjs"
```

There are 16 Terraform native test files (`*.tftest.hcl`), each with mock providers. The static tests in [infra/tests/static](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra/tests/static) check the release scripts, the CI workflow, the Content Security Policy and other rules in plain Node. CI also runs a Trivy config scan of [infra](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra) and shellcheck over [scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/scripts).

## Related pages

- [Quality gate](Quality-Gate)
- [Repository layout](Repository-Layout)
- [Contracts](Contracts)
- [Release](Release)
