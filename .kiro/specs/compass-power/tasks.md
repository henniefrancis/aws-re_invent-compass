# Implementation Plan: compass-power (S3)

## Overview

This plan turns the compass-power design into incremental TypeScript steps. It owns `packages/mcp-server/**`, `packages/core/src/{scanner,spec}/**`, `power/**` and `fixtures/sample-repo/**`, with tests under `packages/mcp-server/test/**`, `packages/core/test/scanner/**` and `packages/core/test/spec/**`.

The build order is bottom up: the server's shared seams and test fakes first, then the scanner (discovery, detectors, depth, taxonomy, sample repo), then the planner, the spec renderer and the spec writer, then the server core (registry, results, labelled data, identifier checks, state), the in-process pass service, and the seventeen tool handlers in dependency order, then the cross-cutting security tests, the hooks, the CLI and demo, the Power and the README. After S1, S2 and S4 are merged, task 26 writes the real adapters and task 27 runs the simulated end-to-end acceptance test against the real modules. The boto3 detector is built last (cut-list item 3). Task 29 adjusts the hooks once the owner records the SP1 result. Each step ends integrated; nothing is left orphaned.

Every correctness property from the design (Properties 1 to 43) is implemented with `fast-check` (at least 100 runs), tagged `// Feature: compass-power, Property {n}: {text}`, and placed next to the code it checks. All tests are mandatory; there are no optional tasks, because the definition of done requires 100% coverage.

Conventions followed: kebab-case files, PascalCase types, `Schema` suffix for zod schemas, shared types and the seventeen tool schemas imported from `@compass/contracts` only (never redeclared, `packages/contracts` never edited), other streams reached only through injected ports, vitest 4 with v8 coverage at 100% for S3-owned code (only `packages/mcp-server/src/bin.ts` excluded), no live API in tests, Conventional Commits scoped `compass-power`, no em dashes or en dashes anywhere.

## Execution rules (read before starting)

1. **Tasks run sequentially in numeric order.** Do task 1 fully, then task 2, and so on. There are no parallel waves.
2. **Do each task yourself in this chat.** Do not delegate tasks to the spec-task-execution subagent. Save files after each step.
3. **File ownership is strict.** Every file you touch must be under `packages/mcp-server/**`, `packages/core/src/{scanner,spec}/**`, `packages/core/test/{scanner,spec}/**`, `power/**`, `fixtures/sample-repo/**`, `docs/article/screenshots/compass-power/**` or `.kiro/specs/compass-power/`. Never edit `packages/contracts/**`, `contracts/**`, `data/venues.json`, `fixtures/synthetic/**`, other streams' folders in `packages/core/src`, root configs, `package.json` or `package-lock.json`. If you need a dependency, a package.json change or a contract change, stop and tell the owner; do not run `npm install`. The known integrator requests are listed in the Notes.
4. **Each top-level task ends with a local commit, made only after that task's tests pass** (`npm test` green) and after `npx eslint .` and `npx prettier --check .` both pass with zero errors. Use Conventional Commits with scope `compass-power`, subject and body passed with multiple `-m` flags (for example `git commit -m "feat(compass-power): add gitignore matcher" -m "Body text."`), never a commit message file. Do not add any Co-Authored-By trailer or any Claude or AI attribution. Never push, merge, open a PR or tag. The first commit (task 1) also includes `.kiro/specs/compass-power/`.
5. **Other streams are mocked until merged.** Write against the port interfaces in the design with fakes in `packages/mcp-server/test/support/`. Never import unmerged S1, S2 or S4 code. Task 26 runs only after S1, S2 and S4 are merged into `develop` and this branch is rebased; if any is not merged when you reach it, stop and ask the owner.
6. **Never call the live Events API or the live Compass API.** Tests run with `COMPASS_MODE=simulated` (set by the root vitest config) and a network guard. Live checks run only with `COMPASS_LIVE_TESTS=1`, set by the owner, and you never run them.
7. **Never write tracked fixtures from a test.** Copy `fixtures/sample-repo` to an `fs.mkdtemp` folder before adding decoys or writing spec output.
8. `fast-check` 4.10.2, `vitest` 4.1.12, `@modelcontextprotocol/sdk` 1.32.1 and `zod` 4.6.7 are already pinned and declared.
9. **Task 29 runs only after the owner records SP1 in `docs/decisions/ADR-024`.** If it is not there when you reach task 29, stop and ask the owner.

## Tasks

