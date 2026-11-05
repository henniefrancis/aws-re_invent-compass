_For architects: how the work was organised and built, which tools and checks guard it, and why each choice was made._

Each section is one decision with four parts: the context, the decision, why, and the trade-off. Where a later decision or the code changed it, the section says so. The [Key decisions](Key-Decisions) page lists every decision on every theme.

## Branching model

**Context:** Several builders work on different specs at the same time, and `main` is what production runs.

**Decision:**

- `main` is the production branch. Nothing is committed to it directly.
- `develop` is the integration branch. Every feature is built on its own `feature/*` branch and merges into `develop`.
- A `release/*` branch is cut from `develop` and merges into `main` (tagged) and back into `develop`. A `hotfix/*` branch is cut from `main` and merges into `main` and back into `develop`.
- Each [Kiro](Glossary#kiro) session works in its own git worktree, on its own `feature/<spec>` branch.
- Claude is the integrator: it merges reviewed feature branches into `develop` after the QA and security review gate, and owns `package-lock.json`.
- The owner's go is needed for every push and pull request. The owner merges into `main` and tags the release. Branch protection on `main` requires a pull request and the one `check` job, with no force pushes (a repository setting, the owner's statement).

**Why:** One integration branch per release, and parallel work that does not collide.

**Trade-off:** Integration is a manual step through one integrator, and CI guards only `main` and `develop`.

**Later:** Release 0.1.0 used no `release/*` branch. The owner opened the pull request from `develop` into `main`, ran the release script for prod from `main` on 31 October, and tagged `v0.1.0` on 3 November, after prod had answered its health check, to publish the npm package.

## Toolchain

**Context:** The concept first proposed pnpm workspaces and Biome. The owner accepted a toolchain closer to his earlier projects. Up to six builders worked in parallel, so the toolchain and every dependency had to be fixed on day one.

**Decision:**

