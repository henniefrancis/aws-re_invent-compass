# Requirements Document

## Introduction

This spec is the S0 "foundation-contracts" stream for re:Invent Compass. Its single job is to lock the shared contracts and scaffolding in one day so that six engineers (streams S1 to S7) can build in parallel the next day without editing each other's files. The build plan (docs/architecture/build-plan.md) is the single source of truth where anything conflicts; this spec references build plan sections 3, 4.1, 5, 8 (the S0 row and 8.1), 9.1, 9.2, 11 and 11.1, 11.2 and ADR-006, ADR-007, ADR-008, ADR-016, ADR-018 and ADR-023.

Scope is scaffolding and contracts only: the npm workspaces monorepo, the toolchain configuration, the shared type and schema packages, the Compass API OpenAPI contract and its byte-identical copies, generated types from both the official Events API OpenAPI and the Compass API OpenAPI, a deterministic synthetic catalog, the GitHub workflows and Dependabot configuration, the repo build hooks, two owner-run spike scripts, and doc and example-file updates. Feature logic is out of scope: every package is left with an index that compiles and a placeholder test.

Owned paths (only these may be edited by this stream): root configs including `.nvmrc`, `package.json` workspaces and `package-lock.json`, `packages/contracts/**`, `contracts/**`, `.github/**` including `.github/scripts/**`, `fixtures/synthetic/**`, `spikes/**`, `.kiro/hooks/**`, the steering files, plus the single S0-owned copy `infra/modules/api/openapi.yaml`, the `docs/decisions/ADR-023-events-api-openapi-source.md` provenance record for the Events API OpenAPI, `CONCEPT.md` dates, and the `.example` files named below.

Non-negotiable project constraints that every requirement in this document inherits:

- No secret, token, certificate, key or account identifier value is ever printed or committed. Only `.example` files are committed for secret-bearing configuration.
- Tests run with `COMPASS_MODE=simulated` and committed fixtures only. No requirement here causes a call to the live Events API.
- No em dash or en dash appears anywhere in copy, comments, test names or commit messages.
- Every dependency is pinned to an exact version. No version ranges.

## Glossary

- **Monorepo**: The single npm workspaces repository containing all packages and the site.
- **Workspace_Scaffold**: The root npm workspaces configuration plus the shared TypeScript, ESLint, Prettier and vitest configuration.
- **Contracts_Package**: The `packages/contracts` package, published conceptually as `@compass/contracts`, holding shared zod schemas, inferred types, the Compass API OpenAPI copy, and generated Events API and Compass API types.
- **Core_Package**: The `packages/core` package, exposing subpath exports under `@compass/core/*` with no shared barrel file.
- **Events_API_OpenAPI**: The official AWS Events API OpenAPI document, version 3.1.0, fetched from `https://api.awsevents.com/v1/openapi.json`.
- **Compass_API_OpenAPI**: The single-source Compass API contract at `contracts/compass-api.openapi.yaml` (OpenAPI 3.0.1).
- **Hash_Check_Script**: The script that computes and compares the SHA-256 hashes of the three Compass API OpenAPI copies.
- **Placeholder_Safety_Check**: The check, run alongside the Hash_Check_Script, that fails if a 12-digit number or an `arn:aws` literal appears in any of the three committed Compass API OpenAPI copies.
- **Dash_Check_Script**: The script under `.github/scripts/` that fails if an em dash or an en dash appears in any tracked text file other than `LICENSE`.
- **Synthetic_Catalog_Generator**: The deterministic generator that produces the made-up catalog under `fixtures/synthetic/**`.
- **Synthetic_Catalog**: The committed catalog of about 120 made-up sessions in the real data shape.
- **PassFields**: The pass content schema defined in `packages/contracts/src/pass-fields.ts` per build plan section 5.3.
- **Verdict**: The guardrail outcome type: allow, warn or block, with reasons.
- **MCP_Tool_Schemas**: The zod input and output schemas for every MCP tool listed in build plan section 8.1.
- **Problem_Error**: The Compass API error type using `application/problem+json`: `{type, title, status, code}`.
- **Check_Workflow**: `.github/workflows/check.yml`, the required pull request check.
- **E2E_Workflow**: `.github/workflows/e2e.yml`.
- **Publish_Workflow**: `.github/workflows/publish.yml`.
- **Dependabot_Config**: `.github/dependabot.yml`.
- **Repo_Hooks**: The `.kiro/hooks/**` hooks used while building this repository.
- **SP2_Script**: `spikes/sp2-id-token.mjs`.
- **SP5_Script**: `spikes/sp5-shape-diff.mjs`.
- **Decision_Record**: The ADR at `docs/decisions/ADR-023-events-api-openapi-source.md` recording the provenance of the Events API OpenAPI document.
- **Coverage_Thresholds**: vitest v8 coverage set to 100% for lines, branches, functions and statements, with named exclusions only.