- [x] 1. Establish the server's shared seams and test fakes
  - [x] 1.1 Define the ports and the runtime
    - Create `packages/mcp-server/src/ports/` with `runtime.ts` (`Runtime`), `events-port.ts` (`EventsPort`, `CatalogView`), `rules-port.ts` (`RulesPort`, `ConnectionLine`, `EnergyLine`), `passes-port.ts` (`PassesPort`), `clock.ts` (`Clock`), `logger.ts` (`Logger` interface) and `fs-ports.ts`, exactly as in design Components 6 and 10, importing shared types from `@compass/contracts` only
    - Add `src/node-types.d.ts` with a triple-slash reference to the Node types if the package tsconfig does not load them (as S4 recorded)
    - _Requirements: 23.1, 23.4_
  - [x] 1.2 Implement the stderr logger and the configuration module
    - Create `src/logging/stderr-logger.ts`: writes only to an injected stderr stream, never stdout, and passes every line through a redaction function (a local implementation now; task 26 swaps in S1's redacting logger and S4 `redact`)
    - Create `src/config/runtime-config.ts` reading `COMPASS_MODE` and `COMPASS_API_URL`, and `src/config/compass-api.ts` holding the single live base URL constant (placeholder until the integrator sets it)
    - _Requirements: 8.6, 17.2, 22.1_
  - [x] 1.3 Write the test fakes and the network guard
    - Create `packages/mcp-server/test/support/` with recording fakes for every port (each records calls and can be scripted to return results or throw typed errors), a fake catalog builder from `SessionWire`-shaped sessions drawn from `fixtures/synthetic/catalog.json` (read-only), a fixed clock, and a global network guard that fails any `fetch` or socket use
    - _Requirements: 23.1, 25.7_
  - [x] 1.4 Write unit tests for the logger and configuration
    - Logger never writes to stdout and redacts token-shaped, email-shaped and URL values; configuration reads the mode and URL override
    - _Requirements: 8.6, 17.2_
  - [x] 1.5 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Include `.kiro/specs/compass-power/` in this first commit. Verify every edit landed. Never push.

- [x] 2. Build scanner discovery: read-only file access, gitignore and the walker
  - [x] 2.1 Implement the read-only scan file system
    - Create `packages/core/src/scanner/scan-fs.ts` with the `ScanFs` interface (no write, rename, delete or mkdir member) and `createNodeScanFs()` over `node:fs/promises` using `lstat`, opening files with flag `r` and reading at most the requested bytes
    - _Requirements: 1.1, 1.2, 1.6_
  - [x] 2.2 Implement the gitignore matcher
    - Create `src/scanner/gitignore.ts` with `parseGitignore` and `isIgnored`: comments, blank lines, trailing-space trimming, `\` escapes, negation, directory-only rules, anchoring by a leading or middle `/`, `*`, `**`, `?`, character classes, last match wins
    - _Requirements: 1.4_
  - [x] 2.3 Write property test for the gitignore matcher
    - **Property 1: The gitignore matcher follows last-matching-rule semantics**
    - **Validates: Requirements 1.4**
  - [x] 2.4 Implement the walker and file filter
    - Create `src/scanner/file-filter.ts` (supported extensions and names, excluded directory names) and `src/scanner/walker.ts` (no symlink following, nested `.gitignore` rules, never descending into an ignored directory, 1 MiB size limit, 8 KiB NUL probe, 20,000 file cap with `truncated`, skip counts by reason, repository-level production marker); file names and paths stay inside the walker
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [x] 2.5 Write property test for read-only access
    - **Property 3: The scanner never writes**
    - **Validates: Requirements 1.2**
  - [x] 2.6 Write property test for the file cap
    - **Property 4: The file cap is exact**
    - **Validates: Requirements 1.7**
  - [x] 2.7 Write unit tests for discovery edge cases
    - Missing path and file path give "folder not found" without echoing the path; nested `.gitignore` with negation; symlink counted as skipped; empty tree
    - _Requirements: 1.1, 1.4, 1.6_
  - [x] 2.8 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 3. Build the service table and the Terraform, CDK, SDK and manifest detectors
  - [x] 3.1 Implement the service table
    - Create `src/scanner/service-table.ts` with `SERVICE_TABLE` (about 25 services as listed in design Component 1) and `resolveService(kind, identifier)` with longest-prefix matching for Terraform types
    - Check every Terraform prefix, CDK module name, SDK package name and boto3 service name against its official source (Terraform AWS provider docs on the Terraform Registry, AWS CDK API reference, AWS SDK for JavaScript v3 API reference, boto3 docs) and use official AWS display names; taxonomy candidates are the display name plus the synthetic category tokens from `fixtures/synthetic/generate.ts`
    - _Requirements: 4.1, 4.3, 4.4_
  - [x] 3.2 Write structural tests for the service table
    - Keys unique; every entry has a display name, at least one identifier and at least one taxonomy candidate; every identifier resolves to exactly one key
    - _Requirements: 4.1, 4.3, 4.4_
  - [x] 3.3 Implement the Terraform detector
    - Create `src/scanner/detectors/terraform.ts`: whole-line `#` and `//` comments removed, `resource` and `data` blocks with `aws_` types counted, unmapped types counted as unmapped; hits carry no location
    - _Requirements: 2.1, 2.6_
  - [x] 3.4 Write property test for the Terraform detector
    - **Property 5: The Terraform detector counts exactly the declared AWS blocks**
    - **Validates: Requirements 2.1, 2.6**
  - [x] 3.5 Implement the CDK TypeScript detector
    - Create `src/scanner/detectors/cdk-typescript.ts`: imports from `aws-cdk-lib/aws-<module>` and `aws_<module>` namespaces of `aws-cdk-lib`, aliases tracked per file, constructs counted per instantiation from a CDK module
    - _Requirements: 2.2, 2.6_
  - [x] 3.6 Write property test for the CDK detector
    - **Property 6: The CDK detector counts imports and constructs from CDK modules only**
    - **Validates: Requirements 2.2, 2.6**
  - [x] 3.7 Implement the SDK for JavaScript v3 detector
    - Create `src/scanner/detectors/sdk-js-v3.ts`: `@aws-sdk/client-*` imports and requires (plus `lib-dynamodb` and `lib-storage`), `new <Name>Client(` and `new <Name>Command(` counted with the documented attribution rule
    - _Requirements: 2.3, 2.6_
  - [x] 3.8 Write property test for the SDK detector
    - **Property 7: The SDK for JavaScript v3 detector counts client packages, clients and commands**
    - **Validates: Requirements 2.3, 2.6**
  - [x] 3.9 Implement the manifest detector
    - Create `src/scanner/detectors/manifests.ts` for `package.json` dependencies and devDependencies and `requirements.txt` lines; a malformed `package.json` counts nothing and does not throw
    - _Requirements: 2.5_
  - [x] 3.10 Write property test for manifests
    - **Property 9: Dependency declarations are counted from manifests**
    - **Validates: Requirements 2.5**
  - [x] 3.11 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 4. Build evidence, depth, level, reasoning, taxonomy and the scanRepo entry
  - [x] 4.1 Implement evidence aggregation, depth and level
    - Create `src/scanner/evidence.ts`, `depth.ts` (`classifyDepth`, `suggestLevel`, `depthToNumber` with the rule and level tables from design Component 1)
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 4.2 Write property test for depth and level
    - **Property 10: Depth follows the documented rules and never drops as evidence grows**
    - **Validates: Requirements 3.2, 3.3**
  - [x] 4.3 Implement the reasoning sentence
    - Create `src/scanner/reasoning.ts` (`explain`): plain English, names counts, depth and level, no em or en dash, no sentence over 25 words, never a file name
    - _Requirements: 3.4_
  - [x] 4.4 Write property test for reasoning
    - **Property 13: Reasoning is plain English that states the counts**
    - **Validates: Requirements 3.4**
  - [x] 4.5 Implement scanRepo and the taxonomy mapping
    - Create `src/scanner/scan-repo.ts` (walk, run detectors, aggregate per service, sort by key, `pythonAnalysed: false` while boto3 is not built), `src/scanner/taxonomy.ts` (`mapToTaxonomy`, case-insensitive, catalog spelling returned) and `src/scanner/index.ts` exporting the public surface by name
    - _Requirements: 2.7, 3.1, 3.5, 3.6, 4.2_
  - [x] 4.6 Write property test for exclusions
    - **Property 2: Excluded paths never contribute evidence**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.8**
  - [x] 4.7 Write property test for order independence
    - **Property 11: Scan results do not depend on listing order**
    - **Validates: Requirements 3.6**
  - [x] 4.8 Write property test for taxonomy matching
    - **Property 15: Taxonomy labels are always taken from the catalog**
    - **Validates: Requirements 4.2**
  - [x] 4.9 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 5. Create the sample repo and the scanner fixture tests
  - [x] 5.1 Create `fixtures/sample-repo/`
    - A small made-up project: Terraform with `aws_s3_bucket`, `aws_lambda_function` and `aws_dynamodb_table`; CDK TypeScript using `aws-cdk-lib/aws-sqs`; SDK v3 code importing `@aws-sdk/client-s3` and `@aws-sdk/client-dynamodb` and sending commands; a Python file using boto3; `package.json` and `requirements.txt`; a `.gitignore` with one ignored folder; a README stating it is sample data. No secrets, keys or real account ids. Add a note to the task notes asking the integrator to exclude it from ESLint and `tsc`
    - _Requirements: 25.3_
  - [x] 5.2 Write the scanner fixture tests
    - Scan the sample repo and assert services, evidence, depths and levels; copy it to a temp folder, add decoys (a `node_modules` folder, a file in the ignored folder, a 2 MiB file, a binary file, a symlink where the OS allows) and assert they contribute nothing; never write into the tracked fixture
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 25.3_
  - [x] 5.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 6. Checkpoint: ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Build the week planner
  - [x] 7.1 Implement the planner
    - Create `packages/core/src/spec/planner.ts` with `planWeek(input, rules)` and `eventDay` per design Component 2: usable-time filter with the excluded count, documented ranking and tie-break, day cap, guardrail via the injected `PlannerRules`, reasons of 1 to 200 characters, one standby at most, walk-up marking, layover suggestions, commitments that parse with `CommitmentSchema`; no write port exists
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
  - [x] 7.2 Write property test for day cap, guardrail and usable times
    - **Property 16: Planned picks respect the day cap, the guardrail and usable times**
    - **Validates: Requirements 5.1, 5.3, 5.4, 5.10**
  - [x] 7.3 Write property test for determinism and ranking
    - **Property 17: Planning is deterministic and ranked as documented**
    - **Validates: Requirements 5.2**
  - [x] 7.4 Write property test for reasons, standby and walk-up
    - **Property 18: Every pick carries a valid reason, at most one standby and the walk-up mark**
    - **Validates: Requirements 5.5, 5.7, 5.8**
  - [x] 7.5 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 8. Build the week spec renderer
  - [x] 8.1 Implement the renderer
    - Create `src/spec/render.ts` with `renderWeekSpec`, `sanitiseCatalogText` and `formatLocal` per design Component 3: EARS goals, itinerary by day with code, quoted title, type, level, gate or "Venue not published", times, boarding closes, reason, connection, layovers and energy; one task per API action naming its tool; final "Issue boarding passes" task; timezone stated once; scan summary limited to display names and depth
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  - [x] 8.2 Write property test for tasks
    - **Property 20: Spec tasks match the API actions, ending with issue**
    - **Validates: Requirements 6.3**
  - [x] 8.3 Write property test for catalog text sanitisation
    - **Property 21: Catalog text cannot change the spec's structure**
    - **Validates: Requirements 6.4, 6.8**
  - [x] 8.4 Write property test for determinism and local time
    - **Property 22: Spec rendering is deterministic and time-honest**
    - **Validates: Requirements 6.6, 6.7**
  - [x] 8.5 Write a snapshot test for a representative week
    - A fixed plan with a tight connection, an unknown venue, a walk-up keynote, a layover and an overloaded day
    - _Requirements: 6.1, 6.2_
  - [x] 8.6 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 9. Build the spec writer, the line diff and the gitignore entry
  - [x] 9.1 Implement the line diff
    - Create `src/spec/diff.ts` with `lineDiff` (longest common subsequence, `+ `, `- `, `  ` prefixes, at most 400 lines with `truncated`) and `applyDiff`
    - _Requirements: 7.2_
  - [x] 9.2 Implement the writer and the gitignore helpers
    - Create `src/spec/write.ts` (`writeWeekSpec`, allowed write set enforced, first run creates three files, re-run writes `week-<YYYY-MM-DD>[-n].md` and returns the diff, refuses a missing root) and `src/spec/gitignore-entry.ts` (`isWeekSpecIgnored` using the scanner matcher, `addWeekSpecToGitignore`), plus `src/spec/index.ts` exporting the public surface by name
    - _Requirements: 7.1, 7.2, 7.3, 7.7_
  - [x] 9.3 Write property test for re-runs and the diff
    - **Property 23: Re-planning never overwrites and the diff is faithful**
    - **Validates: Requirements 7.1, 7.2**
  - [x] 9.4 Write property test for the gitignore entry
    - **Property 24: Adding the gitignore entry is idempotent and preserving**
    - **Validates: Requirements 7.7**
  - [x] 9.5 Write unit tests for refused writes
    - Missing root; a path outside the allowed set is refused
    - _Requirements: 7.3_
  - [x] 9.6 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 10. Checkpoint: ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Build the server core
  - [x] 11.1 Implement labelled data and identifier checks
    - Create `src/safety/labelled-data.ts` (`DATA_PREAMBLE`, `labelUntrusted`), `src/safety/identifiers.ts` (`checkIdentifier`, `checkIdentifiers` whose message never echoes a value) and `src/safety/targets.ts` (`describeTargets` using `CatalogView` only)
    - _Requirements: 10.1, 11.1, 11.2, 11.3, 11.4_
  - [x] 11.2 Write property test for labelled data
    - **Property 27: Labelled data round-trips and never carries an abstract**
    - **Validates: Requirements 10.1, 10.2, 14.6**
  - [x] 11.3 Write property test for identifier checks
    - **Property 28: Identifier checks run before any S1 call**
    - **Validates: Requirements 11.1, 11.2**
  - [x] 11.4 Implement the registry, descriptions, results and error messages
    - Create `src/server/tool-registry.ts` (`TOOL_SPECS` exhaustive over `McpToolName`, classes and annotations from design Component 5), `descriptions.ts` (the "real change" sentences), `results.ts` (parse success output with `mcpTools[k].output`; failures as `isError: true`, text only), `error-messages.ts` (the fixed table from design Error Handling) and `create-server.ts` (`createCompassServer` registering every `mcpTools` key with its contract schemas; `runStdioServer` with `StdioServerTransport`; nothing loaded at initialisation; `elicit` only when the client declares Elicitation)
    - Register handlers as "not built yet" stubs that return a fixed `isError` result; later tasks replace each stub
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 17.1, 17.3_
  - [x] 11.5 Implement session state and the schedule snapshot store
    - Create `src/state/session-state.ts` and `src/state/schedule-snapshot.ts` (atomic temp then rename, file `0o600`, directory `0o700`, `simulated/` subfolder in simulated mode, no token or email field)
    - _Requirements: 12.8, 16.4, 16.5_
  - [x] 11.6 Write unit tests for the registry and the server
    - Registered names equal `Object.keys(mcpTools)`; annotations and description sentences per class; initialisation touches no port; snapshot write, read, remove and mode (mode asserted on POSIX only)
    - _Requirements: 8.2, 8.3, 8.4, 8.8, 16.4_
  - [x] 11.7 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 12. Build the in-process pass service and the simulated runtime shell
  - [x] 12.1 Implement the in-process pass service
    - Create `src/simulated/in-process-pass-service.ts` serving issue, update, void, hand-off create and forget me over the S4 `HttpTransport` shape, typed against `CompassApi`, validating pass fields with `createPassFieldsSchema`, `randomUUID` serials, 16-byte base64url hand-off ids, 15-minute expiry, board URL `https://compass.invalid/board#h=<id>`, idempotent void, problem+json errors, no socket
    - _Requirements: 22.2, 22.3, 22.4_
  - [x] 12.2 Write property test for the pass service
    - **Property 42: The in-process pass service keeps the contract's invariants**
    - **Validates: Requirements 22.2, 22.3, 22.4**
  - [x] 12.3 Implement the simulated runtime factory over ports
    - Create `src/simulated/simulated-runtime.ts` that composes a `Runtime` from injected port implementations, the pass service and the `simulated/` app-data subfolder; the real S1, S2 and S4 adapters are plugged in at task 26
    - _Requirements: 16.5, 22.1, 23.1_
  - [x] 12.4 Implement the production transport and file system adapters
    - `src/adapters/fetch-transport.ts` (https only, timeout, `redirect: 'error'`, binary bodies, `fetch` injected) and `src/adapters/node-fs-adapter.ts` (files `0o600`, directories `0o700`, POSIX modes ignored on Windows and documented), with unit tests
    - _Requirements: 17.2, 22.1, 23.1_
  - [x] 12.5 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 13. Build the session and catalog tools
  - [x] 13.1 Implement sign_in, sign_out, refresh_catalog and find_sessions
    - One file each in `src/tools/`: `sign-in.ts` (memory-only notice), `sign-out.ts` (sign-out URL in text), `refresh-catalog.ts` (count and time), `find-sessions.ts` (local filter, limit default 20 and maximum 50, `totalMatched` before the limit, Labelled_Data_Block text); the not-signed-in error from the fixed table; simulated runtime signed in at once
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2_
  - [x] 13.2 Write unit tests for the session and catalog tools
    - Each tool against fakes, including not signed in, missing catalog and limit clamping
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [x] 13.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 14. Build scan_repo, plan_week and check_itinerary
  - [x] 14.1 Implement scan_repo
    - `src/tools/scan-repo.ts`: run `scanRepo` with `runtime.scanFs`, store the result and taxonomy matches in session state, set the Workspace_Root, map to the contract output (display names, depth 0 to 3), text with depth, level, reasoning and catalog labels
    - _Requirements: 3.7, 4.2, 10.5_
  - [x] 14.2 Write property test for the scan_repo output
    - **Property 14: scan_repo output encodes depth as the contract expects**
    - **Validates: Requirements 3.7**
  - [x] 14.3 Implement plan_week with the gitignore offer
    - `src/tools/plan-week.ts`: validate `maxPerDay` (1 to 8, default 4), read catalog, fresh schedule and window, `planWeek` with a `PlannerRules` bound from `RulesPort`, connections and energy from `RulesPort`, `renderWeekSpec`, `writeWeekSpec` at the Workspace_Root, then the gitignore offer through `elicit` or text
    - _Requirements: 5.3, 7.1, 7.2, 7.4, 7.5, 7.6, 10.1_
  - [x] 14.4 Write property test for gitignore consent
    - **Property 25: .gitignore changes only on an explicit accept**
    - **Validates: Requirements 7.4, 7.5, 7.6**
  - [x] 14.5 Write property test that nothing from files leaks
    - **Property 12: No file name, path or content leaves the scanner**
    - **Validates: Requirements 3.5, 6.5, 10.5**
  - [x] 14.6 Implement check_itinerary
    - `src/tools/check-itinerary.ts`: identifier checks, fresh schedule, `guardBatch` over the proposed commitments plus the confirmed schedule (written in task 15.1; implement `guardBatch` and `combineVerdicts` here first if needed and keep them in `src/guardrail/`), suggestions on block, text listing ids, codes and catalog titles
    - _Requirements: 10.3, 11.1, 11.4, 12.2_
  - [x] 14.7 Write unit tests for the three tools
    - Re-run produces the dated file and diff; elicitation present and absent; check_itinerary with clash, tight connection and missing venue
    - _Requirements: 7.2, 7.5, 7.6, 12.2_
  - [x] 14.8 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 15. Build the guardrail orchestration and reserve_with_guardrails
  - [x] 15.1 Implement verdict combination, batch guard and suggestions
    - `src/guardrail/combine-verdicts.ts`, `reserve-guard.ts` (`guardBatch`, each candidate against the confirmed schedule plus earlier candidates), `suggestions.ts` (`suggestForBlock`: repeats of the blocked session, and a safe swap for a clashing reservation whose repeat passes against "confirmed minus original plus blocked")
    - _Requirements: 12.2, 12.3, 13.1_
  - [x] 15.2 Write property test for verdict combination
    - **Property 30: Verdict combination follows severity precedence**
    - **Validates: Requirements 12.2**
  - [x] 15.3 Implement reserve_with_guardrails
    - `src/tools/reserve-with-guardrails.ts`: identifier checks, catalog lookup (unknown ids refused), fresh schedule, `guardBatch`; block returns the verdict, rebooking options and the swap suggestion (recorded in the ledger) with no write; allow or warn sends `events.reserve` once through the confirmed write, reports per session against the confirmed schedule (refusals and unrecognised codes as not reserved, full sessions with rebooking options, unconfirmed writes as unconfirmed), puts warnings first, updates the snapshot, and lists ids, codes and catalog titles
    - _Requirements: 11.3, 11.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 13.1_
  - [x] 15.4 Write unit tests for reserve
    - Batch with an internal clash; full session with a repeat; unknown failure code; unconfirmed write; rate limit reports the wait and does not retry
    - _Requirements: 12.3, 12.5, 12.6, 17.4_
  - [x] 15.5 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 16. Build cancel_reservation and the swap ledger
  - [x] 16.1 Implement the swap ledger
    - `src/guardrail/swap-ledger.ts` (`createSwapLedger`): in memory only; propose, look up by original, mark refused, clear, clear all
    - _Requirements: 13.1, 13.7_
  - [x] 16.2 Implement cancel_reservation
    - `src/tools/cancel-reservation.ts`: identifier check, fresh schedule, refuse a session that is not reserved, Pending_Swap path through `RulesPort.planSafeSwap` (cancel only when safe; first failed or unsafe call refuses and marks refused; second call drops the swap and cancels), one confirmed `events.cancel`, `cancelled: true` only when the schedule confirms, sync reminder when an issued pass exists, snapshot update
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_
  - [x] 16.3 Write property test for the swap ledger
    - **Property 33: The swap ledger never risks both seats**
    - **Validates: Requirements 13.2, 13.3, 13.4, 13.7**
  - [x] 16.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 17. Build add_standby, remove_standby and add_layover
  - [x] 17.1 Implement the standby tools
    - `src/tools/add-standby.ts` and `remove-standby.ts`: identifier checks, catalog lookup, one confirmed write each, results confirmed against `schedule.favorites`, the "standby is a backup, not a reservation" line
    - _Requirements: 11.4, 14.1, 14.2_
  - [x] 17.2 Implement add_layover
    - `src/tools/add-layover.ts`: offset, order and window validation before any call, overlap warning through `RulesPort.findClashes`, one confirmed `events.createPersonalTime`, `personalTimeId` from the matching confirmed entry, title shown only as attendee labelled data; written around an internal create, update or delete action union so the S0 change in Open Question 3 is a schema swap
    - _Requirements: 14.3, 14.4, 14.5, 14.6_
  - [x] 17.3 Write property test for exactly-once writes
    - **Property 31: A block sends nothing and an allow sends exactly once**
    - **Validates: Requirements 12.3, 12.4, 13.6, 14.1, 14.2, 14.3, 17.4**
  - [x] 17.4 Write property test for confirmed reporting
    - **Property 32: Success is reported only when the schedule confirms it**
    - **Validates: Requirements 12.5, 12.6, 13.6, 14.2, 14.3**
  - [x] 17.5 Write property test for layover validation
    - **Property 34: Invalid layovers never reach S1**
    - **Validates: Requirements 14.4**
  - [x] 17.6 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 18. Build the boarding pass tools
  - [x] 18.1 Implement issue_boarding_passes and send_to_phone
    - `src/tools/issue-boarding-passes.ts`: identifier checks, catalog lookup, fresh schedule, non-reserved ids refused with no pass call, `events.getSession` per id, `passes.issue`, disclaimer text, no claim of deletion from a phone
    - `src/tools/send-to-phone.ts`: ids to codes through the catalog, codes to serials through `passes.issuedRecord()` (all issued when none given), error when none issued, `passes.handoff`, text QR and expiry in text, PNG as an image content item, the URL never logged
    - _Requirements: 11.4, 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x] 18.2 Implement sync_passes and export_calendar
    - `src/tools/sync-passes.ts`: fresh schedule, reserved ids resolved through the catalog, narrowing applied to both sides before `passes.sync`, void text says the pass moves to expired passes
    - `src/tools/export-calendar.ts`: given commitments or the confirmed schedule, `passes.exportCalendar`, `ics` returned
    - _Requirements: 15.3, 15.6, 15.7, 15.8_
  - [x] 18.3 Write property test for issue
    - **Property 35: Passes are issued only for confirmed reservations**
    - **Validates: Requirements 15.1**
  - [x] 18.4 Write property test for narrowed sync
    - **Property 36: A narrowed sync never touches other passes**
    - **Validates: Requirements 15.7**
  - [x] 18.5 Write property test for catalog-sourced targets
    - **Property 29: Write tools show catalog titles, never model text**
    - **Validates: Requirements 11.3, 11.4**
  - [x] 18.6 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 19. Build forget_me
  - [x] 19.1 Implement forget_me
    - `src/tools/forget-me.ts`: `confirm: true` from the contract, `passes.forgetMe()`, then on success only delete the snapshot and clear the scan and swaps; success text says passes were voided and will expire; failure text says nothing was deleted
    - _Requirements: 16.1, 16.2, 16.3_
  - [x] 19.2 Write unit tests for forget_me
    - Success removes local state; failure keeps it; copy never claims phone deletion
    - _Requirements: 16.1, 16.2, 16.3_
  - [x] 19.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 20. Checkpoint: ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Write the cross-cutting contract and security tests
  - [x] 21.1 Write property test for tool results against the contract
    - **Property 26: Every tool result matches its contract**
    - **Validates: Requirements 3.7, 8.2, 8.5, 17.1**
  - [x] 21.2 Write property test that read-side handlers never write
    - **Property 19: Read-side handlers never write**
    - **Validates: Requirements 5.9, 8.7, 10.3, 10.4**
  - [x] 21.3 Write property test for secrets
    - **Property 37: No secret reaches logs or errors**
    - **Validates: Requirements 17.2, 17.3**
  - [x] 21.4 Write property test for simulated mode and the network
    - **Property 43: Simulated mode never touches the network**
    - **Validates: Requirements 18.2, 22.1**
  - [x] 21.5 Write the required prompt-injection test
    - A catalog session whose title and abstract tell the agent to book everything; run `find_sessions`, `plan_week` and `check_itinerary`; assert zero writes, the title only inside the Labelled_Data_Block, no abstract text anywhere
    - _Requirements: 10.2, 10.3, 10.4, 25.4_
  - [x] 21.6 Write the required security scenario and the stdout test
    - Sign-in, a failing reserve, a failing issue and a hand-off with secret needles, asserting no needle in stderr or error text; every tool run writes nothing to stdout outside the MCP transport
    - _Requirements: 8.6, 17.2, 17.3_
  - [x] 21.7 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 22. Build the hook runner
  - [x] 22.1 Implement hook input, tool names and the exit policy
    - `src/hooks/read-stdin.ts` (1 MiB, 5 seconds), `hook-input.ts` (`HookInputSchema`, zod, unknown fields stripped), `tool-names.ts` (`identifyTool` for `mcp_<server>_<tool>` and bare names), `exit-policy.ts` (the only map from decision kind to exit code 0 or 2)
    - _Requirements: 18.4, 18.5, 19.6, 24.2_
  - [x] 22.2 Write property test for tool names
    - **Property 38: Hook tool names resolve whatever the server prefix**
    - **Validates: Requirements 19.6**
  - [x] 22.3 Implement the pre-write guardrail and the post-write sync hooks
    - `src/hooks/pre-write-guardrail.ts` per the design decision table (snapshot and catalog through ports, same `RulesPort.checkReservation` path, catalog titles in warnings, stale after 15 minutes, no write and no network) and `src/hooks/post-write-sync.ts` (reminder for schedule writes only)
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.7_
  - [x] 22.4 Write property test for the decision table
    - **Property 39: The hook decision table is exact**
    - **Validates: Requirements 18.5, 19.1, 19.2, 19.3, 19.4**
  - [x] 22.5 Write property test for fail-open input handling
    - **Property 40: The hook fails open on any input**
    - **Validates: Requirements 18.4, 18.5, 19.3**
  - [x] 22.6 Write property test for the sync reminder
    - **Property 41: The sync reminder follows schedule writes only**
    - **Validates: Requirements 19.5**
  - [x] 22.7 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 23. Build the CLI and the demo
  - [x] 23.1 Implement runCli and bin.ts
    - `src/cli/run-cli.ts` with `node:util` `parseArgs`: no arguments starts the stdio server, `demo [--repo <path>]`, `hook <name>` (fixed names, stdin only, no shell, no subprocess, exit 0 or 2), `--version`, `--help`, unknown commands print usage to stderr and exit 1; `src/bin.ts` with only the process wiring and the `#!/usr/bin/env node` line; `src/index.ts` exporting `createCompassServer`, `runCli` and `runDemo`
    - _Requirements: 18.1, 18.4, 18.5, 18.6, 18.7, 18.8_
  - [x] 23.2 Implement the demo script
    - `src/demo/run-demo.ts`: force simulated mode, connect an in-memory MCP client to `createCompassServer`, run the ten steps through real tool calls (scan the sample repo, plan, blocked clash, safe swap, reserve, issue, QR hand-off, cancel, void), print a heading and one plain-English line per step, the block reasons, the swap steps and the terminal QR; exit 0, or print the failing step and exit 1
    - _Requirements: 18.2, 18.3_
  - [x] 23.3 Write unit tests for the CLI and the demo with fake runtimes
    - Every command and exit code; demo step order and failure reporting; `hook` never spawns a process (spy on `node:child_process`)
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_
  - [x] 23.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 24. Build the Kiro Power
  - [x] 24.1 Write plugin.json, mcp.json and the hook template
    - `power/plugin.json`, `power/mcp.json` and `power/hook-templates/reinvent-compass.json` exactly as in design Component 14, with the literal package version from `packages/mcp-server/package.json`
    - _Requirements: 20.1, 20.2, 20.6, 20.7_
  - [x] 24.2 Write the three skills
    - `power/skills/plan-my-week/SKILL.md`, `power/skills/first-timer-guide/SKILL.md` with `references/official-sources.md`, `power/skills/install-hooks/SKILL.md`, each with `name` and `description` front matter, content per design Component 14
    - For `first-timer-guide`, open every official page you cite and record its exact URL; use only `reinvent.awsevents.com`, `aws.amazon.com` and `docs.aws.amazon.com`; never guess a URL
    - _Requirements: 20.3, 20.4, 20.5, 20.8_
  - [x] 24.3 Write the Power structural tests
    - In `packages/mcp-server/test/power/`: plugin and MCP files parse against local zod schemas mirroring the quoted Agent Plugins fields and the documented Kiro keys; exact keywords; versions equal across the three files and the package; `disabledTools` equals the seven Awsevents_Write_Tools; no write tool in any `autoApprove`; matchers cover exactly the documented sets with no `{{`; every cited URL uses an allowed host; no em or en dash and no AWS logo file under `power/`
    - _Requirements: 20.1, 20.2, 20.4, 20.6, 20.7, 20.8_
  - [x] 24.4 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 25. Write the package README
  - [x] 25.1 Write `packages/mcp-server/README.md`
    - Sections per design Component 15; setup for Kiro, Claude Desktop, VS Code and the Kiro CLI, each in that client's documented format with a link to its official MCP documentation that you open and check while writing; hooks are Kiro-only and the server guardrail runs regardless; the four Read_Tools that may be auto-approved and that write tools must never be; simulated mode and `demo`; what leaves the machine; the depth rules
    - _Requirements: 21.1, 21.2, 21.3, 21.4_
  - [x] 25.2 Commit
    - After `npx eslint .` and `npx prettier --check .` both pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 26. Integrate the merged S1, S2 and S4 modules
  - [x] 26.1 Implement the real adapters and createRuntime
    - Only after S1, S2 and S4 are merged into `develop` and this branch is rebased (otherwise stop and ask). In `src/adapters/`, implement `EventsPort` over the S1 auth, api, catalog and simulated exports, `RulesPort` over the S2 rules exports with the context built through `ContextSchema` from the clock, the event window and `data/venues.json`, and `PassesPort` over the S4 passes exports with the in-process pass service in simulated mode; wrap S1's `getIdTokenForCompassApi` as S4's `getIdToken`; apply the identifier check before every S1 call that takes an id (including the event id); swap the logger's redaction for S1's redacting logger and S4 `redact`; implement `src/runtime/create-runtime.ts` selecting live or simulated
    - Record any interface that differs from the design (for example S2 not exporting a resolver, or S4 hand-off fields) in a "Deviations recorded with task 26" paragraph in design.md and follow Open Questions 5 and 6
    - _Requirements: 11.1, 23.1, 23.2, 23.3, 23.4, 23.5_
  - [x] 26.2 Write adapter tests against the real modules
    - Each adapter in simulated mode with the real S1 simulated transport, the real S2 rules and the real S4 modules; the ID token never reaches the Events transport
    - _Requirements: 23.2, 23.5_
  - [x] 26.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 27. Run the simulated end-to-end acceptance test
  - [x] 27.1 Write the full-flow acceptance test
    - `packages/mcp-server/test/e2e/full-flow.test.ts` per the design Testing Strategy: in-memory MCP client, real modules, In_Process_Pass_Service, a deterministic helper choosing sessions A, A-R and B from the synthetic catalog; steps sign in, refresh, scan the temp sample copy, plan, reserve A, blocked clash on B with zero ReserveSessions, reserve A-R, cancel A as a completed swap, reserve B, issue for A-R and B, send to phone, cancel B, sync with B voided, forget me
    - _Requirements: 25.1, 25.7_
  - [x] 27.2 Write the demo acceptance test
    - Run `runCli(['demo', '--repo', <temp sample copy>])` with the real simulated runtime; assert exit 0 and the ten step headings in order
    - _Requirements: 18.2, 18.3, 25.2_
  - [x] 27.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 28. Build the boto3 detector (cut-list item 3, last)
  - [x] 28.1 Implement the boto3 detector
    - `src/scanner/detectors/boto3.ts`: `boto3.client` and `boto3.resource` calls and the same on boto3 sessions, single or double quotes, `#` comments removed; register it in `scanRepo` and set `pythonAnalysed: true`; extend the sample repo assertions
    - _Requirements: 2.4, 2.6, 2.7_
  - [x] 28.2 Write property test for the boto3 detector
    - **Property 8: The boto3 detector counts client and resource calls**
    - **Validates: Requirements 2.4, 2.6**
  - [x] 28.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 29. Adjust the hooks to the SP1 result
  - [x] 29.1 Apply the recorded SP1 result
    - Only after the owner records SP1 in `docs/decisions/ADR-024` (otherwise stop and ask). Compare it with assumptions A-SP1-1 to A-SP1-6 in the design and apply the matching rows of the fallback table: update `hook-input.ts`, `tool-names.ts` and `exit-policy.ts`, the hook template matchers and commands, the Power `mcp.json` (remove `awsevents` if its entry was rejected or `disabledTools` was ignored), the `install-hooks` skill and the README; add a "Deviations recorded with task 29" paragraph to design.md
    - _Requirements: 24.2, 24.3, 24.4, 24.5, 24.6_
  - [x] 29.2 Replay the recorded payload
    - Add the payload line from ADR-024 as a test fixture under `packages/mcp-server/test/hooks/fixtures/` and replay it through both hooks, asserting the expected decisions; update the Power structural tests for any changed file
    - _Requirements: 19.6, 24.3_
  - [x] 29.3 Commit
    - After `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors, commit with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 30. Final checkpoint: ensure all tests pass and coverage is complete
  - Ensure all tests pass with 100% lines, branches, functions and statements for S3-owned code with only `packages/mcp-server/src/bin.ts` excluded, lint, format, typecheck and `npm run check:dash` clean, ask the user if questions arise.
  - _Requirements: 25.5, 25.6, 25.9_

- [x] 31. Capture feature screenshots for the Builder Center post
  - [x] 31.1 Save two or three captures of the feature working in simulated mode
    - Run `npx reinvent-compass demo` (or the built CLI) with `COMPASS_MODE=simulated` and save two or three screenshots or short terminal captures to `docs/article/screenshots/compass-power/`, for example the scan and plan summary, the blocked clash with its safe swap, and the QR hand-off; make sure no real name, email or token appears
    - _Requirements: 25.8_
  - [x] 31.2 Commit
    - After `npx eslint .` and `npx prettier --check .` both pass with zero errors, commit the captures with scope `compass-power` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 32. Trim gitignore lines in linear time (CodeQL alert 1, design "Post-CodeQL change")
  - [x] 32.1 Replace the trailing-space and trailing-slash regexes in `parseGitignore` with linear loops that keep git's rule: a trailing space escaped by `\` stays
    - Why: CodeQL js/polynomial-redos on `packages/core/src/scanner/gitignore.ts`. A scanned `.gitignore` line made of a long run of `/` or spaces followed by another character made `/\/+$/` and `/(?<!\\) +$/` quadratic. The scanner reads repositories the attendee points it at, so the input is not trusted
    - Tests: the escaped-space and plain trailing-space cases still parse as before; a 100 000-character run of slashes or spaces parses in well under a second; 100 percent coverage
  - [x] 32.2 Commit after the full gate passes, scoped `compass-power`. Do not push

- [x] 33. Let the agent read the schedule with its ids (SP3 finding, design "Post-SP3 change: show_schedule")
  - [x] 33.1 Show the new layover's id in the `add_layover` text
    - Why: on 19 October SP3 in Kiro created a layover, then could not change or delete it, because the new `personalTimeId` was only in `structuredContent` and Kiro shows the model the text alone
    - The create and update results put `personalTimeId` next to the title inside the attendee Labelled_Data_Block, and the delete result names the id it deleted
    - Tests: the create text contains the new id; the update and delete texts contain the id; a create the schedule does not confirm carries no id; 100 percent coverage
    - _Requirements: P1.2_
  - [x] 33.2 Build the `show_schedule` read tool (after foundation-contracts task 17 adds its contract)
    - `packages/mcp-server/src/tools/show-schedule.ts`: no input; checks the sign-in, reads the fresh schedule (which also writes the Schedule_Snapshot) and the cached catalog; returns `{ schedule, notInCatalog }`; the text gives the counts, then one catalog Labelled_Data_Block with the reserved sessions and the standby list (`sessionId`, `code`, `title`, `venue`, `room`, `startsAt`, `endsAt`, in start order), then one attendee block with the layovers (`personalTimeId`, `title`, `startDateTime`, `endDateTime`, `location`), and the ids the catalog cache does not know, with a pointer to `refresh_catalog`. An empty schedule says so plainly. Nothing is written to S1 or S4
    - Registry: class `read`, not a schedule write; title "Show my schedule"; description "Show your live re:Invent schedule ... Takes no input. Nothing is changed."
    - Descriptions: `check_itinerary` says it checks commitments you pass in and points to `show_schedule` for the current schedule; `export_calendar` says that with no input it reads your live schedule and that commitments are only for a proposed itinerary
    - Tests: a handler test (reserved, standby, layovers, ids not in the catalog, empty schedule, not signed in, hostile catalog and layover titles stay inside the blocks); the registry, annotation, Property 19 (read tools never write), stdout and tool count tests include it; the CLI tool list count is eighteen
    - _Requirements: P1.1, P1.3, P1.4_
  - [x] 33.3 Document it
    - `packages/mcp-server/README.md` tool table (class read) and Approvals: `show_schedule` reads your schedule, so it is approved per call like `scan_repo` and is not in the recommended `autoApprove` list, which stays at three; `power/POWER.md` Approvals and `power/skills/plan-my-week/SKILL.md` name it as the way to see the schedule and the ids. The repository root README is the owner's draft and is not changed here
    - Tests: the README test checks eighteen tools and keeps `show_schedule` out of the `autoApprove` snippet
    - _Requirements: P1.5_
  - [x] 33.4 Commit after the full gate passes (100 percent coverage, eslint, `tsc -b`, prettier, `npm run check:dash`), scoped `compass-power`, with no attribution trailer. Do not push

- [x] 34. Make show_schedule easy to find and list each session once (dev test of 20 October, design "Post-SP3 change: show_schedule, round 2")
  - [x] 34.1 Leave reserved sessions out of the standby list in `show_schedule`
    - Why: the Events API keeps a reserved session in the attendee's favourites, so the owner's reserved sessions showed under both reserved and standby, and Kiro then offered to "clean up" the standby list. The text and the catalog block now list a reserved session once, under reserved; the count line counts standby without the reserved ones and says that reserved sessions stay in the Events favourites. `structured.schedule` stays the raw schedule. `notInCatalog` lists each id once
    - Tests: a session that is both reserved and a favourite appears only under reserved, the counts match, the note appears only when there is an overlap, and an id missing from the catalog that is both reserved and a favourite is named once
  - [x] 34.2 Make the description match how attendees ask
    - Why: on dev, Kiro (running Compass as a plain MCP server, so without the Power's skill text) went through `check_itinerary`, `plan_week` and `export_calendar` before it found `show_schedule`. The description now leads with the questions it answers: what is on my schedule, what have I booked or reserved, what is on my standby (favourites) list
    - Update the pinned description in this design's Descriptions line and in the registry test
  - [x] 34.3 Commit after the full gate passes, scoped `compass-power`

- [x] 35. Keep the CLI tests independent of the built `dist/` folder (flaky test found on 20 October)
  - [x] 35.1 Give `test/cli/main.test.ts` its own checkout copy (package.json, `data/venues.json`, `fixtures/api`, `fixtures/synthetic`, `fixtures/sample-repo`) in a temporary folder, and point the default test host's `moduleUrl` at it
    - Why: the pack smoke test rebuilds `packages/mcp-server/dist` (it removes and copies `dist/data` and the rest) while the CLI tests read `dist/data/venues.json` through the bundled-first lookup. When both ran at once, `main` could not read the venues and returned 1, so the demo and serve tests failed at random in the full run (seen twice locally; CI passed by timing). With its own copy the CLI test always uses the repository fallback and never touches `dist/`
    - Tests: the 19 CLI tests pass on their own and in the full coverage run, twice in a row
  - [x] 35.2 Commit after the full gate passes, scoped `compass-power`

- [x] 36. Use the private checkout in every test that runs the CLI (flaky test found again on 20 October)
  - [x] 36.1 Move the checkout copy of task 35 into `test/support/private-checkout.ts` and use it in `test/cli/main.test.ts` and `test/e2e/full-flow.test.ts`, whose demo run read `dist/` while the pack smoke test rebuilt it and returned 1 at random
  - [x] 36.2 Tests pass on their own and twice in the full coverage run; commit scoped `compass-power`

- [x] 37. Read-only by default (owner decisions of 20 October, design "Post-SP3 change: read-only by default")
  - [x] 37.1 In live mode Compass is read-only unless the attendee sets `COMPASS_ALLOW_WRITES=1`; the server logs one line when writes are on. Simulated mode never calls the Events API, so it keeps its made-up bookings
  - [x] 37.2 A read-only Events adapter wraps the real one: every write method (reserve, cancel, favourite, unfavourite, create, update and delete personal time) throws `CompassError('ReadOnly')` without a network call; reads are untouched
  - [x] 37.3 The schedule write tools (`reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby`, `add_layover`) check first and, when read-only, ask nothing and reply with what they would have done, that nothing changed, and how to make the change in the re:Invent app. The pass tools and `forget_me` still work: passes live on Compass's own pass service (owner decision)
  - [x] 37.4 Tests: live mode is read-only by default, every write refuses and makes no call, each schedule tool asks nothing and says nothing changed, `COMPASS_ALLOW_WRITES=1` turns writes on, simulated mode is unaffected. Documented in the MCP server README and the Power. Commit scoped `compass-power`

- [x] 38. Fixes from the first read-only try in Kiro (20 October, design "Post-SP3 change: codes, walk-up sessions, no write invitations")
  - [x] 38.1 Accept a session code wherever a tool takes `sessionId` or `sessionIds`: the server maps a value that is not a catalog id but is exactly one session's code (any letter case) to that session's id before the tool runs. Why: Kiro called `reserve_with_guardrails` with "ABC123" and got "not in the catalog", and a catalog refresh did not help
  - [x] 38.2 `reserve_with_guardrails` refuses a session that is not reservable before anything else, with a block verdict that says it needs no reservation (walk up, or keep it on the standby list). Why: ABC123 has `isReservable: false` and Compass offered to reserve it
  - [x] 38.3 The read-only reply only points to the re:Invent app and no longer names the setting, and the Power skill tells the agent never to change Compass's settings or offer to. Why: Kiro offered to edit mcp.json to turn writes on, which is the accident read-only mode exists to prevent
  - [x] 38.4 Tests and commit after the full gate passes, scoped `compass-power`

- [x] 39. Point the walk-up reply to the re:Invent app when Compass is read-only (20 October, design "Post-SP3 change: codes, walk-up sessions, no write invitations")
  - [x] 39.1 When Compass is read-only, the walk-up reply of `reserve_with_guardrails` suggests adding the session to the favourites in the re:Invent app instead of the standby list, because `add_standby` is a write and would only reply what it would have done. Why: in Kiro the agent offered to add ABC123 to the standby list after the walk-up reply
  - [x] 39.2 Tests for both wordings; commit scoped `compass-power`

- [x] 40. Pre-release review fixes for read-only mode (CTO H1, M1, M2, L4 and TAM L1 of 20 October; design "Post-SP3 change: pre-release review fixes")
  - [x] 40.1 The read-only reply carries the sessions, layover text and guardrail warnings only inside labelled data blocks (Requirement on Labelled_Data_Block): `readOnlyReply(ctx, action, data)` takes already-labelled data, `catalogTargets` builds the catalog block. The required prompt-injection test now runs every schedule tool against the hostile catalog in read-only mode
  - [x] 40.2 When writes are on in live mode, the schedule tools, `show_schedule` and `sign_in` start their reply with "Writes are on: ...", so the person in the chat sees it; the Power skill and POWER.md no longer name the setting, and the write-tool descriptions say Compass is read-only unless writes are turned on
  - [x] 40.3 The Kiro pre-write hook resolves session codes with the same pure resolver as the server (`sessionIdResolver`), so a call made with a code is judged instead of passed through
  - [x] 40.4 Tests and commit scoped `compass-power`

- [x] 41. Scan for all technology, AWS first (owner request of 20 October, design "Owner change: your tech and your GitHub")
  - [x] 41.1 Stream the scan through `SourceFile` and `analyseFiles`: the walker also yields a name-only entry for each regular file it does not read, `scanRepo` becomes `analyseFiles(walk(...))`, and `productionMarkerFor` is exported. Existing scan results are unchanged
  - [x] 41.2 Add the Tech_Table and the Tech_Detectors (extensions and manifests) and `ScanResult.technologies`, scored as files + 5 x declarations
  - [x] 41.3 Add the AWS SDK for .NET to the Service_Table (`nugetPackages`, `dotnetClientNames`) with an official source for every identifier, and a `dotnet` detector for `*.csproj` and `*.cs`
  - [x] 41.4 `scan_repo` scans each git repository in a dev folder as its own project (depth 1 and 2, up to 50, 120 seconds in all) and its text lists AWS services first, then other technology, names only
  - Tests: every detector on good, malformed and hostile input; name-only entries never reach a detector's `detect`; no path or name in any result (property test); a dev folder with three repositories, one over the limit; 100 percent coverage
  - _Requirements: P2.1, P2.2, P2.3_

- [x] 42. Keep a tech profile on the device (design "Tech_Profile")
  - [x] 42.1 `tech-profile.ts`: the store (app-data, 0600, atomic write, `simulated` subfolder), hashed source ids, replace on rescan, at most 500 sources, `mergeProfile` and its ranking; a `techProfile` port on the Runtime
  - [x] 42.2 `scan_repo` adds each project to the profile; `forget_me` removes it; `plan_week` ranks by the merged profile (AWS findings and techs), falling back to `lastScan`
  - Tests: merge and ranking (property test: order does not change the merge), rescan replaces, the cap, a corrupt file reads as empty, no path in the file, `forget_me` removes it, the planner's tech weight and reason; 100 percent coverage
  - _Requirements: P2.4, P2.7_

- [x] 43. Build the `show_my_tech` read tool (design "show_my_tech")
  - [x] 43.1 Handler, registry (class `read`), title "Show my tech", description led by "What tech do I work on, and what do I use the most"; `top` 1 to 50
  - Tests: AWS first, ranking, `top`, empty profile, simulated mode; registry, annotation, Property 19 (read tools never write), stdout and tool count tests; 100 percent coverage
  - _Requirements: P2.5, P2.10_

- [x] 44. Build the `find_sessions_by_tech` read tool (design "find_sessions_by_tech and the planner")
  - [x] 44.1 Whole-word `words` matching in the Events adapter's catalog filter (title, abstract, topics, services); alias resolution; grouped results from the profile when no tech is given
  - [x] 44.2 Handler, registry (class `read`), title "Find sessions by tech", description led by "Find me sessions on a technology, for example .NET"
  - Tests: ".NET", "dotnet" and "C#" find the same sessions; "net" does not match "network"; an unknown tech is a literal word; no tech uses the profile; hostile catalog text stays inside the blocks; limits; 100 percent coverage
  - _Requirements: P2.6, P2.10_

- [x] 45. Read your GitHub repositories, read-only, with consent (design "GitHub, read-only")
  - [x] 45.1 Core GitHub module: device flow and refresh, the GitHub_Token_Store (keychain, memory fallback, redaction), the listing client (installations, repositories, paging), the archive reader (manual redirect to codeload only, no token on the redirect, gunzip and tar in memory, size caps) and the worker request that scans one repository under the budget
  - [x] 45.2 `connect_github`, `scan_github` and `disconnect_github`: background polling, the consent message, forks left out by default, each repository a `github` profile source, simulated mode makes no request, no client ID means not set up
  - [x] 45.3 Document it: MCP server README (tools, approvals, what leaves your machine, threat model), POWER.md and the plan-my-week skill, the site privacy page (GitHub hosts). Owner action recorded: register the GitHub App and fill in the client ID and slug
  - Tests: every device-flow error, refresh, token never in a log or error, host allowlist, a redirect to another host is refused, a tar bomb and a huge file stop at the caps, PAX long names, links skipped, decline reads nothing, a client that cannot ask is refused; 100 percent coverage. A security review of the module before the commit
  - _Requirements: P2.8, P2.9, P2.10_

- [x] 46. Commit tasks 41 to 45 after the full gate passes (100 percent coverage, eslint, `tsc -b`, prettier, `npm run check:dash`, the site tests and build), scoped `compass-power`, with foundation-contracts task 20 in the same commit. Do not push

- [x] 47. Wire in the registered Compass GitHub App (owner action of 20 October, design "GitHub, read-only")
  - The owner registered the public app "re:Invent Compass (unofficial)" on his personal account: Contents: read and Metadata: read only, no account or organisation permissions, Device Flow on, expiring user tokens on, no webhook, no callback URL, installable on any account, no client secret and no private key
  - Set `GITHUB_APP_CLIENT_ID` to `Iv23liKdFb0y0U0QXj6N` and `GITHUB_APP_SLUG` to `re-invent-compass-unofficial` in `packages/mcp-server/src/config/github.ts`; both are public. Update the comment and the tests that assumed the build constants were empty
  - Tests: the build ships the client ID and slug, with no environment the build app is used with its install link, the environment still replaces them; 100 percent coverage
  - Full gate (`tsc -b`, eslint, prettier, `npm run check:dash`, `npm test` at 100 percent coverage), then commit scoped `compass-power` on develop
  - _Requirements: P2.8_

- [x] 48. Let the attendee choose a link or a QR code on a browser page (owner request of 21 October, design "Owner change: link or QR code")
  - Contract (foundation-contracts task 21) and the SVG render (boarding-passes task 13) land in the same commit
  - `src/adapters/qr-page.ts` and `createLocalPageOpener`; `send_to_phone` takes `show` and asks when it is missing; `forget_me` clears the page; the descriptions, the Power, the plan-my-week skill, the demo and the mcp-server README follow
  - Tests: a missing `show` creates no hand-off and calls nothing; `link` has no QR; `qr` opens the page and prints no link; `both`; the fallback to the chat QR when the page cannot be shown; the page is written with mode 0600 in a new `compass-qr-` folder, carries the CSP and no script, is deleted at expiry, on replacement, on `clear()`, on exit and on the stop signals; old pages are swept; overlapping calls run one at a time; an opener that never returns times out; the link and the path are never logged; 100 percent coverage
  - Full gate (`tsc -b`, eslint, prettier, `npm run check:dash`, `npm test` at 100 percent coverage), a security review of the page and the temporary file, then commit scoped `compass-power` on develop
  - _Requirements: P3.1, P3.2, P3.3, P3.4, P3.5, P3.6_

- [x] 49. Brand the QR page (owner request of 21 October, design "Owner change: branded QR page")
  - `scripts/make-qr-brand.mjs` writes `src/adapters/qr-brand.ts` with the owner's `logo.svg` and `favicon.svg` as base64; a test fails when the module and the site files drift apart
  - `qrPageHtml`: title "re:Invent Compass Boarding Pass"; the icon as an SVG favicon and the full logo above the heading, both `data:` URLs; the pass gradient behind a dark card, orange heading
  - Tests: the title, the favicon and logo are the owner's files as `data:` URLs, the logo comes before the heading, still no script, no external URL and the same CSP
  - Full gate (`tsc -b`, eslint, prettier, `npm run check:dash`, `npm test` at 100 percent coverage, `npm run test:site`), then commit scoped `compass-power` on develop
  - _Requirements: P3.3, P3.7_

- [x] 50. Hide the QR code and show a red expired banner when the link expires (owner request of 21 October, design "Expired link banner")
  - `qrPageHtml` takes the milliseconds left; the `.live` block and the `.expired` banner switch with a CSS animation delayed to the expiry; no script, the CSP is unchanged
  - Tests: the banner is in the page and hidden at first, the delay is the seconds left rounded up (never negative), the scan text and QR code sit in the block that hides, and the page still has no script; a check of the page in a browser
  - Full gate (`tsc -b`, eslint, prettier, `npm run check:dash`, `npm test` at 100 percent coverage, `npm run test:site`), then commit scoped `compass-power` on develop
  - _Requirements: P3.8_

- [x] 51. Replace issue_boarding_passes with issue_all_boarding_passes and issue_boarding_pass (owner decision of 21 October, design "Owner change: issue all passes or one")
  - Contract (foundation-contracts task 22) in the same commit; registry, hook write-tool list, descriptions and titles, `NoPassesIssued`, the spec renderer's next action (`packages/core/src/spec/render.ts`), the demo, the Power, the plan-my-week skill and the mcp-server README follow
  - `ctx.choose` for a single-choice elicitation; `elicitInput` waits five minutes and a timeout is `ConfirmTimedOut`
  - Tests: all passes after one confirmation; nothing reserved asks nothing; an id or a code issues one reserved pass and refuses one not reserved without a pass call; without an id the pick list issues the chosen one, a decline or an unknown label issues nothing, and a client without elicitation gets the list and nothing is issued; the timeout says it timed out and writes nothing; the prompt-injection and stdout cross tests cover both tools; 100 percent coverage
  - Full gate (`tsc -b`, eslint, prettier, `npm run check:dash`, `npm test` at 100 percent coverage, `npm run test:site`), then commit scoped `compass-power` on develop
  - _Requirements: P4.1, P4.2, P4.3, P4.4_

- [x] 52. One confirmation for issuing passes: the client's approval (owner rule of 21 October, design "One confirmation for passes")
  - Remove `humanConfirms` from `issue_all_boarding_passes` and `issue_boarding_pass`; keep the pick list; the descriptions, the Power and the plan-my-week skill say the client's approval is the one confirmation
  - Tests: neither tool asks a confirmation through elicitation; the pick list is the only question without an id; over MCP with an elicitation client the only question is the pick list; 100 percent coverage
  - Full gate (`tsc -b`, eslint, prettier, `npm run check:dash`, `npm test` at 100 percent coverage, `npm run test:site`), then commit scoped `compass-power` on develop
  - _Requirements: P4.5_

- [x] 53. The 0.1.0 release commit (owner go of 25 October, tracker REL1 and T1, TAM H1, design "Owner change: the 0.1.0 release commit", runbook `docs/runbooks/npm-release.md` "Prepare a release")
  - Remove `"private": true` from `packages/mcp-server/package.json` and change the packaging test that expects it in the same commit
  - Set the version to `0.1.0` in `packages/mcp-server/package.json`, `power/plugin.json`, `power/POWER.md`, `power/mcp.json`, the hook template and every `npx --yes reinvent-compass@X` example in `packages/mcp-server/README.md` and under `power/`
  - Set `COMPASS_API_BASE_URL` in `packages/mcp-server/src/config/compass-api.ts` to `https://reinvent-compass.vegas` (ADR-031), with no trailing slash; the dev override (`COMPASS_API_URL` with `COMPASS_ALLOW_API_OVERRIDE=1`) keeps working
  - Full gate (`tsc -b`, eslint, prettier, `npm run check:dash`, `npm test` at 100 percent coverage, `npm run test:site`) and the file list check `npm pack --dry-run --workspace packages/mcp-server`; commit scoped `compass-power` on develop. No tag and no publish: the owner tags `v0.1.0` only after prod answers `GET /api/v1/health` (release gate G03)
  - _Requirements: 20.1, 20.2, R2.3_

