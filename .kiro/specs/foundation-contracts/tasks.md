# Implementation Plan: foundation-contracts (S0)

## Overview

This plan converts the S0 design into incremental coding steps. It builds the npm workspaces monorepo, the shared contracts package, the Compass API OpenAPI contract and its byte-identical copies, generated types, the deterministic synthetic catalog, the CI workflows and scanners, the repo save hook, the two spike scripts, and the doc and example files. Each step builds on the previous ones and ends by wiring everything into the acceptance gate (compile, test at 100 percent coverage, hash check, placeholder check, dash check, actionlint, catalog validation). No feature logic is added: every package ships a compiling stub and a placeholder test.

Implementation language is TypeScript 6 (strict), run under Node 24, as fixed by the design and the toolchain steering. Dependency versions use the exact pins in the design's pinned dependency table. Tests use vitest 4 with v8 coverage and fast-check for property-based tests, running with `COMPASS_MODE=simulated`. No task calls the live Events API. No em dash or en dash appears anywhere.

Tasks run sequentially in numeric order, 1 through 15. Each top-level task ends with a local commit made only after that task's tests pass, using Conventional Commits with `foundation-contracts` as the scope. Nothing is ever pushed, merged, tagged or opened as a PR: the integrator handles that.

## Tasks

- [x] 1. Establish the workspace scaffold and toolchain
  - [x] 1.1 Write root manifest, lockfile seed and Node pin
    - Create root `package.json` with `"private": true`, `"workspaces"` for `packages/contracts`, `packages/core`, `packages/mcp-server`, `packages/pass-service` and `site`, `"engines": {"node": ">=24"}`, the `build`, `test`, `lint`, `format:check`, `gen:*` and `check:*` scripts, and `devDependencies` pinned exactly per the design's pinned dependency table (no range, caret or tilde)
    - Create `.nvmrc` containing exactly `24`
    - Record a committed `package-lock.json` consistent with the pinned dependencies
    - _Requirements: 1.1, 1.7, 1.8, 1.9, 1.11, 1.12, 1.13, 1.16_

  - [x] 1.2 Write shared TypeScript, lint and format configuration
    - Create `tsconfig.base.json` with `strict`, ES2024 target and lib, Node module resolution, `composite`, `declaration`, `verbatimModuleSyntax` and `customConditions: ["@compass/source"]`
    - Create the solution `tsconfig.json` referencing every workspace tsconfig
    - Create `eslint.config.js` as a flat config: typescript-eslint recommended-type-checked rules, `no-restricted-imports` forbidding deep relative cross-package imports, and an angular-eslint block scoped to `site/**`; no `eslint-plugin-import` dependency
    - Create `.prettierrc.json` with the house style
    - _Requirements: 1.2, 1.3, 1.4, 2.6_

  - [x] 1.3 Write vitest configuration with 100 percent coverage and named exclusions
    - Create `vitest.config.ts` with the v8 provider, thresholds of 100 for lines, branches, functions and statements, `coverage.exclude` listing only `packages/mcp-server/src/bin.ts`, `packages/pass-service/src/lambda-entry/*.ts` and `**/generated/**`, inclusion of `spikes/src` in the run and coverage, `resolve.conditions` including `@compass/source`, and `env: {COMPASS_MODE: "simulated"}`
    - _Requirements: 1.5, 1.6_

  - [x] 1.4 Write property test for exact dependency pinning
    - **Property 1: Every declared dependency is an exact pin**
    - **Validates: Requirements 1.7, 1.8, 1.16**

  - [x] 1.5 Write configuration smoke tests for the scaffold
    - Assert the workspaces array equals the five expected entries, root `engines.node` is `>=24`, `.nvmrc` is `24`, base and workspace tsconfig `strict` is true, and vitest thresholds are 100 for the four metrics
    - _Requirements: 1.1, 1.2, 1.5, 1.11, 1.12_

  - [x] 1.6 Commit the scaffold and toolchain
    - After the task 1 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `chore(foundation-contracts): add workspace scaffold and toolchain`). This first commit also includes `.kiro/specs/foundation-contracts/`. Do not push, merge, tag or open a PR
    - _Requirements: 1.1_