## Requirements

### Requirement 1: npm workspaces monorepo scaffolding and toolchain

**User Story:** As a parallel-stream engineer, I want a fully configured npm workspaces monorepo with every dependency pre-installed and pinned, so that I can build my package the next day without touching root configs or the lockfile.

#### Acceptance Criteria

1. THE Workspace_Scaffold SHALL define npm workspaces for `packages/contracts`, `packages/core`, `packages/mcp-server`, `packages/pass-service` and `site`.
2. THE Workspace_Scaffold SHALL configure TypeScript 6 with `strict` enabled across every workspace.
3. THE Workspace_Scaffold SHALL provide an ESLint flat configuration using typescript-eslint, with angular-eslint prepared for the `site` workspace.
4. THE Workspace_Scaffold SHALL provide a Prettier configuration applied across the Monorepo.
5. THE Workspace_Scaffold SHALL configure vitest 4 with v8 coverage and set Coverage_Thresholds to 100% for lines, branches, functions and statements.
6. THE Workspace_Scaffold SHALL exclude from coverage only `packages/mcp-server/src/bin.ts`, `packages/pass-service/src/lambda-entry/*.ts` and generated types, per build plan section 11.2.
7. THE Workspace_Scaffold SHALL declare, with an exact version pin, each core dependency named in the build plan: zod, openapi-typescript, passkit-generator, aws-jwt-verify, ical-generator, @napi-rs/keyring, @modelcontextprotocol/sdk, Node 24 type definitions, vitest 4, ESLint with its flat config support, typescript-eslint, angular-eslint, Prettier and TypeScript 6.
8. THE Workspace_Scaffold SHALL additionally declare, with an exact version pin, each further dependency derived from build plan sections 3, 8 and 11 and from tech.md: the Angular 22 packages for the `site` workspace, @playwright/test, @axe-core/playwright, esbuild, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, @aws-sdk/client-secrets-manager, google-auth-library, a QR code library, fast-check, and an iCalendar parser for tests such as ical.js.
9. THE Workspace_Scaffold SHALL defer the full dependency list, with each dependency's purpose and its latest stable version checked on npm, to the design document, so that no version number appears in this requirements document.
10. THE Workspace_Scaffold SHALL create, for each workspace, a `package.json`, a TypeScript configuration, a compiling placeholder entry point and a placeholder test.
11. THE Workspace_Scaffold SHALL declare `"engines": {"node": ">=24"}` in the root package manifest.
12. THE Workspace_Scaffold SHALL commit a `.nvmrc` file whose contents are `24`.
13. THE Workspace_Scaffold SHALL record a committed `package-lock.json` consistent with the pinned dependencies.
14. WHEN `tsc -b` is run across the Monorepo, THE Workspace_Scaffold SHALL compile without errors.
15. WHEN `npm test` is run with coverage enabled, THE Workspace_Scaffold SHALL pass with Coverage_Thresholds satisfied.
16. IF any dependency is declared with a version range rather than an exact pin, THEN THE Workspace_Scaffold SHALL be treated as non-compliant and SHALL be corrected to an exact pin.

### Requirement 2: packages/core subpath exports

**User Story:** As a stream owner building inside packages/core, I want empty compiling subpath entry points with no shared barrel file, so that each stream owns its own folder and imports stay stable across packages.

#### Acceptance Criteria

1. THE Core_Package SHALL expose subpath exports `@compass/core/auth`, `@compass/core/api`, `@compass/core/catalog`, `@compass/core/simulated`, `@compass/core/rules`, `@compass/core/scanner`, `@compass/core/spec` and `@compass/core/passes`.
2. THE Core_Package SHALL provide an empty, compiling entry point for each subpath export listed in criterion 1.
3. THE Core_Package SHALL omit any shared barrel file that re-exports across subpaths.
4. THE `@compass/core/rules` subpath SHALL import no Node runtime modules, so that the subpath is importable in a browser.
5. WHEN `tsc -b` is run, THE Core_Package SHALL compile every subpath entry point without errors.
6. IF a subpath entry point other than its declared export is imported through a deep relative path across packages, THEN THE Workspace_Scaffold SHALL report the import as a lint error.