- [x] 54. Refresh the read-only wording proposals (owner request of 26 October, tracker DOC2, design "Owner change: refreshed wording proposals")
  - Rewrite `docs/proposals/read-only-wording.md` against the owner's current drafts (`README.md`, `docs/article/builder-center-draft.md`) and the code as of develop dcf0f1f: the tool count and table, read-only by default, the Boarding Pass fields, the tagline, the GitHub tech scan, link or QR, the site pages, Google Wallet publishing access, the 0.1.0 version and the production address, the hook, the runbooks and the requirements section for hackathon rules row 3
  - Each item names the draft, the current line and text, and the replacement to paste; nothing is applied to the owner's drafts
  - Check every fact against the code and docs, the dash check and prettier; commit scoped `compass-power` on develop
  - _Requirements: 20.1, R2.3_

- [x] 55. Layover times in re:Invent's own time zone (owner LW1 run of 29 October, tracker BUG1, design "Owner change: layover times and badge pickup day")
  - The live Events API keeps personal time as a wall-clock time in the event's time zone, not in UTC as the OpenAPI document says: a layover sent for 07:00 PST as `15:00:00` showed at 15:00 in the re:Invent app
  - Add `toZoneWallClock(instant, zone)` and `fromZoneWallClock(local, zone)` to `packages/core/src/catalog/session-time.ts`, with tests for PST, a daylight saving change, a bad zone and a bad value
  - In `packages/mcp-server/src/adapters/events-adapter.ts`, send `startDateTime` and `endDateTime` as the wall-clock time in the event time zone (`eventWindow().timezone`), and read naive personal time back as that wall-clock time, so every reader still compares real instants
  - Tests: 07:00-08:00 goes on the wire as `07:00:00`; a naive `07:00:00` reads back as `07:00:00-08:00`; the confirmation still matches the entry; the attendee's own time zone never changes either value
  - Full gate, then commit scoped `compass-power` on develop
  - _Requirements: 14.3, 14.4_