- [x] 2. Create the per-workspace manifests, stubs and placeholder tests
  - [x] 2.1 Create the @compass/core subpath package skeleton
    - Create `packages/core/package.json` with the eight subpath exports (`auth`, `api`, `catalog`, `simulated`, `rules`, `scanner`, `spec`, `passes`), each listing `@compass/source`, `types` and `default`, with no `.` root export
    - Create an empty compiling `index.ts` stub for each subpath (for example `export {};`), with the `rules` stub importing no Node runtime module
    - Create `packages/core/tsconfig.json` extending the base
    - Add a placeholder test under `packages/core/test/`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.2 Write property test for the browser-safe rules subpath
    - **Property 13: The rules subpath is browser-safe**
    - **Validates: Requirements 2.4**

  - [x] 2.3 Write unit tests for the core exports map and import ban
    - Assert the exports map has the eight subpath keys with a `@compass/source` condition, no `.` root export and no `src/index.ts` barrel; assert `no-restricted-imports` rejects a deep relative cross-package import fixture and that no `eslint-plugin-import` dependency exists
    - _Requirements: 2.1, 2.2, 2.3, 2.6_

  - [x] 2.4 Create the mcp-server, pass-service and site workspace skeletons
    - Create `packages/mcp-server`, `packages/pass-service` and `site` each with a `package.json`, a tsconfig extending the base, a compiling placeholder entry point and a placeholder test (site manifest only, per ownership)
    - _Requirements: 1.10_

  - [x] 2.5 Commit the workspace skeletons
    - After the task 2 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `chore(foundation-contracts): add workspace skeletons and core subpath exports`). Do not push, merge, tag or open a PR
    - _Requirements: 1.10, 2.1_

- [x] 3. Retrieve and record the Events API OpenAPI, and generate its types
  - [x] 3.1 Write the Events API fetch helper and commit the document
    - Create an operator-run fetch helper that retrieves `https://api.awsevents.com/v1/openapi.json`, writes atomically (temp file then rename), and on any network or non-200 result throws a descriptive error naming the URL and status while leaving any previously committed document unchanged
    - Commit the fetched `packages/contracts/events-api.openapi.json` (OpenAPI 3.1.0)
    - _Requirements: 3.1, 3.5_

  - [x] 3.2 Record provenance in ADR-023
    - Create `docs/decisions/ADR-023-events-api-openapi-source.md` recording the source URL, retrieval date and the SHA-256 of the committed Events API document
    - _Requirements: 3.2_

  - [x] 3.3 Write unit tests for the fetch helper and ADR-023 provenance
    - Assert the mocked failing fetch surfaces a descriptive error and leaves the committed document unchanged; assert ADR-023 contains the source URL and a SHA-256 equal to the hash of the committed document
    - _Requirements: 3.2, 3.5_

  - [x] 3.4 Commit the Events API document and provenance
    - After the task 3 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `feat(foundation-contracts): add Events API OpenAPI and ADR-023 provenance`). Do not push, merge, tag or open a PR
    - _Requirements: 3.1, 3.2_

- [x] 4. Define the shared wire schemas
  - [x] 4.1 Implement the wire Session, SessionTime and SeatAvailability schemas
    - Create `packages/contracts/src/wire/session.ts` with `SessionWireSchema` (required `sessionId` and `title`, all other fields optional, `abbreviation` as the session code, unknown fields stripped), `SessionTimeSchema` and the forward-compatible `SeatAvailabilitySchema`
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 4.2 Implement the remaining wire schemas and response wrappers
    - Create `wire/schedule.ts` (`ScheduleWireSchema` plus `ListSessionsSchema`, `GetSessionSchema`, `GetScheduleSchema`), `wire/personal-time.ts` (`PersonalTimeSchema`, `PersonalTimeInputSchema`), `wire/event.ts` (`EventSchema`) and `wire/bulk-result.ts` (`BulkResultSchema`, `BulkFailureSchema` with `conflictsWith` as an optional `string[]`, forward-compatible `BulkFailureCodeSchema`)
    - _Requirements: 4.5, 4.6_

  - [x] 4.3 Write property test for enum forward-compatibility
    - **Property 4: Wire enums are forward-compatible**
    - **Validates: Requirements 4.3**

  - [x] 4.4 Write type-level compatibility test for wire Session
    - Assert the set of `SessionWire` field names matches the set of properties on the `Session` type generated from the Events API OpenAPI, and that every non-enum field type is assignable. Do not assert full assignability, because the forward-compatible enums are intentionally wider than the generated enum unions. The assertion must compile
    - _Requirements: 4.4_

  - [x] 4.5 Commit the wire schemas
    - After the task 4 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `feat(foundation-contracts): add shared wire schemas`). Do not push, merge, tag or open a PR
    - _Requirements: 4.1, 4.5_

