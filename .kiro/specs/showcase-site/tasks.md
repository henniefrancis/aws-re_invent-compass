# Implementation Plan: showcase-site (S7)

## Overview

This plan turns the showcase-site design into incremental steps for the static Angular 22.2.3 site in `site/**`: the story, the demo, the install and privacy pages, and the `/board` hand-off page. Tests live in `site/test/` (vitest) and `site/e2e/` (Playwright).

The build order is bottom up: the workspace and test harness first, then the pure Site_Logic that every page needs (design tokens and contrast, time formatting, content), then the Shell and the content pages, then the two build checks so every later build is verified, then the board logic and the Board_Page, then the demo logic (Rules_Port, catalog, reducer, week view, sample pass, calendar) and the Demo_Page, then the Static_Server and the browser suite, and finally the README and the screenshots. Each step ends integrated; nothing is left orphaned.

Every correctness property from the design (Properties 1 to 18) is implemented with `fast-check` (at least 100 runs), tagged `// Feature: showcase-site, Property {n}: {text}`, and placed in `site/test/` next to the tests for the module it checks. All tests are mandatory; there are no optional tasks, because the definition of done requires 100% coverage of Site_Logic.

Conventions followed: Angular 22.2.3 standalone components, zoneless, prerendered with `outputMode: "static"`; kebab-case files; PascalCase types; shared types from `@compass/contracts` only (never redefined, never edited); the rules engine only through `site/src/lib/demo/rules-port.ts`; vitest 4 with v8 coverage at 100% for Site_Logic; no live API in any test; Conventional Commits scoped `showcase-site`.

## Execution rules (read before starting)

1. **Tasks run sequentially in numeric order.** Do task 1 fully, then task 2, and so on. There are no parallel waves.
2. **Do each task yourself in this chat.** Do not delegate tasks to the spec-task-execution subagent. Save files after each step.
3. **File ownership is strict.** Every file you touch must be under `site/**`, `.kiro/specs/showcase-site/`, or (task 18 only) `docs/article/screenshots/showcase-site/`. Never edit `package.json` (root or `site/`), `package-lock.json`, root configs (`vitest.config.ts`, `eslint.config.js`, `tsconfig*.json`, `.prettierrc.json`, `.gitignore`), `.github/**`, `contracts/**`, `packages/**`, `data/**`, `fixtures/**` or `infra/**`. If you need any of those changed, stop and add it to the Integrator requests in the Notes; do not run `npm install`.
4. **Use only pinned dependencies.** Everything the site needs is already pinned: the Angular 22.2.3 packages, `@angular/ssr`, `@angular/platform-server`, `rxjs` and `tslib` in `site/package.json`; `vitest`, `@vitest/coverage-v8`, `fast-check`, `ical.js`, `@playwright/test`, `@axe-core/playwright`, `@angular-eslint/*`, `typescript` and `prettier` at the root. Do not use `zone.js`, `@angular/animations`, HttpClient, any UI kit, web font or third-party script.
5. **Commands before every commit.** Run, from the repository root: `npx vitest run --coverage --config site/vitest.config.ts` (100% for Site_Logic), `npm test` (the root suite must stay green), `npx eslint .`, `npx prettier --check .` and `npm run check:dash`. For tasks that change anything the build reads, also run `npx tsc -b`, then from `site/`: `npx ng build`, `node scripts/check-build-output.mjs` and `node scripts/check-budgets.mjs` (the two checks exist from task 5). All must pass with zero errors.
6. **Each top-level task ends with a local commit.** Conventional Commits with scope `showcase-site`, subject and body passed as multiple `-m` flags (for example `git commit -m "feat(showcase-site): add the board fragment parser" -m "Reads the hand-off id from the URL fragment only and refuses non-canonical ids."`). Never use a commit message file. Never add a Co-Authored-By trailer or any AI or tool attribution. Never push, merge, open a pull request or tag. The first commit (task 1) also includes `.kiro/specs/showcase-site/`. Verify every edit landed before committing.
7. **No live systems.** Never call the live Events API or a deployed Compass API. Browser tests mock the hand-off routes with fixtures. The Playwright suite runs on demand only.
8. **S2 dependency.** Tasks 10 to 13 need `@compass/core/rules` (S2, merges 21 October) and `data/venues.json`. Before task 10, rebase onto `develop` if the integrator says S2 is merged. If it is not merged, write the Rules_Port against the S2 design signatures and use the test double in `site/test/doubles/rules-double.ts`; switch to the real engine as soon as it lands. Never copy rules code into the site.
9. **Synthetic data only.** The Demo_Catalog is copied from `fixtures/synthetic/catalog.json` (read only). Never invent or edit a session. If a needed scenario is missing, stop and ask the integrator.
10. **Voice.** Plain English, short sentences, no em dash or en dash in any file, test name or commit message.

## Tasks

