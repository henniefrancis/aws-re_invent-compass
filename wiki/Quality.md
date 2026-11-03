_For architects: how re:Invent Compass is tested, what the measured numbers are, what CI runs, and which gates a change must pass before it merges._

Compass is built test first against contracts. Every package, spike module and CI script is held to 100 percent coverage, the site's decision code is held to the same bar, the browser suite runs on seven devices, and the Terraform is tested offline with mock providers. Nothing in the test suites calls the live AWS Events API, Apple, Google or AWS: tests run with `COMPASS_MODE=simulated`.

## Measured numbers

Measured on 2 November 2026 on the `develop` branch:

| Suite                           | Command             | Result                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packages, spikes and CI scripts | `npm test`          | 245 test files, 3,025 tests, all passing. Coverage 100 percent of statements, branches, functions and lines.                                                                                                                                                          |
| Showcase site logic             | `npm run test:site` | 40 test files, 453 tests, all passing. Coverage 100 percent of [site/src/lib](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/src/lib) and [site/scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/scripts). |
| Browser suite                   | `npm run e2e`       | Playwright with axe on 7 device profiles.                                                                                                                                                                                                                             |

## Test strategy

### Unit and property tests

Vitest runs every test under `packages/**/test` and [spikes/test](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/spikes/test). Many suites are property tests written with fast-check: instead of a few examples, a property such as "the quota tracker blocks exactly the call that would exceed a limit" or "every tool result matches its contract" is checked on 100 or more generated cases. The root [vitest.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/vitest.config.ts) allows 30 seconds a test for that reason.

Cross-cutting tests in [packages/mcp-server/test/cross](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/test/cross) check that every tool result matches its contract, that read tools never write, that no secret reaches a log or an error, that the server writes nothing to stdout but protocol messages, that simulated mode never touches the network, and the required prompt-injection test (see [Security](Security#prompt-injection)).

### Contract tests

The [OpenAPI](Glossary#openapi) documents are the source of truth, and the tests read them directly:

- **The Compass API.** [contract.test.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/test/contract/contract.test.ts) reads [contracts/compass-api.openapi.yaml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/contracts/compass-api.openapi.yaml), checks that the two Lambda route tables cover exactly its operations, and validates every response against the declared schema and content type.
- **The Compass API client.** The client tests run against an in-memory mock built from the same contract ([openapi-mock.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/test/passes/openapi-mock.ts)), which records any request that breaks it.
- **The Events API.** [openapi-conformance.test.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/test/api/openapi-conformance.test.ts) checks the 12 operation clients against [events-api.openapi.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/contracts/events-api.openapi.json).
- **One contract, three copies.** `npm run check:hash` proves the contract, its type-generation copy and the API Gateway copy are byte-identical. See [Contracts](Contracts).

### Browser tests

[site/e2e](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/e2e) holds the Playwright suite. [profiles.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/e2e/support/profiles.ts) defines seven device profiles: desktop Chromium, Firefox and WebKit, iPad portrait and landscape, and iPhone portrait and landscape. The suite runs axe with the WCAG 2.0, 2.1 and 2.2 A and AA tags on every page and state, a forced colours run, a CSP run with no violation allowed, a check that no request leaves the site's origin and nothing is stored, layout, the board states, the demo, Walk from here with a mocked position, and a Chromium largest contentful paint check. It serves the built site locally and mocks the hand-off routes; it never calls a deployed API.

### Terraform tests

All checks are offline. They never call AWS or HCP Terraform.

- **Native tests.** 16 `.tftest.hcl` files: one or more in each module's `tests` folder, the bootstrap, and five cross-cutting tests in [infra/tests](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra/tests) (composition, domain, outputs, retained resources, tags). Every one mocks its providers with `mock_provider`.
- **Static tests.** `node --test` runs the scripts in [infra/tests/static](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra/tests/static): the CSP and Permissions-Policy match the site, the access log format, secret shapes, outputs, provider locks, the release and other scripts, and that nothing sensitive leaks.
- **Linters and scanners.** `terraform fmt`, `terraform validate` in every root, tflint with [infra/.tflint.hcl](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/.tflint.hcl), and Trivy config scanning of `infra`.

## Coverage thresholds

Both configurations use the v8 provider with 100 percent thresholds for lines, branches, functions and statements.

| Configuration                                                                                                      | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Named exclusions                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [vitest.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/vitest.config.ts)           | `packages/*/src`, [spikes/src](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/spikes/src), [.github/scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/.github/scripts), [scripts/google-wallet-class.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/scripts/google-wallet-class.mjs), [fixtures/synthetic/generate.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/fixtures/synthetic/generate.ts) | [bin.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/bin.ts) (hands process values to the tested `main`), the files in [lambda-entry](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/pass-service/src/lambda-entry) (the two Lambda handlers), generated files |
| [site/vitest.config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/vitest.config.ts) | [site/src/lib](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/src/lib) and [site/scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/scripts)                                                                                                                                                                                                                                                                                                | None. The Angular components in [site/src/app](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/src/app) hold no decisions and are covered by the browser suite.                                                                                                                                                     |

See [why the site components are covered by the browser suite](Decisions-Delivery-and-Tooling#site-components-covered-by-browser-tests).

## CI workflows

All three workflows are in [.github/workflows](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/.github/workflows). Every action is pinned by commit SHA and the default permission is `contents: read`. See [Decisions: Delivery and tooling](Decisions-Delivery-and-Tooling#one-required-ci-check).

| Workflow                                                                                                         | Runs on                                         | What it runs                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [check.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/workflows/check.yml)     | A pull request into `main`, a push to `develop` | `npm ci`; the contract hash, placeholder, dash and catalog checks; Prettier; `tsc -b`; ESLint; `npm test`; `npm run test:site`; `npm run build:site` with output and budget checks; the build; Gitleaks; npm audit with the reviewed allowlist; Terraform fmt, validate, tflint, native tests and static tests; Trivy file system and config scans; shellcheck. |
| [e2e.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/workflows/e2e.yml)         | Manual dispatch only                            | `tsc -b`, the site build, then Playwright with axe on all seven profiles, and uploads the HTML report.                                                                                                                                                                                                                                                          |
| [publish.yml](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.github/workflows/publish.yml) | A `v*` tag only                                 | A `verify` job (type check, lint, tests, build, a check of the packed file list, pack) and a separate `publish` job that publishes the tarball to npm with provenance.                                                                                                                                                                                          |

## Review gates

A change is done only when it passes all of these, as the project's [workflow steering](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/.kiro/steering/workflow.md) sets out:

1. Every task of its spec is complete.
2. 100 percent coverage for the code it touches (named exclusions only), and lint, format and type check clean.
3. No token, email or other personal data can reach logs or error messages, with a test that proves it where relevant.
4. A short README for what was built, plus any runbook the owner needs.
5. QA and security review the branch, and the findings are fixed until no High or Critical finding is open. Only then is the branch merged.

The review work is tracked on the project board: [Review workstream](https://github.com/users/henniefrancis/projects/3/views/1?filterQuery=workstream%3A%22Review%22).

## Related pages

- [Quality gate](Quality-Gate)
- [Build and test](Build-and-Test)
- [Contracts](Contracts)
- [Security](Security)
- [Showcase site](Showcase-Site)