- [x] 5. Define the shared domain, Problem and MCP tool schemas
  - [x] 5.1 Implement the domain type schemas
    - Create `src/domain/normalised-session.ts` (with `type` and `level` optional and listed in `missingFields` when absent, never defaulted), `src/domain/commitment.ts` (discriminated union over `kind`), `src/domain/venue.ts` and `src/domain/verdict.ts` (discriminated union over `allow`, `warn`, `block`, with `warn` and `block` carrying at least one reason)
    - _Requirements: 4.6, 4.7, 4.8_

  - [x] 5.2 Implement the PassFields factory
    - Create `packages/contracts/src/pass-fields.ts` (directly under `src/`, not under `src/domain/`, per build plan section 5.3) with `createPassFieldsSchema({ start, end, timezone })` applying build plan section 5.3 field rules, no hard-coded dates, and rejection of URL-like, domain-like, control-character and bidirectional-override text
    - _Requirements: 4.9_

  - [x] 5.3 Implement the Problem and MCP tool schemas
    - Create `src/problem.ts` (`ProblemSchema` with `type`, `title`, `status`, `code`, no echoed input) and `src/mcp-tools.ts` (input and output schema for every tool in build plan 8.1, exported as the `mcpTools` record)
    - _Requirements: 4.10, 4.11_

  - [x] 5.4 Wire the contracts public surface
    - Create `packages/contracts/src/index.ts` with explicit re-exports of every wire schema, domain type, Problem, `mcpTools` and the generated type namespaces (the contracts public surface, not a core-style barrel)
    - _Requirements: 4.1, 4.5, 4.9, 4.10, 4.11_

  - [x] 5.5 Write property test for schemas accepting valid inputs and stripping unknown fields
    - **Property 2: Schemas accept valid inputs and strip unknown fields**
    - **Validates: Requirements 4.1, 4.2, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11**

  - [x] 5.6 Write property test for schemas rejecting malformed inputs without coercion
    - **Property 3: Schemas reject malformed inputs without coercion**
    - **Validates: Requirements 4.3, 4.13**

  - [x] 5.7 Write property test for idempotent schema parsing
    - **Property 5: Schema parsing is idempotent**
    - **Validates: Requirements 4.12**

  - [x] 5.8 Commit the domain, Problem and MCP tool schemas
    - After the task 5 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `feat(foundation-contracts): add domain, Problem and MCP tool schemas`). Do not push, merge, tag or open a PR
    - _Requirements: 4.6, 4.9, 4.10, 4.11_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Author the Compass API OpenAPI contract and generate its types
  - [x] 7.1 Write the single-source Compass API contract
    - Create `contracts/compass-api.openapi.yaml` (OpenAPI 3.0.1) defining every route in build plan 5.2 with auth schemes, request and response shapes, the `application/problem+json` error component and `x-amazon-apigateway` extensions using `${...}` placeholders only (no ARN, no 12-digit account number, no account-specific value)
    - _Requirements: 5.1_

  - [x] 7.2 Implement the gen:copy and gen:types scripts
    - Implement `gen:copy` to byte-copy `contracts/compass-api.openapi.yaml` to `packages/contracts/openapi.yaml` and `infra/modules/api/openapi.yaml`, and `gen:types` to run openapi-typescript on `packages/contracts/openapi.yaml` into `src/generated/compass-api.ts` and on `events-api.openapi.json` into `src/generated/events-api.ts`
    - Produce the two byte-identical copies and the committed generated type files
    - _Requirements: 5.2, 5.3, 5.9, 5.10, 3.3, 3.4_

  - [x] 7.3 Commit the Compass API contract, copies and generated types
    - After the task 7 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `feat(foundation-contracts): add Compass API contract, copies and generated types`). Do not push, merge, tag or open a PR
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 8. Implement the repository scanner scripts
  - [x] 8.1 Implement the hash check and placeholder safety scanners
    - Create `.github/scripts/hash-check.mjs` (SHA-256 of the three Compass API copies, compare, report which differs with SHA prefixes only) and `.github/scripts/placeholder-safety.mjs` (scan the three committed copies for a 12-digit run `\b\d{12}\b` or `arn:aws`, report the file and redacted match location only)
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 8.2 Write property test for the three-way hash equality
    - **Property 8: The three Compass API OpenAPI copies are hash-equal**
    - **Validates: Requirements 5.4, 5.5, 5.6, 12.3**

  - [x] 8.3 Write property test for the placeholder and secret safety scanner
    - **Property 9: The safety scanner flags forbidden tokens and only those**
    - **Validates: Requirements 5.7, 5.8, 11.5, 12.10**

  - [x] 8.4 Implement the dash check scanner
    - Create `.github/scripts/dash-check.mjs` that enumerates tracked files with `git ls-files`, scans all except `LICENSE` for an em dash or en dash, and reports each offending file and line with the dash kind named
    - _Requirements: 7.3, 8.4_

  - [x] 8.5 Write property test for the dash scanner
    - **Property 10: The dash scanner flags em and en dashes and only those**
    - **Validates: Requirements 7.3, 8.4, 12.8, 12.9**

  - [x] 8.6 Commit the scanner scripts
    - After the task 8 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `feat(foundation-contracts): add hash, placeholder and dash scanners`). Do not push, merge, tag or open a PR
    - _Requirements: 5.4, 5.7, 7.3_