- [x] 56. Layovers on badge pickup day, 29 November (owner LW1 run of 29 October, tracker BUG2, design "Owner change: layover times and badge pickup day")
  - The live event window starts 30 November at 05:30 PST, so a layover on Sunday 29 November is refused, although badge pickup and registration open that day
  - `add_layover` accepts a layover from 00:00 on the day before the event start, in the event time zone, to the event end; the window itself is still read from the API and never hard-coded
  - Tests: 29 November 10:00 PST is accepted; 28 November 23:55 PST is refused; the event end is unchanged
  - Amend Requirement 14.4 to name the badge pickup day; full gate, then commit scoped `compass-power` on develop
  - _Requirements: 14.4_

- [x] 57. Package metadata and licences (CTO final review of 29 October, findings 1 and 2, tracker CTO1)
  - Add `description`, `license` (`Apache-2.0`), `repository` (`git+https://github.com/henniefrancis/aws-re_invent-compass.git`, directory `packages/mcp-server`), `homepage` (`https://reinvent-compass.vegas`) and `bugs` to `packages/mcp-server/package.json`; npm provenance needs `repository` to match the GitHub repository
  - The build copies the repository `LICENSE` and `NOTICE` into the package and writes `THIRD-PARTY-NOTICES.txt` from the esbuild metafile: every bundled package with its name, version, licence and licence text, so the bundled libraries keep their notices
  - Update `check-pack.mjs` (`REQUIRED_FILES`, `ALLOWED_FILE`), the packaging tests and the file count in `docs/runbooks/npm-release.md`
  - Full gate and `npm pack --dry-run --workspace packages/mcp-server`, then commit scoped `compass-power` on develop
  - _Requirements: 20.1, 20.2_