### Requirement 3: Events API OpenAPI retrieval, recording and type generation

**User Story:** As an engineer consuming the Events API, I want the official OpenAPI document committed, provenance-recorded and turned into TypeScript types, so that every stream shares one accurate source for Events API shapes.

#### Acceptance Criteria

1. THE Contracts_Package SHALL commit the Events_API_OpenAPI document, OpenAPI version 3.1.0, fetched from `https://api.awsevents.com/v1/openapi.json`.
2. THE Decision_Record SHALL be the file `docs/decisions/ADR-023-events-api-openapi-source.md` and SHALL record the source URL, the retrieval date and the SHA-256 hash of the committed Events_API_OpenAPI document.
3. THE Contracts_Package SHALL generate TypeScript types from the committed Events_API_OpenAPI document.
4. WHEN `tsc -b` is run, THE generated Events API types SHALL compile without errors.
5. IF the Events_API_OpenAPI document cannot be fetched from the source URL, THEN THE Contracts_Package SHALL surface a descriptive error to the operator and SHALL leave any previously committed document unchanged.

### Requirement 4: Shared zod schemas, inferred types and MCP tool schemas

**User Story:** As a stream owner, I want shared zod schemas and inferred types for every domain object and MCP tool, so that live data and fixtures are parsed defensively against one definition.

#### Acceptance Criteria

1. THE Contracts_Package SHALL define a zod schema and inferred type for Session in which `sessionId` and `title` are both required and every other field is optional, parsed defensively, where the session code field is named `abbreviation`.
2. WHEN a Session value carries unknown extra fields, THE Session schema SHALL accept the value and ignore those fields, so that fields the Events API adds over time do not break parsing.
3. IF a Session field is present with a value of the wrong type, THEN THE Session schema SHALL reject the value rather than coerce it.
4. THE Contracts_Package SHALL include a type-level test asserting that the inferred Session type stays compatible with the Session type generated from the Events_API_OpenAPI document.
5. THE Contracts_Package SHALL define a zod schema and inferred type for Schedule.
6. THE Contracts_Package SHALL define a zod schema and inferred type for Commitment covering a reserved session and personal time.
7. THE Contracts_Package SHALL define a zod schema and inferred type for Venue.
8. THE Contracts_Package SHALL define a zod schema and inferred type for Verdict with the values allow, warn and block, each carrying reasons.
9. THE Contracts_Package SHALL define PassFields in `packages/contracts/src/pass-fields.ts` as the single source, applying the field rules in build plan section 5.3.
10. THE Contracts_Package SHALL define a zod schema and inferred type for Problem_Error with the fields `type`, `title`, `status` and `code`.
11. THE Contracts_Package SHALL define MCP_Tool_Schemas giving an input schema and an output schema for every tool listed in build plan section 8.1.
12. WHEN a value that satisfies a schema is parsed and then re-parsed, THE schema SHALL produce an equivalent value (idempotent parsing).
13. IF a value violates a schema, THEN THE schema SHALL reject the value rather than coerce it to a default.

### Requirement 5: Compass API OpenAPI contract, copies and type generation

**User Story:** As an engineer across the API, infra and client streams, I want one Compass API OpenAPI contract with byte-identical copies and generated types, so that all three streams build against exactly the same contract.

#### Acceptance Criteria

1. THE Compass_API_OpenAPI SHALL be written at `contracts/compass-api.openapi.yaml` as OpenAPI 3.0.1 and SHALL define every route in build plan section 5.2 with its authentication, request shape, response shape and `x-amazon-apigateway` extensions, where the `x-amazon-apigateway` extensions contain no account identifier, no ARN and no account-specific value, and integration URIs use `${...}` placeholders that Terraform fills with `templatefile()`.
2. THE Contracts_Package SHALL hold a byte-identical copy of the Compass_API_OpenAPI at `packages/contracts/openapi.yaml`.
3. THE repository SHALL hold a byte-identical copy of the Compass_API_OpenAPI at `infra/modules/api/openapi.yaml`.
4. THE Hash_Check_Script SHALL compute the SHA-256 hash of each of the three Compass API OpenAPI copies and SHALL compare the three hashes.
5. WHEN the three Compass API OpenAPI copies are byte-identical, THE Hash_Check_Script SHALL exit with a success status.
6. IF any one of the three Compass API OpenAPI copies differs from the others, THEN THE Hash_Check_Script SHALL exit with a failure status and SHALL report which copy differs.
7. THE Placeholder_Safety_Check SHALL run as part of or alongside the Hash_Check_Script and SHALL scan each of the three committed Compass API OpenAPI copies.
8. IF a 12-digit number or an `arn:aws` literal appears in any of the three committed Compass API OpenAPI copies, THEN THE Placeholder_Safety_Check SHALL exit with a failure status and SHALL report which copy contains the match.
9. THE Contracts_Package SHALL generate Compass API TypeScript types from `packages/contracts/openapi.yaml` using openapi-typescript.
10. WHEN `tsc -b` is run, THE generated Compass API types SHALL compile without errors.