- [x] 9. Build the deterministic synthetic catalog
  - [x] 9.1 Implement the catalog generator and commit the catalog
    - Create `fixtures/synthetic/generate.ts` with an in-repo seeded PRNG (mulberry32), a fixed seed constant and sorted iteration, emitting about 120 sessions as JSON under `fixtures/synthetic/` with made-up titles, speakers and codes, real venue names, byte-stable serialization (sorted keys, trailing newline), and the required repeat (`-R`), all-day, missing-venue and missing-end-time cases
    - Commit the generated catalog
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 9.2 Implement the catalog check script
    - Create `.github/scripts/catalog-check.mjs` that regenerates the catalog, compares it byte for byte to the committed catalog, and validates every committed session against `SessionWireSchema`, reporting the first failing session index with its field path on mismatch
    - _Requirements: 6.6, 6.5_

  - [x] 9.3 Write property test for catalog validation against the live schema
    - **Property 6: The synthetic catalog validates against the live schemas**
    - **Validates: Requirements 6.5, 12.6**

  - [x] 9.4 Write property test for deterministic catalog generation
    - **Property 7: Catalog generation is deterministic**
    - **Validates: Requirements 6.1, 6.6**

  - [x] 9.5 Write unit test for required catalog edge cases
    - Assert the committed catalog contains at least one repeat (`-R`), one all-day item, one missing-venue session and one missing-end-time session
    - _Requirements: 6.4_

  - [x] 9.6 Commit the synthetic catalog and check script
    - After the task 9 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `feat(foundation-contracts): add deterministic synthetic catalog`). Do not push, merge, tag or open a PR
    - _Requirements: 6.1, 6.6_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement the spike scripts and their tested modules
  - [x] 11.1 Implement the SP2 ID token redaction module and wrapper
    - Create `spikes/src/id-token-redact.ts` with the claim-name extraction and redaction logic (allow only `alg`, `kid`, `iss`, `aud`, `token_use`, `exp` and claim names, never values) and the thin wrapper `spikes/sp2-id-token.ts` that fetches `<iss>/.well-known/openid-configuration` and the JWKS, verifies with aws-jwt-verify, and reports verification failure with no claim value
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 11.2 Write property test for ID token redaction
    - **Property 11: ID token redaction never leaks a claim value**
    - **Validates: Requirements 9.1, 9.2, 9.5, 9.7**

  - [x] 11.3 Implement the SP5 shape-diff module and wrapper
    - Create `spikes/src/shape-diff.ts` with field-level diff logic (field names and presence or type descriptors only, never recorded values) and the thin wrapper `spikes/sp5-shape-diff.ts` that compares `fixtures/.raw/` recordings against the synthetic catalog and the Events API OpenAPI, reporting "no recordings present" with a zero exit when `fixtures/.raw/` is absent or empty
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 11.4 Write property test for shape-diff redaction
    - **Property 12: Shape-diff redaction never leaks a recorded value**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.6**

  - [x] 11.5 Write unit test for the SP5 absent and empty recordings path
    - Assert SP5 reports no recordings with a zero exit for an absent and for an empty `fixtures/.raw/`, with tests under `spikes/test`
    - _Requirements: 10.4_

  - [x] 11.6 Commit the spike scripts and modules
    - After the task 11 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `feat(foundation-contracts): add SP2 and SP5 spike scripts`). Do not push, merge, tag or open a PR
    - _Requirements: 9.1, 10.1_