- npm workspaces with `package-lock.json` (not pnpm).
- ESLint plus Prettier (not Biome).
- TypeScript 6, strict.
- Vitest 4 with 100% coverage thresholds.
- Node 24. The [Lambdas](Glossary#lambda) run `nodejs24.x` on arm64.
- Angular 22, zoneless and prerendered (`outputMode: "static"`), for the site only. Playwright for the site only.
- Named libraries: zod, `openapi-typescript`, `passkit-generator` and `aws-jwt-verify`.
- Exact version pins, with every planned dependency installed on day one.

**Why:** A fixed toolchain lets parallel builders start without asking for packages, and exact pins keep builds reproducible.

**Trade-off:** A builder who needs a new dependency asks the integrator, who adds it and everyone rebases.

**Today:** The pins in the root [package.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/package.json) are TypeScript 6.0.3, Vitest 4.1.12, ESLint 10.12.0, Prettier 3.9.10 and Playwright 1.64.1. The site uses Angular 22.2.3, and the packages use zod 4.6.7. See [Build and test](Build-and-Test).

## Monorepo layout and file ownership

**Context:** Up to six builders worked on eight specs at the same time, and merge conflicts between them were a named risk. The first pass signer spec mixed Lambda code and Terraform, so two builders could not work on it at once.

**Decision:**

- One repository: `packages/contracts`, `packages/core`, `packages/mcp-server` (published as `reinvent-compass`), `packages/pass-service`, `contracts/`, `power/`, `site/`, `infra/`, `scripts/`, `data/venues.json` and `fixtures/`.
- `packages/core` uses subpath exports (`@compass/core/*`) with no shared barrel file. The `rules` subpath is browser-safe, so the site demo uses it.
- The pass signer became `packages/pass-service`, and its spec was split into code and Terraform streams.
- One spec per stream, one feature branch and one worktree each. No two streams edit the same file: the foundation stream owns the root configs, the contracts, `.github/`, the synthetic fixtures and the [steering](Glossary#steering) files; the infra stream owns `infra/` except the API's copy of the contract.
- After day one only the integrator changes `package-lock.json`. Contract changes go through a small change request into `develop` that every stream rebases onto.

**Why:** Clear ownership keeps parallel streams from editing the same file.

**Trade-off:** Shared changes, such as a new dependency or a contract change, go through one person and cost every stream a rebase. See [Repository layout](Repository-Layout).

## Early contract lock

**Context:** The plan locked the foundation stream in one day, before the other streams started. On 16 October 2026 one foundation task alone took over two hours in Kiro and eleven tasks remained. Waiting would have slipped every stream by about a day and pushed the 28 October feature freeze.

**Decision:**

- Kiro finished the contract tasks first: the wire and domain schemas, the pass fields, the MCP tool schemas, and the Compass API contract with its generated types. Then it stopped.
- Claude reviewed them at a checkpoint and merged the foundation branch into `develop` on 16 October as the contract lock.
- The other streams' worktrees were cut from `develop` and started.
- Kiro finished the rest of the foundation (scanners, synthetic catalog, spikes, CI workflows, the save hook, example files and the acceptance gate) on the same branch, merged again after review.

**Why:** The other streams needed the shared contracts to start, not the whole foundation.

**Trade-off:** Streams that started before the synthetic catalog landed used small local test data, then switched. The contracts were frozen at the lock, so every later change needed a change request.

## One required CI check

**Context:** Deploys are owner-run through HCP Terraform, so CI needs no cloud access. Feature branches merge into `develop` locally, so CI mainly guards `main`. The owner capped CI minutes for the project.

**Decision:**

| Workflow                                                                                                         | Trigger                                     | What it does                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [check.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/workflows/check.yml)     | Pull request into `main`, push to `develop` | The one required check: build, lint, tests with coverage, secret and dependency scans, offline Terraform checks |
| [e2e.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/workflows/e2e.yml)         | Manual only                                 | Playwright and axe on seven device profiles                                                                     |
| [publish.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/workflows/publish.yml) | A `v*` tag                                  | Build, then `npm publish` through trusted publishing with provenance; no npm token is stored                    |
| [dependabot.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/dependabot.yml)     | Monthly                                     | Tracks npm and GitHub Actions with the open pull request limit at 0                                             |
| CodeQL                                                                                                           | Default setup                               | A repository setting, with no workflow file                                                                     |

- No deploy workflow and no scheduled run. Every action is pinned by commit SHA.
- Unit coverage must be 100% of lines, branches, functions and statements, with named exclusions only: `packages/mcp-server/src/bin.ts`, `packages/pass-service/src/lambda-entry/*.ts` and generated files ([vitest.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/vitest.config.ts)).

**Why:** One required check is simple to protect and reason about, and nothing in CI can touch AWS.

**Trade-off:** The browser suite runs only on demand, and work on a feature branch is not checked by CI until it reaches `develop`.

**Later:**

- On 20 October 2026 `check.yml` also started running on pushes to `develop`: once the standing pull request into `main` was merged, `develop` had no CI.
- The plain `npm audit` step was replaced by a [reviewed allowlist](Decisions-Security-and-Privacy#a-reviewed-allowlist-for-npm-audit).
- The site unit suite and the site build were added to the job (see [Site components covered by browser tests](#site-components-covered-by-browser-tests)).

**Today:** The `check` job runs, in order: `npm ci`, the contract hash, placeholder, dash and catalog checks, Prettier, `tsc -b`, ESLint, the unit tests with coverage, the site unit tests with coverage, the site build, the workspace build, gitleaks, the audit allowlist check, Terraform fmt and validate, tflint, the Terraform native tests with mock providers, the infra static tests, Trivy filesystem and config scans, and shellcheck. Its timeout is 25 minutes. See [Quality gate](Quality-Gate).

## Site components covered by browser tests

**Context:** Unit coverage must be 100% with named exclusions only. The showcase site is Angular 22 with standalone, zoneless components. Unit-testing the components would need a DOM test environment, which the workspace does not pin.

**Decision:**

- Every decision in the site lives in plain TypeScript under [site/src/lib](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/src/lib) and [site/scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/scripts), covered to 100% by Vitest ([site/vitest.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/vitest.config.ts)).
- The Angular components and templates in `site/src/app` are left out of unit coverage. They only wire browser globals and render what the library computes.
- The Playwright and axe browser suite covers the components on seven profiles: desktop Chromium, Firefox and WebKit, and iPad and iPhone in portrait and landscape.
- A static test keeps decisions out of components: no `fetch(`, `switch (`, `JSON.parse` or regular expression literal under `site/src/app` ([site/test/static/source-rules.test.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/test/static/source-rules.test.ts)).

**Why:** The logic gets full unit coverage without adding a DOM dependency, and the components get tested where they actually run, in real browsers.

**Trade-off:** The browser suite runs on demand, not on every push. A decision added to a component is a review finding: it moves into `site/src/lib` with a unit test.

## Builders after the Kiro credits ran out

**Context:** The project is spec driven with Kiro. On 17 October 2026 the owner's Kiro credits ran out. By then Kiro had written five of the [Kiro specs](Glossary#kiro-spec), built the foundation stream and started the Events API client.

**Decision:**

- Claude's dev-team agents (developer, QA, security, technical account manager and CTO roles) build the remaining work from the same Kiro specs, under the same steering, file ownership and review gates, one agent per worktree.
- The remaining specs are written by Claude in Kiro's format (requirements, design, tasks) and reviewed before any code.
- The specs, their task checkboxes and their design deviation sections stay the single record, so Kiro can pick up any stream again.
- The owner is the sole commit author. Claude is credited in the README.

**Why:** The specs carried the project when the tool that wrote them was unavailable.

**Trade-off:** Two builders work from one record, so the record must stay complete: every change needs a spec task first.

**Later:** On 19 October 2026 the owner made "Kiro first" his own rule (it is not a contest rule): every change starts as a Kiro spec or a task in one, Claude's agents build from it, and the owner uses Kiro for the demo, the Power and the article. Work that ran ahead of its task is backfilled into the spec as a checked task with a design deviation. See [How it was built](How-It-Was-Built) and [Kiro specs](Kiro-Specs).

## MCP TypeScript SDK stays on v1

**Context:** The MCP server was pinned to `@modelcontextprotocol/sdk` 1.32.1 from the workspace scaffold, and the specs did not say why v1 rather than v2. When checked on 29 October 2026, the SDK repository named v2 as its main line and said v1.x keeps getting fixes for at least six months after the v2 release of 27 July 2026. v2 ships under new package names.

**Decision:**

- Stay on the v1 line for 0.1.0.
- Keep the pin exact, so the bundled package is reproducible. Any change to it goes through the full gate.
- Move to v2 after 0.1.0, before v1 support ends, as its own Kiro spec.

**Why:** The server was built, tested at 100% coverage and live-tested against v1. Moving to v2 means new package names, new import paths and a full gate a few days before submission, and nothing in 0.1.0 needs v2.

**Trade-off:** A v2 migration is planned work, with a date set by the v1 support window.

**Later:** On 30 October 2026 the owner approved the 1.32.2 patch. The pin in [packages/mcp-server/package.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/package.json) is exactly 1.32.2, and the build bundles the SDK into the published package. The patch adds no dependencies, and its change to registering tools after connecting does not affect Compass, which registers every tool before it connects. See [MCP server](MCP-Server).

## Related pages

- [Key decisions](Key-Decisions)
- [How it was built](How-It-Was-Built)
- [Quality gate](Quality-Gate)
- [Repository layout](Repository-Layout)
- [Build and test](Build-and-Test)