### Requirement 6: Synthetic catalog generator and committed catalog

**User Story:** As an engineer writing tests and the public demo, I want a deterministic generator and a committed catalog of about 120 made-up sessions in the real shape, so that tests and the demo never call the live API yet exercise realistic data.

#### Acceptance Criteria

1. THE Synthetic_Catalog_Generator SHALL produce output deterministically, so that two runs with the same inputs produce identical output.
2. THE Synthetic_Catalog SHALL contain about 120 made-up sessions committed under `fixtures/synthetic/**` in the real data shape.
3. THE Synthetic_Catalog SHALL use made-up session titles, speakers and session codes while using the real venue names.
4. THE Synthetic_Catalog SHALL include repeat sessions carrying the `-R` code suffix, all-day items, sessions with missing venues and sessions with missing end times.
5. WHEN each session in the Synthetic_Catalog is parsed with the Session schema from the Contracts_Package, THE Session schema SHALL accept every session, confirming the catalog validates against the same zod schemas used for live data.
6. WHEN the Synthetic_Catalog_Generator is run, THE generated catalog SHALL match the committed Synthetic_Catalog.

### Requirement 7: GitHub workflows and Dependabot

**User Story:** As the integrator, I want pinned, lint-clean GitHub workflows and Dependabot configured per the CI decisions, so that only `main` is guarded, CI stays under budget and no unexpected triggers run.

#### Acceptance Criteria

1. THE Check_Workflow SHALL define one job triggered only on `pull_request` into `main`, running these steps in order per build plan section 11.1: `npm ci`, the contract hash check, the Placeholder_Safety_Check, the Dash_Check_Script, `prettier --check`, `eslint`, `tsc -b`, `vitest --coverage` at 100% thresholds, build, gitleaks, `npm audit --omit=dev --audit-level=high`, `terraform fmt -check`, `terraform validate`, `tflint`, `terraform test`, Trivy filesystem scan, Trivy config scan and shellcheck.
2. THE Check_Workflow SHALL target a run time under 8 minutes.
3. WHEN the Dash_Check_Script step runs, THE Check_Workflow SHALL fail if an em dash or an en dash appears in any tracked text file other than `LICENSE`.
4. WHILE there are no Terraform files to check, THE Terraform steps (`terraform fmt -check`, `terraform validate`, `tflint`, `terraform test`) SHALL pass cleanly as no-ops rather than fail.
5. WHILE there are no shell scripts to check, THE shellcheck step SHALL pass cleanly as a no-op rather than fail.
6. THE E2E_Workflow SHALL be triggered only by `workflow_dispatch`.
7. THE Publish_Workflow SHALL be triggered only by a tag matching `v*` and SHALL publish through npm trusted publishing with provenance.
8. THE Dependabot_Config SHALL schedule updates monthly with `open-pull-requests-limit` set to 0.
9. THE workflow files SHALL pin every GitHub Action by commit SHA.
10. THE workflow files SHALL define no `push` trigger and no `schedule` trigger.
11. WHEN actionlint is run over the workflow files, THE workflow files SHALL lint clean with no reported errors.

### Requirement 8: Repository build hooks

**User Story:** As an engineer building in this repository, I want a save hook that lints and runs the owning package's tests, so that mistakes are caught immediately while I work.

#### Acceptance Criteria

1. THE Repo_Hooks SHALL define a hook under `.kiro/hooks/**` that triggers on save of TypeScript files.
2. WHEN a TypeScript file is saved, THE Repo_Hooks SHALL run lint and SHALL run the tests of the package that owns the saved file.
3. THE Repo_Hooks SHALL run the Dash_Check_Script on save.
4. IF an em dash or an en dash appears in any tracked text file other than `LICENSE`, THEN THE Dash_Check_Script run by the Repo_Hooks SHALL report the failure.