- [x] 12. Author the CI workflows, Dependabot and the save hook
  - [x] 12.1 Write the check workflow
    - Create `.github/workflows/check.yml` as one job on `pull_request` into `main` only, running the build plan 11.1 steps in order (`npm ci`, hash check, placeholder safety, dash check, `prettier --check`, `eslint`, `tsc -b`, `vitest --coverage` at 100 percent, build, gitleaks, `npm audit --omit=dev --audit-level=high`, Terraform fmt/validate/tflint/test, Trivy fs and config scans, shellcheck), with every action pinned by SHA, no `push` or `schedule` trigger, and the Terraform and shellcheck steps guarded to pass as no-ops when no matching files exist
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.9, 7.10_

  - [x] 12.2 Write the e2e, publish and Dependabot files
    - Create `.github/workflows/e2e.yml` (`workflow_dispatch` only), `.github/workflows/publish.yml` (tag `v*` only, npm trusted publishing with provenance) and `.github/dependabot.yml` (monthly, `open-pull-requests-limit: 0`), all actions pinned by SHA
    - _Requirements: 7.6, 7.7, 7.8, 7.9, 7.10_

  - [x] 12.3 Write workflow lint and parsed-YAML tests
    - Run actionlint over the three workflow files; assert the triggers, step order, SHA-pinning and absence of `push`/`schedule` by parsing the YAML
    - _Requirements: 7.1, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11_

  - [x] 12.4 Write the repository save hook
    - Create a `.kiro/hooks/**` save hook that triggers on TypeScript file save and runs lint on the saved file, the owning package's tests (resolved by matching the path to a workspace folder) and `dash-check.mjs`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 12.5 Write a smoke test for the save hook
    - Assert the hook triggers on TypeScript save and runs lint, the owning-package tests and the dash check
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 12.6 Commit the CI workflows, Dependabot and save hook
    - After the task 12 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `ci(foundation-contracts): add check, e2e, publish workflows and save hook`). Do not push, merge, tag or open a PR
    - _Requirements: 7.1, 8.1_

- [x] 13. Create the doc and example files
  - [x] 13.1 Write the committed example files and reconcile CONCEPT dates
    - Create `.env.example` with placeholder values only (no secret, token, certificate, key or account identifier), and reconcile any `CONCEPT.md` date that differs from the build plan in the same change
    - Note: Requirements 11.3 and 11.4 (the `infra/envs/*/terraform.tfvars.example` and `cloud.auto.tfbackend.example` files) are delivered by the infra stream (S6), per integrator decision, because S6 owns `infra/**`, its approved requirements define those files against its own variables, and `cloud.auto.tfbackend` uses the KEY=VALUE format read by `release.sh`. This avoids an add/add merge conflict and a format clash.
    - _Requirements: 11.1, 11.2, 11.5 (11.3 and 11.4 delivered by S6)_

  - [x] 13.2 Commit the doc and example files
    - After the task 13 tests pass, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `docs(foundation-contracts): add example config files and reconcile dates`). Do not push, merge, tag or open a PR
    - _Requirements: 11.1_

- [x] 14. Wire the acceptance gate and prove the consumer path
  - [x] 14.1 Add the consumer-import fixture and verify the full gate
    - Add a small consumer fixture that imports a shared type from `@compass/contracts` and compiles, then run the full gate: `tsc -b` across the monorepo, `vitest --coverage` at 100 percent, hash check, placeholder safety check and dash check over the real committed files, actionlint, and catalog validation against the live schema
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10_

  - [x] 14.2 Commit the acceptance gate and consumer fixture
    - After the full gate passes, commit locally with a Conventional Commit scoped `foundation-contracts` (for example `test(foundation-contracts): add consumer fixture and wire acceptance gate`). Do not push, merge, tag or open a PR
    - _Requirements: 12.1_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks run sequentially in numeric order, 1 through 15. There is no parallel wave execution for this spec.
