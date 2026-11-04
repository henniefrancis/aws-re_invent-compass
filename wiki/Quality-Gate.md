_For developers: exactly what must pass before a change reaches `develop` or `main`, in the order CI runs it, and the review steps around it._

The gate is defined in [.github/workflows](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/.github/workflows). Every action in every workflow is pinned by commit SHA, and the Terraform, tflint and Trivy binaries are pinned by version. Every check also runs on your machine; see [Build and test](Build-and-Test).

## When it runs

| Workflow                                                                                                         | Trigger                                                 | What it gates                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [check.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/workflows/check.yml)     | A pull request into `main`, and every push to `develop` | Every change. This is the required check.                                                                                   |
| [e2e.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/workflows/e2e.yml)         | On demand only (`workflow_dispatch`)                    | The browser tests, run before a release.                                                                                    |
| [publish.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/workflows/publish.yml) | A `v*` tag                                              | The npm package. Its `verify` job repeats the type check, lint and tests before anything is packed. See [Release](Release). |

No workflow runs on a schedule.

## check.yml, step by step

One job, "build, test and scan", on `ubuntu-latest` with a 25 minute limit and read-only repository permissions. It checks out the full history (so Gitleaks can scan every commit) without keeping the token, sets up Node 24 and runs these steps in this order. Any failure stops the job.

**Node checks**

1. `npm ci`
2. `npm run check:hash`: the three [Compass API](Glossary#compass-api) contract files are byte-identical.
3. `npm run check:placeholders`: no account id, ARN or stray template marker in the contract files.
4. `npm run check:dash`: no em dash or en dash in any tracked file.
5. `npm run check:catalog`: the committed [synthetic catalog](Glossary#synthetic-catalog) matches its generator and the wire schema.
6. `npm run format:check`: Prettier.
7. `npx tsc -b`: the TypeScript build. It runs before ESLint because type-aware lint reads the workspace packages through their built types.
8. `npm run lint`: ESLint.
9. `npm test`: unit and property tests with coverage.
10. `npm run test:site`: site unit tests with coverage.
11. `npm run build:site`: the site build, its output check and its bundle budgets.
12. `npm run build --if-present`: the root build.

**Secret and dependency scans**

13. Gitleaks over the whole history.
14. `node .github/scripts/audit-check.mjs`: `npm audit --omit=dev`, failing on any high or critical advisory not on the reviewed allowlist. The allowlist in [audit-check.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/scripts/audit-check.mjs) is empty since 4 November 2026, when its three advisories in the Apple Wallet library were fixed upstream. Every run prints the allowlist, or says it is empty, so any accepted risk stays visible. `.trivyignore` holds the same list for the Trivy scan.

**Terraform checks.** These are steps of the same job, not a separate job. They never call AWS or [HCP Terraform](Glossary#hcp-terraform): `init` uses `-backend=false` and every native test mocks its providers.

15. Cache the Terraform plugins and create the cache folder.
16. Set up Terraform 1.15.9.
17. `terraform fmt -check -recursive infra`
18. `terraform validate` in every module, in [infra/bootstrap](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra/bootstrap) and in both environments.
19. tflint v0.64.0, recursive, with [infra/.tflint.hcl](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/.tflint.hcl).
20. `terraform test` in every folder that holds `*.tftest.hcl` files (16 test files).
21. `node --test "infra/tests/static/*.test.mjs"`: the static infrastructure and script tests.

**Final scans**

22. Trivy filesystem scan of the repository: fails on a fixed HIGH or CRITICAL finding.
23. Trivy config scan of [infra](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra): fails on a HIGH or CRITICAL misconfiguration.
24. Shellcheck over [scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/scripts).

## e2e.yml

Run by hand from the Actions tab. One job, "playwright and axe", 45 minute limit: `npm ci`, `npx tsc -b`, `npm run build:site`, `npx playwright install --with-deps chromium webkit firefox`, `npm run e2e`, then it uploads the HTML report as an artifact kept for 14 days. The suite runs on 7 device profiles (desktop Chromium, Firefox and WebKit, iPad and iPhone in both orientations) against the local static server, with no retries.

## Coverage

Coverage is v8, with thresholds of 100% for statements, branches, functions and lines. A run below 100% fails.

| Run                 | Measured                                                                                                                                                                                                                                        | Config                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm test`          | 100% of statements, branches, functions and lines, over 245 test files and 3,025 tests (2 November 2026)                                                                                                                                        | [vitest.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/vitest.config.ts)           |
| `npm run test:site` | 100% of [site/src/lib](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/src/lib) and [site/scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/scripts), over 40 test files and 453 tests | [site/vitest.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/vitest.config.ts) |

The root run covers the `src` folder of every package, [spikes/src](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/spikes/src), the CI scripts in [.github/scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/.github/scripts), [scripts/google-wallet-class.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/scripts/google-wallet-class.mjs) and the synthetic catalog generator. It has exactly three named exclusions:

| Excluded                                                                                                                                             | Why                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [packages/mcp-server/src/bin.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/bin.ts)                 | The process entry point: it only hands the `process` values to the tested `main`. |
| [packages/pass-service/src/lambda-entry](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/lambda-entry) | The two Lambda handlers: they only wire real AWS clients to the tested pipeline.  |
| `**/generated/**`                                                                                                                                    | The types generated from the OpenAPI documents.                                   |

The site run has no exclusions. There are no coverage ignore comments in the code. The Angular components hold no decisions and are covered by the browser tests instead.

## The dash rule

No em dash (U+2014) or en dash (U+2013) may appear in code, comments, tests, docs or commit messages. Use commas, colons, parentheses or a new sentence. [dash-check.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/scripts/dash-check.mjs) enforces it in CI for every tracked file. [LICENSE](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/LICENSE) is the one exception, because its upstream text is reproduced word for word.

## Review gates

CI is the last gate, not the only one. The project's workflow steering ([.kiro/steering/workflow.md](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.kiro/steering/workflow.md)) sets the rest:

1. **Spec done.** Every task in the spec's `tasks.md` is complete and the spec files are committed.
2. **Clean.** 100% coverage for the code the change owns (named exclusions only), and lint, format and type check clean.
3. **No leaks.** No token, email or other personal data can reach logs or error messages, with a test that proves it where relevant.
4. **Documented.** A short README for what was built, plus any runbook the owner needs.
5. **Reviewed.** QA and security review the branch, and findings are fixed until no High or Critical is open.
6. **Merged.** Reviewed `feature/*` branches are merged into `develop`, which runs `check.yml`. A release goes from `develop` through `release/x.y.z` to a pull request into `main`, which runs `check.yml` again. The owner approves every push.

The review work is visible on the [project board, Review workstream](https://github.com/users/henniefrancis/projects/3/views/1?filterQuery=workstream%3A%22Review%22).

A [Kiro hook](Glossary#kiro-hook), [save-typescript-check.kiro.hook](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.kiro/hooks/save-typescript-check.kiro.hook), lints a saved TypeScript file, runs its package's tests and runs the dash check. It is a convenience while editing; CI is the real gate.

## Related pages

- [Build and test](Build-and-Test)
- [Contributing](Contributing)
- [Quality](Quality)
- [Release](Release)