### Requirement 9: SP2 ID token spike script

**User Story:** As the owner running the ID token spike, I want a script that verifies my ID token offline and prints only safe metadata and claim names, so that I confirm verification without ever exposing claim values.

#### Acceptance Criteria

1. WHEN SP2_Script is run after a local sign-in, THE SP2_Script SHALL print only `alg`, `kid`, `iss`, `aud`, `token_use`, `exp` and the names of the claims.
2. THE SP2_Script SHALL never print any claim value.
3. THE SP2_Script SHALL fetch `<iss>/.well-known/openid-configuration` and the JWKS referenced from it.
4. THE SP2_Script SHALL verify the ID token with aws-jwt-verify.
5. IF verification of the ID token fails, THEN THE SP2_Script SHALL report the failure without printing any claim value.
6. THE SP2_Script SHALL keep its input and output wrapper thin and SHALL place its claim-name extraction and redaction logic in tested modules, so that Coverage_Thresholds hold with no new named exclusions.
7. THE Contracts_Package SHALL include a test proving that no claim value is ever printed by the SP2_Script redaction logic.

### Requirement 10: SP5 shape-diff spike script

**User Story:** As the owner running the shape spike, I want a script that compares private recordings against the synthetic catalog and the official OpenAPI and prints only field-level differences, so that I can adjust the contracts without exposing recorded values.

#### Acceptance Criteria

1. THE SP5_Script SHALL compare recordings in the git-ignored `fixtures/.raw/` directory with the Synthetic_Catalog and the Events_API_OpenAPI.
2. THE SP5_Script SHALL print field-level differences only.
3. THE SP5_Script SHALL never print any recorded value.
4. IF the `fixtures/.raw/` directory is absent or empty, THEN THE SP5_Script SHALL report that no recordings are present without error.
5. THE SP5_Script SHALL keep its input and output wrapper thin and SHALL place its field-diff logic in tested modules, so that Coverage_Thresholds hold with no new named exclusions.
6. THE Contracts_Package SHALL include a test proving that no recorded value is ever printed by the SP5_Script field-diff logic.

### Requirement 11: Doc and example-file updates

**User Story:** As a repository maintainer, I want the concept dates and the example files kept current with this spec, so that no stream copies stale dates or a missing example into their own work.

#### Acceptance Criteria

1. IF this spec changes any date referenced in `CONCEPT.md`, THEN THE spec SHALL update the affected date in `CONCEPT.md` in the same change.
2. THE spec SHALL provide a committed `.env.example` file.
3. THE `infra/envs/*/terraform.tfvars.example` file for each environment SHALL be provided by the infra stream (S6), per integrator decision, because S6 owns `infra/**` and its approved requirements define these files against its own variables. This spec does not commit them.
4. THE `cloud.auto.tfbackend.example` file SHALL be provided by the infra stream (S6), per integrator decision, because S6 owns `infra/**` and the backend example uses the KEY=VALUE format read by `release.sh`. This spec does not commit it.
5. THE example files SHALL contain placeholder values only and SHALL contain no secret, token, certificate, key or account identifier value.

### Requirement 12: Foundation acceptance gate

**User Story:** As the integrator preparing the day-1 contract lock, I want a single acceptance gate that confirms the foundation is ready, so that every later stream can start the next day with confidence.

#### Acceptance Criteria

1. WHEN `tsc -b` is run across the Monorepo, THE foundation SHALL compile every package without errors.
2. WHEN `npm test` is run with coverage enabled, THE foundation SHALL pass with Coverage_Thresholds satisfied.
3. WHEN the Hash_Check_Script is run, THE three-way Compass API OpenAPI hash check SHALL pass.
4. WHEN the Placeholder_Safety_Check is run, THE three committed Compass API OpenAPI copies SHALL contain no 12-digit number and no `arn:aws` literal.
5. WHEN a later stream imports a shared type from `@compass/contracts`, THE Contracts_Package SHALL resolve the import against its generated types and schemas.
6. WHEN each session in the Synthetic_Catalog is validated against the live zod schemas, THE Session schema SHALL accept the catalog.
7. WHEN actionlint is run over the workflow files, THE workflow files SHALL lint clean.
8. WHEN the Dash_Check_Script is run, THE foundation SHALL contain no em dash or en dash in any tracked text file other than `LICENSE`.
9. THE foundation SHALL contain no em dash or en dash in copy, comments, test names or commit messages.
10. THE foundation SHALL contain no committed secret, token, certificate, key or account identifier value.