- Every test sub-task is required: S0's definition of done is 100 percent coverage of the code it owns, with named exclusions only.
- Each top-level task (1 through 14) ends with a commit sub-task. Commit locally only after that task's tests pass, using Conventional Commits with `foundation-contracts` as the scope. The first commit (1.6) also includes `.kiro/specs/foundation-contracts/`. Never push, merge, tag or open a PR: the integrator does that after review.
- Each task references specific requirements for traceability, and each property test references its design property number and the requirements clause it validates.
- The thirteen correctness properties map one to one onto thirteen property-based tests (1.4, 2.2, 4.3, 5.5, 5.6, 5.7, 8.2, 8.3, 8.5, 9.3, 9.4, 11.2, 11.4), each run at a minimum of 100 iterations with fast-check and tagged `Feature: foundation-contracts, Property {number}: {property_text}`.
- All work stays inside S0-owned paths. `package.json` and `package-lock.json` pass to the integrator after day 1.
- Every test runs with `COMPASS_MODE=simulated` against committed fixtures. No task calls the live Events API; the Events API document fetch is an operator action, not a CI or test action.
- No em dash or en dash appears in any file, comment, test name or commit message. Commits use Conventional Commits with `foundation-contracts` as the scope.

## Task Dependency Graph

The waves below run strictly in order, one leaf sub-task per wave, so the whole plan executes sequentially in numeric order (1 through 14). Checkpoint tasks 6, 10 and 15 are prose-only and are not scheduled here.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4"] },
    { "id": 4, "tasks": ["1.5"] },
    { "id": 5, "tasks": ["1.6"] },
    { "id": 6, "tasks": ["2.1"] },
    { "id": 7, "tasks": ["2.2"] },
    { "id": 8, "tasks": ["2.3"] },
    { "id": 9, "tasks": ["2.4"] },
    { "id": 10, "tasks": ["2.5"] },
    { "id": 11, "tasks": ["3.1"] },
    { "id": 12, "tasks": ["3.2"] },
    { "id": 13, "tasks": ["3.3"] },
    { "id": 14, "tasks": ["3.4"] },
    { "id": 15, "tasks": ["4.1"] },
    { "id": 16, "tasks": ["4.2"] },
    { "id": 17, "tasks": ["4.3"] },
    { "id": 18, "tasks": ["4.4"] },
    { "id": 19, "tasks": ["4.5"] },
    { "id": 20, "tasks": ["5.1"] },
    { "id": 21, "tasks": ["5.2"] },
    { "id": 22, "tasks": ["5.3"] },
    { "id": 23, "tasks": ["5.4"] },
    { "id": 24, "tasks": ["5.5"] },
    { "id": 25, "tasks": ["5.6"] },
    { "id": 26, "tasks": ["5.7"] },
    { "id": 27, "tasks": ["5.8"] },
    { "id": 28, "tasks": ["7.1"] },
    { "id": 29, "tasks": ["7.2"] },
    { "id": 30, "tasks": ["7.3"] },
    { "id": 31, "tasks": ["8.1"] },
    { "id": 32, "tasks": ["8.2"] },
    { "id": 33, "tasks": ["8.3"] },
    { "id": 34, "tasks": ["8.4"] },
    { "id": 35, "tasks": ["8.5"] },
    { "id": 36, "tasks": ["8.6"] },
    { "id": 37, "tasks": ["9.1"] },
    { "id": 38, "tasks": ["9.2"] },
    { "id": 39, "tasks": ["9.3"] },
    { "id": 40, "tasks": ["9.4"] },
    { "id": 41, "tasks": ["9.5"] },
    { "id": 42, "tasks": ["9.6"] },
    { "id": 43, "tasks": ["11.1"] },
    { "id": 44, "tasks": ["11.2"] },
    { "id": 45, "tasks": ["11.3"] },
    { "id": 46, "tasks": ["11.4"] },
    { "id": 47, "tasks": ["11.5"] },
    { "id": 48, "tasks": ["11.6"] },
    { "id": 49, "tasks": ["12.1"] },
    { "id": 50, "tasks": ["12.2"] },
    { "id": 51, "tasks": ["12.3"] },
    { "id": 52, "tasks": ["12.4"] },
    { "id": 53, "tasks": ["12.5"] },
    { "id": 54, "tasks": ["12.6"] },
    { "id": 55, "tasks": ["13.1"] },
    { "id": 56, "tasks": ["13.2"] },
    { "id": 57, "tasks": ["14.1"] },
    { "id": 58, "tasks": ["14.2"] }
  ]
}
```