- [x] 1. Scaffold the Angular workspace and the site test harness
  - [x] 1.1 Create the Angular workspace configuration and the page skeleton
    - In a scratch directory outside the repository, run the workspace's own CLI (`npx ng new reference --ssr --style=css --skip-install --skip-git`) only to read the configuration Angular 22.2.3 generates; copy what applies into `site/` and do not touch `site/package.json`
    - Create `site/angular.json` per design Component 1 (`@angular/build:application`, `browser: src/main.ts`, `server: src/main.server.ts`, `outputMode: "static"`, `styles: ["src/styles/index.css"]`, `optimization.styles.inlineCritical: false`, `subresourceIntegrity: false`, `namedChunks: true`, `statsJson: true`, raw-size budgets as an early warning)
    - Create `site/tsconfig.json` and `site/tsconfig.app.json` (CLI defaults plus `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `resolveJsonModule`, `lib: ["ES2024", "DOM"]`, `customConditions: ["@compass/source"]`; include `src`, `test`, `e2e` and the config files)
    - Create `site/src/index.html` (`lang="en"`, viewport, description, `<meta name="referrer" content="no-referrer">`, favicon link, no inline script or style), `src/main.ts`, `src/main.server.ts`, `src/app/app.config.ts` (`provideZonelessChangeDetection()`, `provideRouter`, `provideClientHydration(withNoIncrementalHydration())`), `src/app/app.config.server.ts`, `src/app/app.routes.ts` (five lazy `loadComponent` routes with titles) and `src/app/app.routes.server.ts` (the same five paths with `RenderMode.Prerender`)
    - Create a placeholder standalone component with an external template for each of `/`, `/demo`, `/install`, `/privacy` and `/board`, each with one `<h1 tabindex="-1">`
    - Create `site/src/styles/index.css` as an empty import list and `site/.gitignore` (`.angular/`, `dist/`, `test-results/`, `playwright-report/`)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 3.4, 4.6_

  - [x] 1.2 Create the site vitest harness and the static source checks
    - Create `site/vitest.config.ts`: `include: ['test/**/*.test.ts']`, environment `node`, `resolve.conditions: ['@compass/source']`, v8 coverage over `src/lib/**/*.ts` and `scripts/**/*.mjs` with 100% thresholds for lines, branches, functions and statements and no exclusions
    - Create `site/test/static/source-rules.test.ts` with every static source check from the design (no storage APIs, no `console.`, no `innerHTML` or sanitiser bypass, no `eval` or `new Function`, no component styles or style bindings, no `NgModule`, no `zone.js`, `@compass/core/` only as `@compass/core/rules` and only in `rules-port.ts`, `fetch(` only in `handoff-client.ts`, absolute `http` URLs only in `links.ts` and `handoff-view.ts`, no clock under `src/lib/demo/`, no `fetch(`, `switch (`, `JSON.parse` or regular expression literal under `src/app/`); files that do not exist yet are skipped by the scan, not by the rule
    - _Requirements: 2.2, 2.3, 2.4, 3.3, 3.5, 22.1, 22.6_

  - [x] 1.3 Verify the scaffold builds and prerenders
    - Run `npx tsc -b`, then `npx ng build` from `site/`, and confirm `site/dist/site/browser/` holds `index.html`, `demo/index.html`, `install/index.html`, `privacy/index.html` and `board/index.html`
    - _Requirements: 1.3, 1.5_

  - [x] 1.4 Commit
    - After the commands in execution rule 5 pass with zero errors (the two build checks start in task 5), commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Include `.kiro/specs/showcase-site/` in this first commit. Verify every edit landed. Never push.

- [x] 2. Design tokens, contrast and global styles
  - [x] 2.1 Implement the contrast maths and the design tokens
    - Create `site/src/lib/design/contrast.ts` with `relativeLuminance`, `contrastRatio`, `interpolateSrgb` and `worstContrast` (256 samples plus every stop)
    - Create `site/src/lib/design/tokens.ts` with `TOKENS`, `GRADIENTS` and `CONTRAST_PAIRS` covering every text, focus, border and graphic pairing the styles use, including text over every gradient; choose an original palette with no AWS brand colour
    - _Requirements: 19.2, 19.3, 6.6_

  - [x] 2.2 Write property test for contrast maths and token compliance
    - **Property 16: Contrast maths is correct and every token pair passes**
    - Keep the AWS brand colour denylist in this test file
    - **Validates: Requirements 6.6, 19.2, 19.3**

  - [x] 2.3 Write the global stylesheets
    - Create `site/src/styles/tokens.css` (custom properties equal to `TOKENS` and `GRADIENTS`, every gradient written with `in srgb`), `base.css` (system font stack, focus ring of at least 3:1, 44px minimum block and inline size on buttons and navigation links), `layout.css` (one responsive layout, reflow at 320px, no fixed or sticky positioning), `components.css`, `forced-colors.css` and `motion.css`; import them from `index.css`
    - Write `site/test/design/tokens-css.test.ts` asserting `tokens.css` declares exactly the values in `TOKENS` and `GRADIENTS`, that no stylesheet uses `position: fixed` or `position: sticky`, and that a `forced-colors` and a `prefers-reduced-motion` block exist
    - _Requirements: 4.5, 19.4, 19.5, 19.10, 19.11, 20.2, 21.5_

  - [x] 2.4 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 3. Time formatting and content modules
  - [x] 3.1 Implement event local time formatting
    - Create `site/src/lib/time/time-format.ts` with `formatWallClock`, `offsetLabel`, `formatInZone`, `dayHeading` and `timezoneNote`
    - _Requirements: 9.5, 18.1_

  - [x] 3.2 Write property test for time formatting
    - **Property 9: Event local time formatting preserves the wall clock**
    - **Validates: Requirements 9.5, 18.1**

  - [x] 3.3 Implement the content modules
    - Create `site/src/lib/content/content-block.ts` and the blocks in `story.ts`, `metaphor.ts`, `acts.ts`, `principles.ts`, `install.ts`, `privacy.ts` and `notice.ts`, each naming its Source_Document and section, with verbatim blocks for the tagline, "Starts 10:30", "Seat released at 10:20", "Unofficial. Your badge is your ticket." and the Notice
    - Use the scanner list from the build plan and product steering (Terraform, AWS CDK TypeScript, AWS SDK for JavaScript v3, boto3), not the longer list in `CONCEPT.md` section 3
    - Write the privacy blocks from build plan section 4.2 (what stays, what leaves and for how long, the hand-off, `forget_me`, the responsible party, no remote deletion) and the site's own behaviour
    - Write the install blocks: plan on a computer, board on any device; the Kiro "Import power from GitHub" steps from the Kiro docs; `npx reinvent-compass` and `npx reinvent-compass demo`; Node.js 24 or later; copy and copy-failure messages; leave the other MCP clients section empty until S3 merges
    - Create `site/src/lib/content/links.ts` with `SiteLinks` (repository URL from `CONCEPT.md` section 12, null for the post, the video and the Kiro listing) and `footerItems`
    - _Requirements: 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 6.1, 6.2, 6.3, 6.8, 14.1, 14.2, 14.4, 14.5, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x] 3.4 Write example tests for content provenance and links
    - Every verbatim block occurs exactly in its Source_Document file; every block names an allowed source; the Notice equals the `README.md` sentence; the impersonation denylist appears nowhere in content; no content string contains an em dash or en dash
    - `footerItems` keeps the fixed order and renders a null URL as "coming soon" text with no link
    - _Requirements: 4.2, 4.3, 6.1, 6.2, 6.3, 6.4, 6.7_

  - [x] 3.5 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 4. Shell, home, install and privacy pages
  - [x] 4.1 Implement the Shell
    - Create the app component, `site-header`, `site-footer`, `SiteTitleStrategy` (`<page> | re:Invent Compass`) and `focus-on-navigate` (focus the page `<h1>` after each navigation except the first, through `afterNextRender`), with the pure helper `site/src/lib/shell/focus.ts` and its test
    - Skip link first; header with four links in a wrapping list; one `<main id="main" tabindex="-1">`; footer with the Notice and the links from `footerItems`; nothing fixed or sticky
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 19.6, 19.7, 19.8, 19.9_

  - [x] 4.2 Implement the Home_Page
    - Hero with the name and tagline; the "Starts 10:30" versus "Seat released at 10:20" illustration as text plus original inline SVG; the metaphor as a table with column headers; Plan, Board and Fly cards; principles; Demo and Install as the two primary actions; the unofficial pass statement
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 19.8, 19.12_

  - [x] 4.3 Implement the Install_Page
    - Sections from `content/install.ts`; "Add to Kiro" only when `kiroPowerListing` is set, else the GitHub import steps; the npx commands with copy buttons using `navigator.clipboard.writeText` and a polite live region; the hooks note
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [x] 4.4 Implement the Privacy_Page
    - Three sections from `content/privacy.ts`, the responsible party, `forget_me`, and the no remote deletion statement
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x] 4.5 Add the original artwork and its manifest
    - Create original SVG artwork (favicon and the home illustration) in `site/public/artwork/` and `site/ARTWORK.md` listing each file, its author and that it is original; no AWS logo, mark, colour or trademark artwork; fixed dimensions on every image
    - Extend the static checks: every file in `site/public/` is listed in `ARTWORK.md`, and only `.svg`, `.txt` and `.ico` files exist there
    - _Requirements: 6.4, 6.5, 21.5_

  - [x] 4.6 Verify the build and prerender
    - Run `npx tsc -b` and `npx ng build` from `site/`; open the prerendered files and confirm the content is in the HTML, with no `<style>` element and no inline script
    - _Requirements: 1.3, 3.1, 3.5_

  - [x] 4.7 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 5. Build output check and budget check
  - [x] 5.1 Implement the Build_Output_Check
    - Create `site/scripts/cli.mjs` (a local copy of the S0 `.github/scripts/cli.mjs` pattern: `applyCli`, `isMain`, `maybeRunCli`) and `site/scripts/check-build-output.mjs` with `findOutputIssues`, `expectedRouteFiles` and a pure `runCli`, covering every rule in design Component 17 with a dependency-free tag and attribute scanner
    - Write example tests for each rule, the route list, the Notice and `noindex` placement, and the CLI wiring in-process
    - _Requirements: 3.1, 3.2, 3.5, 3.8, 4.6, 16.7_

  - [x] 5.2 Write property test for the build output check
    - **Property 18: The build output check finds every CSP-breaking construct**
    - **Validates: Requirements 3.1, 3.2, 3.5, 3.8**

  - [x] 5.3 Implement the Budget_Check
    - Create `site/scripts/check-budgets.mjs` with `gzipSize`, `initialFiles`, `closure`, `demoFiles`, `evaluateBudgets` and a pure `runCli` reading `index.html` and `stats.json` (limits 250,000 and 150,000 bytes gzip)
    - Write example tests for a real-shaped `stats.json` and the CLI wiring in-process
    - _Requirements: 21.1, 21.2, 21.4_

  - [x] 5.4 Write property test for the budget check
    - **Property 17: The budget check measures and classifies chunks correctly**
    - **Validates: Requirements 21.1, 21.2, 21.4**

  - [x] 5.5 Run both checks on the current build
    - Build, then run both checks from `site/`; fix any finding in the site (never weaken a rule); record the measured sizes in the commit body
    - _Requirements: 3.8, 21.4_

  - [x] 5.6 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, the build prerenders five routes, and both build checks pass; ask the user if questions arise.

- [x] 7. Board logic: fragment, request, validation and states
  - [x] 7.1 Implement the fragment parser
    - Create `site/src/lib/board/fragment.ts` with `HandoffId`, `FragmentResult` and `parseBoardFragment` (exact `#h=` form, 22 base64url characters, last character in `A`, `Q`, `g`, `w`; no trimming or decoding)
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 7.2 Write property test for the fragment parser
    - **Property 1: The fragment parser accepts exactly the canonical hand-off ids**
    - **Validates: Requirements 16.1, 16.2, 16.3**

  - [x] 7.3 Implement the hand-off client
    - Create `site/src/lib/board/handoff-client.ts` with `buildHandoffRequest` (relative `/api/v1/handoffs/<id>`, GET, credentials omitted, `cache: 'no-store'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, Accept JSON, no body) and `fetchHandoff` (one fetch call, injected timers, 10 second abort, outcomes `ok`, `status`, `notJson`, `network`, `timeout`, no retry)
    - _Requirements: 16.6, 17.1, 17.2_

  - [x] 7.4 Write property test for the hand-off request
    - **Property 3: The hand-off request is one same-origin GET carrying the id only in the path**
    - **Validates: Requirements 16.6, 17.1, 17.2**

  - [x] 7.5 Implement the hand-off view validator
    - Create `site/src/lib/board/handoff-view.ts` with `validateHandoffView` enforcing Requirement 17 criteria 3 to 5 (types, no unknown fields, UUID serials, date-times with offset, 1 to 80 sessions, bundle paths for the same id in order and within the bundle limit, calendar path for the same id or null, Google save URL on `https://pay.google.com/gp/v/save/` with no user info or port, or null), returning `ValidatedHandoff` with bundle pass ranges, or `null`
    - Add the two-way compile-time assertion against `CompassApi.components['schemas']['HandoffView']`
    - _Requirements: 17.3, 17.4, 17.5, 17.6_

  - [x] 7.6 Write property test for hand-off view validation
    - **Property 4: Hand-off view validation is all or nothing**
    - **Validates: Requirements 17.3, 17.4, 17.5, 17.6**

  - [x] 7.7 Implement the board state machine and view model
    - Create `site/src/lib/board/board-state.ts` with `BoardState`, `BoardEvent`, `reduceBoard`, `toBoardViewModel` (constant headings and messages from the design error table, device hint, timezone note, expiry text, session rows, actions only in Ready), `canRetry`, `bundleLabel` ("bundle N of M") and `msUntilExpiry`
    - Create `site/src/lib/board/board-controller.ts` with `createBoardController` (design Component 13b, CTO H4): the hash is read once, `replaceState('/board')` runs before any fetch, an invalid hash causes no fetch, each "Try again" makes exactly one fetch, one expiry timer, `dispose`; every browser function is injected
    - _Requirements: 16.1, 16.3, 16.4, 16.5, 17.2, 17.7, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.9, 22.7_

  - [x] 7.8 Write property test for invalid links
    - **Property 2: An invalid link never sends a request** (against the Board_Controller)
    - **Validates: Requirements 16.3, 16.4, 17.1, 17.2**

  - [x] 7.9 Write property test for outcome mapping
    - **Property 5: Every request outcome maps to exactly one board state**
    - **Validates: Requirements 17.7, 18.1, 18.4, 18.5, 18.7**

  - [x] 7.10 Write property test for id secrecy
    - **Property 6: The hand-off id never reaches visible text, the title or the console**
    - **Validates: Requirements 2.4, 16.5, 16.6**

  - [x] 7.11 Write property test for local expiry
    - **Property 7: Local expiry removes every action**
    - **Validates: Requirements 18.6**

  - [x] 7.12 Write property test for Apple bundle labels
    - **Property 8: Apple bundle labels cover each bundle exactly once**
    - **Validates: Requirements 18.2**

  - [x] 7.13 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 8. Board page component and hand-off fixtures
  - [x] 8.1 Implement the Board_Page
    - Prerender the Reading state with a `<noscript>` message and `<meta name="robots" content="noindex">` for this route only
    - In `afterNextRender`: build the Board_Controller with the browser globals only (`location.hash`, `Location.replaceState`, global `fetch`, `setTimeout`, `clearTimeout`, `Date.now`) and call `start()`; "Try again" calls `retry()`; `ngOnDestroy` calls `dispose()`. The component holds no flow logic
    - Focus the state heading and update the polite live region after each state change; `aria-busy` while loading
    - Action links as plain anchors: Apple bundle paths with `type="application/vnd.apple.pkpasses"`, the Google save URL, the calendar path with `download`; first action visible in the first viewport on iPhone portrait
    - _Requirements: 1.7, 16.1, 16.4, 16.5, 16.7, 18.1, 18.2, 18.3, 18.8, 18.9, 18.10, 20.4_

  - [x] 8.2 Create the hand-off fixtures and their test
    - Create `site/e2e/fixtures/handoff/` with the fixtures listed in design Component 20, all built for one fixed test id and shaped by the contract
    - Write `site/test/board/fixtures.test.ts`: every ready fixture is accepted by `validateHandoffView` and every negative fixture is rejected
    - _Requirements: 17.3, 17.4, 17.5, 22.5_

  - [x] 8.3 Verify the build and both checks
    - Build and run both checks; confirm `board/index.html` carries `noindex`, the `<noscript>` text and no inline script
    - _Requirements: 3.8, 16.7, 21.4_

  - [x] 8.4 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, coverage of Site_Logic is 100%, and both build checks pass; ask the user if questions arise.

- [x] 10. Rules port, demo catalog and demo context
  - [x] 10.1 Implement the Rules_Port and the test double
    - Confirm what `@compass/core/rules` exports on `develop` (execution rule 8); create `site/src/lib/demo/rules-port.ts` with `RulesPort`, `createRulesPort`, `connectionsForDay` and `createDemoContext`, taking every type through `Parameters` and `ReturnType`
    - If `resolveCommitment` (or a connections helper) or `withContextDefaults` is not exported, use the fallback in design Open Questions 1 and keep the Integrator request open
    - Create `site/test/doubles/rules-double.ts` implementing `RulesPort` with scripted answers
    - _Requirements: 8.3, 8.11, 9.1, 9.2, 9.3, 10.1, 10.4, 10.5_

  - [x] 10.2 Curate the Demo_Catalog and the demo context
    - Pick 12 to 24 records from `fixtures/synthetic/catalog.json` covering every pattern in Requirement 7 criterion 3; copy each into `site/src/lib/demo/demo-catalog.ts` normalised to `NormalisedSession` (S1 mapping), with `DEMO_SOURCE_IDS`, `STARTER_WEEK`, `GUIDED_CLASH` and `DEMO_EVENT` (timezone from the records; fixed `now` at 18:00 event local time on the day before the first demo day; window from 00:00 on the first demo day to 23:59 on the last)
    - Create `site/src/lib/demo/venue-data.ts` importing `data/venues.json` read only
    - If a pattern is missing, stop and ask the integrator for an S0 catalog change (execution rule 9)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_

  - [x] 10.3 Write example tests for catalog provenance and venue data
    - Every `DEMO_SESSIONS` entry equals the normalised synthetic record with the same id (S1 `normaliseSession` from `@compass/core/catalog` if merged, else a test-local mapping per the S1 design); every source record validates with `SessionWireSchema`; Requirement 7 criterion 3 coverage holds; `GUIDED_CLASH` reaches a block within three actions; `data/venues.json` validates with the S2 venue data schema
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.10_

  - [x] 10.4 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 11. Demo reducer and week view
  - [x] 11.1 Implement the demo reducer
    - Create `site/src/lib/demo/demo-state.ts` with `DemoState`, `DemoAction`, `DemoDeps`, `EMPTY_DEMO` and `reduceDemo` following the reducer rules in design Component 7 (allow adds; warn waits for `confirmWarn`; block offers rebooking and a safe swap; the swap pre-check and three steps; layovers; remove; reset; announcements with reasons copied unchanged; no clock)
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 13.1, 13.2_

  - [x] 11.2 Implement the week and catalog views
    - Create `site/src/lib/demo/week-view.ts` with `toScheduleInput`, `buildWeekView` (boarding text, connections with the class in words and the Rules_Engine reason, layover lines and suggestions, unknown reasons shown, event local times with one timezone note) and `buildCatalogView` (sessions by day with code, title, type, level, gate or "Venue not published", times and boarding closes)
    - _Requirements: 7.7, 8.1, 9.1, 9.2, 9.3, 9.5, 9.6, 19.12_

  - [x] 11.3 Write property test for guardrail fidelity
    - **Property 10: The demo week follows the guardrail exactly**
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.11**

  - [x] 11.4 Write property test for week consistency
    - **Property 11: The demo week stays consistent**
    - **Validates: Requirements 8.9, 9.4, 13.2**

  - [x] 11.5 Write property test for the safe swap
    - **Property 12: The safe swap runs in order and cancels only after a safe confirmation**
    - **Validates: Requirements 10.4, 10.5, 10.6, 10.7**

  - [x] 11.6 Write property test for determinism
    - **Property 13: The demo is deterministic and clock free**
    - **Validates: Requirements 7.6, 13.1**

  - [x] 11.7 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 12. Sample pass and sample calendar
  - [x] 12.1 Implement the sample pass builder
    - Create `site/src/lib/demo/sample-pass.ts` with `fitTitle` (`normalisePassText`, then 77 characters plus three ASCII dots when longer than 80), `clampWalk` (0 to 90) and `buildSamplePass` (code, title, gate or "Venue not published", seat released time, walk from previous and next connection when known, fixed label and disclaimer, accessible name, PassFields input shape)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 12.2 Write property test for the sample pass
    - **Property 14: Sample pass fields follow the pass rules**
    - **Validates: Requirements 11.2, 11.3, 11.4**

  - [x] 12.3 Implement the sample calendar
    - Create `site/src/lib/demo/ics.ts` with `escapeText`, `foldLine`, `toUtcStamp`, `demoCalendarEvents` and `serialiseCalendar` per design Component 9 (fixed `DTSTAMP`, `.invalid` UIDs, "Boarding closes" and "Leave now" alarms, no alarm for personal time, made-up and unofficial descriptions)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 12.4 Write property test for the sample calendar
    - **Property 15: The sample calendar is valid RFC 5545 with the right alarms**
    - **Validates: Requirements 12.2, 12.3, 12.4, 12.5**

  - [x] 12.5 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 13. Demo page components
  - [x] 13.1 Implement the Demo_Page
    - `DemoPage` holds one `signal` of `DemoState` and dispatches through `reduceDemo`; sub-components (all standalone, external templates, no styles) for the catalog list, the week view, the verdict panel (reasons as a list, "Add anyway" and "Keep my week"), the rebooking and safe swap panel (three visible steps, one button per step), the sample pass (inline SVG, `role="img"`, accessible name, visible text), and the calendar download (Blob plus temporary anchor, disabled with "Add a session first." when empty)
    - Made-up label and "nothing here touches a real schedule" note; "Start with a sample week", the guided clash hint naming `GUIDED_CLASH.tryAdd`, and "Start over"; one polite live region for announcements; event timezone stated once per view
    - _Requirements: 7.5, 8.1, 8.2, 8.5, 8.6, 8.8, 8.9, 8.10, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.3, 10.5, 10.8, 11.1, 11.5, 12.1, 12.6, 13.2, 13.3, 13.4, 19.9, 19.12_

  - [x] 13.2 Verify the build and both checks
    - Build and run both checks; confirm the demo route chunk is within 150 kB gzip and the initial JavaScript within 250 kB gzip, and that `demo/index.html` holds the prerendered session list
    - _Requirements: 21.1, 21.2, 21.4_

  - [x] 13.3 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, coverage of Site_Logic is 100%, both build checks pass and the guided clash works in a local `npx ng serve`; ask the user if questions arise.

- [x] 15. Static server and browser test suite
  - [x] 15.1 Implement the Static_Server and the Required_CSP constant
    - Create `site/scripts/required-csp.mjs` (`REQUIRED_CSP`, the single source) and `site/scripts/serve-static.mjs` (`resolveSitePath` with the extensionless rewrite and 403 for unknown or traversal paths, `contentType`, `SECURITY_HEADERS`, `createStaticServer` on `node:http`)
    - Write unit tests for path resolution, headers and an in-process server on port 0
    - _Requirements: 3.6, 3.7, 22.5_

  - [x] 15.2 Configure Playwright
    - Create `site/playwright.config.ts` with the seven Device_Profiles chosen from the pinned Playwright device registry (assert each descriptor exists), `retries: 0`, `webServer` starting the Static_Server on `site/dist/site/browser/`, and shared helpers in `site/e2e/support/` that wait only on focus, headings and live region text
    - _Requirements: 20.1, 22.3, 22.4, 22.5_

  - [x] 15.3 Write the page, accessibility, forced-colors and layout specs
    - `pages.spec.ts`, `a11y.spec.ts` (axe with WCAG 2.0, 2.1 and 2.2 A and AA tags on every page and every board and demo state), `forced-colors.spec.ts` (Chromium) and `layout.spec.ts` (44 by 44 targets, no horizontal scroll at 320px, no positioned element, the focused element never covered while tabbing on iPhone landscape, board first action in the first viewport)
    - _Requirements: 4.1, 4.2, 4.4, 19.1, 19.4, 19.5, 19.6, 19.7, 19.8, 19.11, 20.1, 20.3, 20.4_

  - [x] 15.4 Write the demo and board specs
    - `demo.spec.ts`: the guided clash (block with reasons announced), the safe swap in three steps, adding the blocked session, the sample pass, and the `.ics` download parsed with `ical.js`
    - `board.spec.ts`: every fixture state through `page.route`; invalid fragments send no request; the fragment is gone from the URL after load; focus on the state heading; local expiry with Playwright's clock
    - _Requirements: 8.6, 8.8, 8.10, 10.5, 10.8, 11.1, 12.1, 16.3, 16.4, 18.1, 18.4, 18.5, 18.6, 18.7, 18.8_

  - [x] 15.5 Write the CSP, privacy and performance specs
    - `csp.spec.ts`: zero `securitypolicyviolation` events under the Required_CSP across every flow
    - `privacy-network.spec.ts`: every request is same-origin; the id appears only in hand-off route paths and in no console message; cookies, web storage and IndexedDB are empty after every flow
    - `performance.spec.ts`: Chromium LCP proxy under throttling below 2.5 seconds on the Home_Page (Lighthouse mobile once the Integrator pins it)
    - _Requirements: 2.2, 2.3, 2.5, 2.7, 3.7, 16.5, 16.6, 21.3_

  - [x] 15.6 Run the browser suite once and fix findings
    - Install the browsers locally (`npx playwright install`), build, run `npx playwright test -c playwright.config.ts` from `site/`, and fix every failure in the site; record the run summary in the commit body
    - _Requirements: 19.1, 20.1, 22.3_

  - [x] 15.7 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 16. README and hand-over notes
  - [x] 16.1 Write `site/README.md`
    - Cover: what the site is; how to build (`npx tsc -b`, then `npx ng build` and both checks from `site/`); unit and browser tests; the output folder for `scripts/release.sh` (`site/dist/site/browser/`); the Required_CSP quoted exactly for S6; the content sources and the verbatim rule; the artwork manifest; the links that change after release (`content/links.ts`)
    - _Requirements: 3.6, 23.4_

  - [x] 16.2 Write the README consistency test
    - Assert `site/README.md` contains `REQUIRED_CSP` exactly and names the output folder
    - _Requirements: 3.6, 23.4_

  - [x] 16.3 Commit
    - After the commands in execution rule 5 pass with zero errors, commit with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 17. Final checkpoint - Ensure all tests pass and coverage is complete
  - Ensure all tests pass with 100% lines, branches, functions and statements for Site_Logic and no named exclusion; lint, format, dash check and the Angular build clean; both build checks pass; ask the user if questions arise.
  - _Requirements: 22.1, 22.2_

- [x] 18. Capture feature screenshots for the Builder Center post
  - [x] 18.1 Save two or three screenshots of the site working
    - From the Static_Server build, capture: the Home_Page on Desktop Chrome; the blocked clash with its reasons in the Demo_Page on the iPhone portrait profile; and the Board_Page Ready state with mocked fixture data on the iPhone portrait profile. Save them to `docs/article/screenshots/showcase-site/` as PNG files with descriptive kebab-case names. Show only made-up data and the fixture id; no real attendee data
    - _Requirements: 23.5_

  - [x] 18.2 Commit
    - After `npx eslint .`, `npx prettier --check .` and `npm run check:dash` pass with zero errors, commit the screenshots with scope `showcase-site` (subject plus body via multiple `-m` flags, no attribution trailer). Never push.

- [x] 19. Strip HTML comments until none remain in the build output check (CodeQL alert 2, design "Post-CodeQL change")
  - [x] 19.1 In `site/scripts/check-build-output.mjs`, repeat the comment removal until the text stops changing before looking for the Notice text
    - Why: CodeQL js/incomplete-multi-character-sanitization. This script only checks our own prerendered pages at build time, so it is not a security boundary, but a crafted nested comment could have hidden the Notice from the check
    - Tests: a page whose Notice sits only inside nested comment markers fails the check; the normal pages still pass
  - [x] 19.2 Commit after the full gate passes, scoped `showcase-site`. Do not push

- [x] 20. Show the owner's artwork on the hand-off page (owner decision of 20 October, design "Post-SP3 change: board artwork")
  - [x] 20.1 Add `site/public/artwork/pass-background.jpg` (the owner's own picture, 24 KB) and show it as a decorative banner at the top of the Board_Page, `alt=""`, with width and height set, cropped with `object-fit: cover` so the glow line shows
    - Why: Apple Wallet cannot show the picture on a boarding pass, so the attendee sees it where they add their passes. The text stays on the existing solid panel, so contrast does not depend on the picture
    - Same origin, so the CSP `img-src 'self'` already allows it; forced-colours mode keeps the panel border
    - Tests: the banner is present, decorative (empty alt, hidden from assistive technology) and same-origin; the build output check and the budgets still pass
  - [x] 20.2 Commit after the full gate passes, scoped `showcase-site`

- [x] 21. Use the owner's logo in the header and the owner's favicon (owner decision of 20 October, design "Post-SP3 change: owner logo")
  - [x] 21.1 The header brand link shows `artwork/logo.svg` with `alt="re:Invent Compass"` (an image link named by its alt text) instead of the product name in text; `artwork/favicon.svg` is the owner's new map icon
  - [x] 21.2 In `logo.svg`, the year "2026" used AWS's Amazon Ember Display typeface, which visitors do not have installed and which is AWS brand material; it now uses a free heavy sans-serif stack (Segoe UI Black, Arial Black, Arial, sans-serif). ARTWORK.md lists both files as the owner's artwork
  - [x] 21.3 Tests: the header image has the product name as alt text, both SVGs have no script and no external reference, the static check still finds no AWS mark; build, budgets and a browser check at desktop and phone width; commit scoped `showcase-site`

## Notes

- There are no optional tasks. 100% coverage of Site_Logic (Requirement 22.1) is part of the definition of done, so every test task is mandatory.
- Each task references specific requirements; every property test names its property number and the requirements it validates. Property tests use `fast-check` 4.10.2 (root devDependency, at least 100 runs each) and are tagged `// Feature: showcase-site, Property {n}: {text}`.
- Checkpoints (tasks 6, 9, 14 and 17) validate incrementally; the final checkpoint confirms the definition of done.
- Commits use Conventional Commits scoped `showcase-site`, with subject and body passed through multiple `-m` flags, no commit message file, no Co-Authored-By trailer and no AI or tool attribution. Never push, merge, open a pull request or tag. No em dashes or en dashes anywhere.
- Never call the live Events API or a deployed Compass API from any test. Browser tests mock the hand-off routes with the fixtures in `site/e2e/fixtures/handoff/`.
- `contracts/**`, `packages/**`, `data/venues.json` and `fixtures/synthetic/**` are read only for this stream.

### Integrator requests (changes outside `site/**`)

1. **Root unit tests.** Make the root `npm test` run the site suite with its coverage thresholds (for example a vitest `projects` entry for `site/vitest.config.ts`, or adding `site/test/**/*.test.ts` to `include` and `site/src/lib/**/*.ts` and `site/scripts/**/*.mjs` to coverage `include`). The site needs no named coverage exclusion.
2. **Root scripts.** Root `package.json`: make `build` run the site build after `tsc -b` (for example `tsc -b && npm run build --workspace site`), and add `e2e` running `npm run e2e --workspace site`, so `check.yml` and `e2e.yml` pick them up.
3. **Site scripts.** `site/package.json` scripts: `build` (`ng build && node scripts/check-build-output.mjs && node scripts/check-budgets.mjs`), `e2e` (`playwright test -c playwright.config.ts`), `typecheck` (`tsc -p tsconfig.json --noEmit`).
4. **e2e workflow.** `.github/workflows/e2e.yml`: add a step that installs the Playwright browsers (`npx playwright install --with-deps`) before `npm run e2e`, and a Lighthouse step once request 5 lands.
5. **Dependency to add (exact pin):** `lighthouse`, for the Lighthouse mobile LCP budget (Requirement 21.3). Until it lands, `performance.spec.ts` runs a Chromium LCP proxy.
6. **Conditional dependency:** `jsdom` (exact pin) only if the CTO decides components need unit tests (design Open Questions 3). Not needed by this design.
7. **Optional dependency:** `@angular-eslint/eslint-plugin-template` (exact pin, same version as the pinned angular-eslint packages) to lint templates for accessibility; axe in the browser suite covers the same ground meanwhile.
8. **S2 exports.** Export `resolveCommitment` (or a helper that lists a day's connections) and `withContextDefaults` from `@compass/core/rules` (design Open Questions 1).
9. **S6 edge.** Set the Required_CSP (quoted in `site/README.md`) in the CloudFront response headers policy; confirm the viewer-request function rewrites `/demo`, `/install`, `/privacy` and `/board`; sync `site/dist/site/browser/` in `scripts/release.sh`; cache hashed assets long and HTML short.
10. **S5 contract confirmation.** Confirm `bundlePaths` and `calendarPath` are root-relative paths matching the route templates, and that `boardUrl` is `https://<distribution>.cloudfront.net/board#h=<id>` (design Open Questions 11).
11. **S0 catalog (only if needed).** If the synthetic catalog lacks a demo scenario in Requirement 7 criterion 3, add one through an S0 change; the site never invents sessions.
12. **Links after release.** The Builder Center post and video URLs ship in a one-file `hotfix/1.0.1` change to `site/src/lib/content/links.ts` after submission (design Open Questions 6).
13. **Root ESLint and `.html` files (done).** The root `eslint.config.js` now gives `site/**/*.html` the disableTypeChecked config, and `site/eslint.config.mjs` was deleted.
14. **Coverage exclusion ADR (CTO M10).** Record an ADR that `site/src/app/**` is a named coverage exclusion, with the site `vitest.config.ts` coverage scope as the evidence, and add it to the build plan section 11.2 list.
15. **DONE in this branch after S2 merged into develop (8e1277b): the demo is wired to the real engine and `data/venues.json`.** Kept for the record; the two edits below were made. (a) `site/src/lib/demo/venue-data.ts`: replace the null seam with `import venueFile from '../../../../data/venues.json'; export const DEMO_VENUE_DATA: unknown = venueFile;`. (b) `site/src/lib/demo/rules-port.ts`: replace the namespace import with named imports of the eight functions (so the bundler drops unused engine code and zod), then run `check-budgets` to confirm the Demo_Page chunk stays under 150 kB gzip. `site/test/demo/real-engine.test.ts` runs the guided path and properties against the real engine. Measured with the engine: Demo_Page chunk 120945 bytes gzip of 150000 (the engine's zod schemas are most of it), so watch that chunk when S2 or the contracts change.
16. **S1 normaliser at merge (done).** `site/test/demo/demo-catalog.test.ts` now compares the demo catalog with `normaliseSession` from `@compass/core/catalog`; the test-local normaliser was deleted.
17. **CSP changes from the requirements (S6 and `site/package.json`).** The Required_CSP uses `base-uri 'self'` instead of `'none'` because the pages carry `<base href="/">` (design deviation 20); `site/README.md` quotes the exact value and `site/scripts/required-csp.mjs` is the single source. Declare `zod` (already pinned at 4.6.7 in the workspace) in `site/package.json`: `site/src/lib/demo/zod-jitless.ts` imports `zod/v4/core` to stop zod's `new Function` probe, which a strict CSP reports as a violation.
18. **Firefox profile not run here.** The Firefox browser is not installed on the build machine. Run `npx playwright install firefox` and the `desktop-firefox` project before the freeze (`e2e.yml` installs all browsers).
19. **Tests that time out on a loaded machine.** `packages/contracts/test/placeholder-safety.test.ts` (Property 9, once 20 s for one case), `packages/contracts/test/catalog-deterministic.test.ts` and `packages/core/test/rules/public-surface.test.ts` (5 s limit) each timed out once while the root suite ran next to browser tests, and passed alone or on the next run. Consider a longer timeout.

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
        "2.1",
        "2.2",
        "2.3",
        "2.4",
        "3.1",
        "3.2",
        "3.3",
        "3.4",
        "3.5",
        "4.1",
        "4.2",
        "4.3",
        "4.4",
        "4.5",
        "4.6",
        "4.7",
        "5.1",
        "5.2",
        "5.3",
        "5.4",
        "5.5",
        "5.6",
        "7.1",
        "7.2",
        "7.3",
        "7.4",
        "7.5",
        "7.6",
        "7.7",
        "7.8",
        "7.9",
        "7.10",
        "7.11",
        "7.12",
        "7.13",
        "8.1",
        "8.2",
        "8.3",
        "8.4",
        "10.1",
        "10.2",
        "10.3",
        "10.4",
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
        "12.5",
        "13.1",
        "13.2",
        "13.3",
        "15.1",
        "15.2",
        "15.3",
        "15.4",
        "15.5",
        "15.6",
        "15.7",
        "16.1",
        "16.2",
        "16.3",
        "18.1",
        "18.2"
      ]
    }
  ]
}
```