- [x] 58. ADRs the final CTO review asked for (CTO findings 7 and 8 of 29 October)
  - ADR-032: stay on the MCP TypeScript SDK v1 line for 0.1.0 (why not v2, what the v1 maintenance line means, when to move), and whether to take the 1.32.2 patch now
  - ADR-033: the Compass GitHub App for the GitHub tech scan (why an App, the permissions it asks for, what it reads, what it never stores)
  - ADR-034: the pass confirmation change (one confirmation through the client's approval, compass-power task 52, owner rule of 21 October)
  - ADR-035: GitHub token handling (where the token lives, its lifetime, redaction, and what happens on sign-out and `forget_me`)
  - Each ADR states only what the code and specs show, links its sources, and is listed in `docs/decisions/README.md`; dash check and prettier; commit scoped `compass-power`
  - _Requirements: 20.1_

- [x] 59. Take the MCP SDK 1.32.2 patch (owner approval of 30 October, ADR-032)
  - Pin `@modelcontextprotocol/sdk` at exactly 1.32.2 in `packages/mcp-server/package.json`, refresh the lock file, amend ADR-032, Requirement terms and the foundation-contracts dependency table; full gate; commit scoped `compass-power`
  - _Requirements: 20.1_

- [x] 60. The npm trusted publisher expires (release step 15, 31 October)
  - The first `v0.1.0` publish failed with E404 after the provenance statement: npm expires a trusted publisher that has not completed a publish within 2 days. `docs/runbooks/npm-release.md` now says to create it on release day with only "npm publish" allowed, gives the `npm trust` CLI form, adds a check before the tag in "Tag order", and adds the E404 case to "If a publish fails"; dash check and prettier; commit scoped `compass-power`
  - _Requirements: 20.1_

- [x] 61. `sign_in` never reports an expiry that has already passed (owner, prod check of 31 October)
  - On prod, `sign_in` answered "This sign-in lasts until 2026-10-30" on 31 October: when a sign-in is already held, the adapter reported the stored access token's expiry without renewing it. The `AuthPort` gains `refreshIfNeeded` (the S1 credential source in live mode, a no-op in simulated mode); a held sign-in is renewed before its expiry is reported; a rejected refresh token (`SignInRequiredError`) runs the sign-in flow again; any other failure is mapped as before. Unit tests for the three paths at 100 percent coverage; full gate; commit scoped `compass-power`
  - _Requirements: 9.1_

- [x] 62. A layover never crosses midnight (Events API OpenAPI change found on 31 October)
  - The live Events API OpenAPI now says a personal-time block must end on the same date it starts, in the event's own time zone. `add_layover` (create and update) refuses a block whose start and end fall on different event-local dates, before any request, with a plain message that names the rule; an end at exactly 00:00 the next day counts as a different date, as the API states. Unit tests at 100 percent coverage, including a block that ends at 23:55 and one that ends at 00:00; full gate; commit scoped `compass-power`
  - _Requirements: 14.1_

## Notes

- There are no optional tasks. 100% coverage (Requirement 25.6) is part of the definition of done, so every test task is mandatory.
- Each task references granular requirements for traceability; every property test references its property number and the requirements it validates.
- Property-based tests use `fast-check` (at least 100 runs each) and are tagged `// Feature: compass-power, Property {n}: {text}`. `fast-check` 4.10.2 is a root devDependency; no install is needed.
- `packages/contracts` (S0), `data/venues.json` (S2) and `fixtures/synthetic/**` (S0) are read-only. Test sessions come from `fixtures/synthetic/catalog.json`; do not invent sessions and do not edit that file.
- Never call the live Events API or the live Compass API from tests. Live checks run only with `COMPASS_LIVE_TESTS=1`, set by the owner locally, and are never run by you.
- Commits use Conventional Commits scoped `compass-power`, with subject and body passed via multiple `-m` flags (no commit message file), no Co-Authored-By trailer and no Claude or AI attribution, made only after `npm test`, `npx eslint .` and `npx prettier --check .` all pass with zero errors. The first commit (task 1) includes `.kiro/specs/compass-power/`. Never push, merge, open a PR or tag. No em dashes or en dashes anywhere.
- Do each task yourself in this chat in numeric order; do not delegate to the spec-task-execution subagent and do not run tasks as parallel waves. Save files after each step.
- Checkpoints (tasks 6, 10, 20, 30) validate incrementally; the final checkpoint confirms the definition of done.
- **Integrator requests (S3 cannot make these changes):**
  1. `packages/mcp-server/package.json`: `zod` is already declared; add `"bin": { "reinvent-compass": "./dist/bin.js" }`, `files` and `engines` (`node >= 24`); `"private": true` stays until the release gate; set the release version used by the Power files.

2. A build step that copies `data/venues.json` and `fixtures/sample-repo/` into `packages/mcp-server/dist/` so the server and `demo` work from the npm package (Open Question 11).
3. Exclude `fixtures/sample-repo/**` from ESLint and `tsc` (its files import packages that are not installed) (Open Question 13).
4. Set the live Compass API base URL in `src/config/compass-api.ts` before `1.0.0` (Open Question 10), and supply the public repository URL for `plugin.json` if wanted (Open Question 12).

- **Change requests to other streams (raised, not blocking):** S0 for `add_layover` update and delete and optional `scan_repo` level and reasoning fields (Open Questions 3 and 4); S2 to export `resolveCommitment` (or a connections helper) and `withContextDefaults` (Open Question 5); S4 to return `boardUrl` and `expiresAt` with the hand-off renders (Open Question 6).

- **Integrator notes:** the Compass API host is a build-time constant passed to the pass client as both `baseUrl` and `allowedHosts`, with `simulated: true` in simulated mode; `COMPASS_API_URL` applies only with `COMPASS_ALLOW_API_OVERRIDE=1`, and the CLI and the server print the one-line override warning (tasks 23 and 26); the production transport and node:fs adapters (task 12.4) implement `rename`, `createExclusive` and symlink refusal and use `redirect: 'error'`; `sync_passes` (task 18.2) previews what it would void and elicits confirmation for an empty or bulk void (more than 5), see design deviation 11.
- **CTO review amendments (apply with the affected task):** H1 `sync_passes` is a Write_Tool and the passes adapter uses a narrowing store view (tasks 11.4, 18.2, 24.2, 25.1, 26.1); H2 no `awsevents` in `power/mcp.json` until ADR-024 (tasks 24.1, 24.3, 29.1); H3 the triple A = syn-024, A-R = syn-025, B = syn-076 (re-picked after the catalog regeneration) with an early existence test (tasks 1.3, 27); M1 elicited second cancel, refused every time when the client cannot ask (16.2, 16.3); M2 exactly-once wording (17.3, 26.2); M3 plan_week target folder, lstat, `wx`, symlink refusal (9.2, 14.3); M4 elicited confirmation for Schedule_Write_Tools (15.3, 16.2, 17.1, 17.2); M5 `ProbeWrite` probe, case-insensitive `identifyTool`, matcher `.*(...)$` (22.1, 24.1, design SP1 checklist); M6 wire-services filter in the adapter (13.1, 26.1); M7 pinned simulated instant (12.3); M8 S2 `connectionsForDay` and `energyForDay` (26.1); M11 GitHub import step (design SP1 checklist, 25.1); L1 handler throw test (11.6); L2 negative and non-integer refusals (13.1, 14.3); L3 npx local-copy risk (25.1); L5 injected platform (all `src`).

## Task Dependency Graph

Tasks run sequentially in numeric order. There are no parallel waves: every leaf task is placed in a single ordered wave so no task is started before the ones listed before it.

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": [
        "1.1",
        "1.2",
        "1.3",
        "1.4",
        "1.5",
        "2.1",
        "2.2",
        "2.3",
        "2.4",
        "2.5",
        "2.6",
        "2.7",
        "2.8",
        "3.1",
        "3.2",
        "3.3",
        "3.4",
        "3.5",
        "3.6",
        "3.7",
        "3.8",
        "3.9",
        "3.10",
        "3.11",
        "4.1",
        "4.2",
        "4.3",
        "4.4",
        "4.5",
        "4.6",
        "4.7",
        "4.8",
        "4.9",
        "5.1",
        "5.2",
        "5.3",
        "7.1",
        "7.2",
        "7.3",
        "7.4",
        "7.5",
        "8.1",
        "8.2",
        "8.3",
        "8.4",
        "8.5",
        "8.6",
        "9.1",
        "9.2",
        "9.3",
        "9.4",
        "9.5",
        "9.6",
        "11.1",
        "11.2",
        "11.3",
        "11.4",
        "11.5",
        "11.6",
        "11.7",
        "12.1",
        "12.2",
        "12.3",
        "12.4",
        "13.1",
        "13.2",
        "13.3",
        "14.1",
        "14.2",
        "14.3",
        "14.4",
        "14.5",
        "14.6",
        "14.7",
        "14.8",
        "15.1",
        "15.2",
        "15.3",
        "15.4",
        "15.5",
        "16.1",
        "16.2",
        "16.3",
        "16.4",
        "17.1",
        "17.2",
        "17.3",
        "17.4",
        "17.5",
        "17.6",
        "18.1",
        "18.2",
        "18.3",
        "18.4",
        "18.5",
        "18.6",
        "19.1",
        "19.2",
        "19.3",
        "21.1",
        "21.2",
        "21.3",
        "21.4",
        "21.5",
        "21.6",
        "21.7",
        "22.1",
        "22.2",
        "22.3",
        "22.4",
        "22.5",
        "22.6",
        "22.7",
        "23.1",
        "23.2",
        "23.3",
        "23.4",
        "24.1",
        "24.2",
        "24.3",
        "24.4",
        "25.1",
        "25.2",
        "26.1",
        "26.2",
        "26.3",
        "27.1",
        "27.2",
        "27.3",
        "28.1",
        "28.2",
        "28.3",
        "29.1",
        "29.2",
        "29.3",
        "31.1",
        "31.2"
      ]
    }
  ]
}
```
