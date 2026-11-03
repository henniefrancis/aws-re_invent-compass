# Docs audit and wiki draft, 3 November 2026

Branch `docs/audit-2026-11-03`, cut from `origin/develop` at 742862a. Work done overnight on 2 to 3 November 2026 for the owner's review. Nothing here is published: the wiki is drafted in `wiki/`, and the live wiki, the board, `develop` and `main` are untouched.

## Summary

- **A new wiki, drafted in `wiki/`:** 46 pages plus `_Sidebar.md` and `_Footer.md` (about 66,000 words), in the structure the owner asked for: Home, Getting started, User guide, Architecture, Key decisions, Developer guide, Operations, How it was built, Reference, FAQ and the Disclaimer. Every page says who it is for, links jargon to the glossary, uses full GitHub links for repo files, carries no ADR numbers (except the decisions index), no task or tracker codes (except board placeholders) and no em or en dashes. Every fact was checked against code, contracts, data, Terraform or package.json, not against other docs. A script confirmed every internal page link and anchor resolves and every linked repo path exists.
- **Repo fixes:** 25 commits. They correct facts in the README, CONTRIBUTING, SECURITY, CONCEPT, the steering files, the package READMEs, the site README and two site content blocks, and point the README and SECURITY documentation links to the wiki pages. The README status line is untouched.
- **Earlier brief:** before the change of direction, the first brief asked for a full docs audit, so seven commits also correct facts in `docs/` (ADRs, runbooks, build plan, hackathon rules, demo script) and in the spec design and requirements files. They are listed under "Commits outside the new brief" so the owner can drop them.
- **Measured:** `npm test` 245 files, 3,025 tests, 100% coverage; `npm run test:site` 40 files, 453 tests, 100% coverage.
- **Could not reach:** the live site (https://reinvent-compass.vegas), most external documentation hosts and the board. The session's network policy blocks them, so the live-site comparison, most external link checks and the board review are listed under "Could not verify".
- **Needs the owner:** the AWS architecture image (not in the repo), 18 board placeholders, a site privacy change to approve, a NOTICE wording question, and the docs proposed for deletion (four tests and site content read some of them).

## Gate results (3 November 2026, on this branch)

| Check                                                                                                      | Result                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`, `lint`, `format:check`, `check:hash`, `check:placeholders`, `check:dash`, `check:catalog` | all pass                                                                                                                                                                                                               |
| `npm test`                                                                                                 | 245 files, 3,025 tests passed; 100% statements (9769/9769), branches (5558/5558), functions, lines                                                                                                                     |
| `npm run test:site`                                                                                        | 40 files, 453 tests passed; 100% statements (1296/1296), branches (941/941), functions, lines                                                                                                                          |
| `npm run build:site`                                                                                       | pass                                                                                                                                                                                                                   |
| `npm run e2e`                                                                                              | Only Chromium is installed here (build 1243; Playwright 1.64.1 expects 1248). The `desktop-chromium` profile run against that browser: 180 passed, 2 skipped. WebKit and Firefox (the other six profiles) were not run |

The session runs Node 22.23.4; the project asks for Node 24 or later, so the CI run on `develop` is the final word.

## How to publish the wiki (after approval)

Run these on the owner's machine once the PR is reviewed. They replace the current wiki content with the drafted pages.

```bash
git clone https://github.com/henniefrancis/aws-re_invent-compass.wiki.git compass-wiki
```

```bash
cd compass-wiki && git rm -q -r --ignore-unmatch . && cp -R ../aws-re_invent-compass/wiki/. . && git add -A && git status --short
```

```bash
git commit -m "Wiki: structured documentation for re:Invent Compass" && git push origin HEAD
```

Before pushing:

1. Copy the AWS architecture image into `wiki/images/compass-architecture.png` (the page `AWS-Architecture` shows it first; the file is an owner draft and is not in the repo).
2. Replace every `[board: <id>]` placeholder (list below) with the card link `https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=<item id>`.
3. The pages link repo files on `develop`. If the wiki is published after `develop` is merged into `main` and the owner prefers `main`, replace `/blob/develop/` and `/tree/develop/` with `/blob/main/` and `/tree/main/`.
4. The old wiki has 99 pages named after files (for example `ADR-003-submission-target-1-november`, `Runbook-release`, `Spec-*`). The commands above remove them. Old links to those pages will show GitHub's "create page" screen.

## Wiki pages written

All pages are `written` and checked. Sources are the code paths named on each page.

| Page                                                                                                                                     | Audience  | Main sources checked                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home, \_Sidebar, \_Footer                                                                                                                | all       | README, NOTICE, site routes                                                                                                                                             |
| Getting-Started                                                                                                                          | attendee  | `packages/mcp-server/src/demo/run-demo.ts`, `cli/run-cli.ts`, `core/src/auth/loopback-server.ts`, `power/`, site demo                                                   |
| User-Guide-Plan, User-Guide-Board, User-Guide-Fly                                                                                        | attendee  | `packages/mcp-server/src/tools/*`, `pass-service/src/apple/pass-template.ts`, `pass-texts.ts`, Google layout, `site/src/lib/board/*`, `core/src/passes/ics-exporter.ts` |
| Guardrail-Rules                                                                                                                          | attendee  | `packages/core/src/rules/*` (defaults in `context.ts`), `data/venues.json` (6 venues, 15 pairs), examples run through the built engine                                  |
| Privacy, Read-Only-By-Default                                                                                                            | attendee  | `pass-service/src/data/keys.ts`, `rate-limiter.ts`, `mcp-server/src/tools/forget-me.ts`, `server/create-server.ts`, `infra/modules/data`                                |
| FAQ, Disclaimer                                                                                                                          | attendee  | the pages above, NOTICE, LICENSE                                                                                                                                        |
| Architecture-Overview, Kiro-Power, MCP-Server, Pass-Service, Showcase-Site, Flows, AWS-Architecture, Security, Data-and-Privacy, Quality | architect | `power/`, `packages/*/src`, `contracts/compass-api.openapi.yaml`, `site/src/app/app.routes.ts`, `site/scripts/required-csp.mjs`, `infra/modules/*`, workflows           |
| Key-Decisions and six Decisions-\* pages                                                                                                 | architect | all 37 decision records, each claim re-checked against code; 11 marked amended, 1 not adopted                                                                           |
| Repository-Layout, Build-and-Test, Contracts, Quality-Gate, Contributing                                                                 | developer | the tree, every `package.json`, `.github/scripts/*` headers, `.github/workflows/*`, `vitest.config.ts`, `packages/core/test/api/live-gate.ts`                           |
| Operations, Release, Alarms, Kill-Switch, Rollback, Secrets, Teardown                                                                    | operator  | `scripts/*.sh`, `scripts/google-wallet-class.mjs`, `publish.yml`, `infra/modules/observability`, `secrets`, `edge`, `bootstrap/budget.tf`; sanitised                    |
| How-It-Was-Built, Kiro-Specs, Steering-and-Hooks                                                                                         | developer | git history, `.kiro/specs/*`, `.kiro/steering/*`, `.kiro/hooks/*`, `power/hook-templates/reinvent-compass.json`, `packages/mcp-server/src/hooks`                        |
| MCP-Tools, Pass-API, Events-API-Coverage, Glossary                                                                                       | developer | `packages/contracts/src/mcp-tools.ts` (24 tools), `tool-registry.ts`, the OpenAPI contract (16 operations), `events-api.openapi.json` (12), `quota-tracker.ts`          |

Facts worth knowing from the check: 24 tools (8 read, 10 write of which 5 change the schedule, 6 local action); 16 pass API operations (11 attendee, 5 PassKit); 12 Events API operations; 6 venues and 30 directed walking times; 5 alarms; 4 secrets; log retention 14 days; Lambdas `nodejs24.x`, arm64, 512 MB, 15 s (api) and 5 s (passkit); WAF 8 rules with per-IP limits of 600 (API), 300 (PassKit) and 3,000 (site) per 5 minutes; region us-east-1.

## Repo documents checked

Status: **correct** (no change needed), **fixed** (changed in this PR), **needs owner** (see the owner decisions).

| Path                                                 | Status      | Note                                                                                                                                      |
| ---------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| README.md                                            | fixed       | 16 pass API operations; site demo and Compass API live; guardrail, privacy and live-test facts; doc links to the wiki. Status line: owner |
| CONTRIBUTING.md                                      | fixed       | Lists every check CI runs                                                                                                                 |
| SECURITY.md                                          | fixed       | Design links point to the wiki. Private vulnerability reporting is enabled (GitHub API)                                                   |
| NOTICE                                               | needs owner | Trademark sentence, see owner decisions                                                                                                   |
| LICENSE                                              | correct     | Apache-2.0; copied into the npm package by `packages/mcp-server/scripts/build.mjs`                                                        |
| CONCEPT.md                                           | fixed       | A dated note says it is kept as approved on 15 October and names what the build changed                                                   |
| KIRO-SPEC-PROMPTS.md                                 | needs owner | A record of prompts; dates and details are history (submit 1 Nov, `.mjs` spikes, PostToolUse hook)                                        |
| packages/mcp-server/README.md                        | fixed       | Name never sent in 0.1.0; Google gets the object at issue. Two owner items                                                                |
| packages/pass-service/README.md                      | fixed       | api timeout 15 s, getHandoffApplePass, PUBLIC_BASE_URL, GSI2 only, passkit write keys, read limit, download names                         |
| fixtures/sample-repo/README.md                       | correct     |                                                                                                                                           |
| infra/README.md                                      | fixed       | Bootstrap line                                                                                                                            |
| site/README.md                                       | fixed       | 14 routes, headers CloudFront sends, content sources, artwork exceptions                                                                  |
| site/ARTWORK.md                                      | needs owner | Cites `docs/previews/`, which has never been in git                                                                                       |
| site/src/lib/content/privacy.ts                      | fixed       | No 30-day snapshot purge exists; processors sentence. Owner should approve (privacy text)                                                 |
| site/src/lib/content/acts.ts                         | fixed       | Scanner list adds the AWS SDK for .NET                                                                                                    |
| site/src/lib/content/install.ts                      | needs owner | Not edited because of the unpushed /install commits                                                                                       |
| site/src/lib/content/metaphor.ts                     | needs owner | "Gate: Venue and room" is quoted verbatim from product.md; passes show TERMINAL and GATE                                                  |
| other site content and page templates                | correct     | 12 content files and 14 pages; credits match the real dependency licences                                                                 |
| power/POWER.md, plugin.json, mcp.json, hook template | correct     | Valid JSON; names, version 0.1.0, tools and hooks match the code                                                                          |
| power/skills/\*/SKILL.md                             | correct     | Every tool named exists                                                                                                                   |
| power/skills/first-timer-guide/references/\*.md      | needs owner | Official AWS URLs could not be opened from this session                                                                                   |
| .kiro/steering/product.md, structure.md, tech.md     | fixed       | Scanner list, folders and scripts, ADR range, CI triggers, remote MCP server not bundled, live-test gate                                  |
| .kiro/steering/workflow.md                           | fixed       | Live-test gate                                                                                                                            |
| .kiro/hooks/save-typescript-check.kiro.hook          | correct     |                                                                                                                                           |
| .kiro/specs/\*/design.md and requirements.md (16)    | fixed       | Overview and glossary facts only; numbered criteria left as history (owner list below)                                                    |
| .kiro/specs/foundation-contracts/tasks.md            | fixed       | Task 25 added for this work (ticked at the end)                                                                                           |
| docs/decisions/\*.md (38)                            | fixed       | 10 status lines point to the amending decision; 28 correct                                                                                |
| docs/runbooks/\*.md (10)                             | fixed       | 6 fixed, 2 correct; first-deploy-notes and google-wallet-setup need owner ("Prod is not deployed yet")                                    |
| docs/architecture/build-plan.md                      | fixed       | 13 present-tense facts; history items left                                                                                                |
| docs/hackathon-rules.md                              | fixed       | Two rows; two owner items                                                                                                                 |
| docs/demo/demo-script.md                             | fixed       | The site demo runs on 17 real sessions                                                                                                    |
| docs/spikes-results.md                               | correct     | Dated record                                                                                                                              |
| docs/story/creator-and-inspiration.md                | needs owner | Cites `docs/previews/`, not in the repo                                                                                                   |
| docs/proposals/read-only-wording.md                  | fixed       | One factual error                                                                                                                         |

### Fixes and the source that proves each

Repo files in the new brief:

| File                                     | What was wrong                                                                         | Now                                                                                 | Source                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| README.md                                | Contract has "15 operations"                                                           | 16                                                                                  | `contracts/compass-api.openapi.yaml` (16 operationIds)                                      |
| README.md                                | Click-through demo and live-mode passes "coming soon"                                  | Live, with a link to /demo                                                          | `packages/mcp-server/src/config/compass-api.ts:9`; prod live since 31 Oct                   |
| README.md                                | `send_to_phone` asks "Link or QR code?"                                                | Asks for a link, a QR code or both                                                  | `packages/mcp-server/src/tools/send-to-phone.ts:21`                                         |
| README.md                                | Walk "plus a 10-minute buffer must fit in the gap"                                     | Must fit before boarding closes; estimates already hold 15 minutes, no extra buffer | `packages/core/src/rules/venue-data.ts:67-76`, `connections.ts:3-15`                        |
| README.md                                | Rest listed as a booking guardrail                                                     | Flagged when Compass suggests layovers; no warning on a booking                     | `packages/core/src/rules/check-reservation.ts` (four rules), `layovers.ts`                  |
| README.md                                | No "Leave now" alarm when the walk "does not fit"                                      | Only when the walk is unknown                                                       | `packages/core/src/passes/ics-exporter.ts:156-161`                                          |
| README.md, packages/mcp-server/README.md | An optional name you type is sent                                                      | 0.1.0 never sends a name                                                            | `packages/mcp-server/src/runtime/create-runtime.ts` (no name passed)                        |
| README.md, packages/mcp-server/README.md | Google receives the pass only when you add it                                          | Google gets the object at issue                                                     | `packages/pass-service/src/services/pass-lifecycle.ts:211,251`; `passes-adapter.ts:101`     |
| README.md, tech.md, workflow.md          | Live tests with `COMPASS_LIVE_TESTS=1` alone                                           | Also `COMPASS_LIVE_CONFIRM=yes`, never in CI                                        | `packages/core/test/api/live-gate.ts:14-19`                                                 |
| README.md                                | `docs/` holds "the article draft"                                                      | Article screenshots                                                                 | `git ls-files docs/article`                                                                 |
| CONTRIBUTING.md                          | Listed only part of the CI checks                                                      | Every check in `check.yml` and `e2e.yml`                                            | `.github/workflows/check.yml`, `e2e.yml`                                                    |
| CONCEPT.md                               | Read as current (1 Nov submission, PostToolUse hook, awsevents in the Power, scanners) | Dated note naming the changes                                                       | `docs/hackathon-rules.md:10`, `power/mcp.json`, `packages/core/src/scanner/scan-repo.ts:64` |
| packages/pass-service/README.md          | api timeout 10 s                                                                       | 15 s                                                                                | `infra/modules/api/main.tf:67`                                                              |
| packages/pass-service/README.md          | getHandoffApplePass missing                                                            | Listed                                                                              | `packages/pass-service/src/app/api-app.ts:33`                                               |
| packages/pass-service/README.md          | PUBLIC_BASE_URL a CloudFront domain set in a second apply                              | `https://<domain>`, set by Terraform                                                | `infra/envs/dev/locals.tf:27`                                                               |
| packages/pass-service/README.md          | GSI1 "S6 may drop it"; passkit Query on GSI1; writes `DEV#*` only                      | Table has only GSI2; passkit writes `DEV#*` and `PASSREG#*`                         | `infra/modules/data/main.tf:60`, `infra/modules/api/locals.tf:79`                           |
| packages/pass-service/README.md          | 30 reads per hand-off                                                                  | 30 plus 2 per pass                                                                  | `packages/pass-service/src/data/rate-limiter.ts:25,70`                                      |
| site/README.md                           | Five routes; CSP as a request; artwork "all original SVG"                              | 14 routes; headers CloudFront sends; exceptions named                               | `site/src/app/app.routes.ts`, `infra/modules/edge/main.tf:89-125`, `site/ARTWORK.md`        |
| site/src/lib/content/privacy.ts          | Snapshot "purged 30 days after the event ends"                                         | Replaced on every schedule read, deleted by `forget_me`                             | no purge code; `packages/mcp-server/src/tools/forget-me.ts:41`, `tools/common.ts:32`        |
| site/src/lib/content/privacy.ts          | Google processes the object "when you add a pass to a wallet"                          | From issue                                                                          | `pass-lifecycle.ts:251`                                                                     |
| site/src/lib/content/acts.ts             | Scanner list without .NET                                                              | Adds the AWS SDK for .NET                                                           | `packages/core/src/scanner/detectors/dotnet.ts`                                             |
| SECURITY.md                              | Points to `docs/`                                                                      | Points to the wiki Security and Key decisions pages                                 | the new wiki                                                                                |
| .kiro/steering/structure.md              | Missing `core/src/github`, `core/src/redact`, two scripts, two docs folders; awsevents | Added; awsevents not bundled                                                        | `ls`; `power/mcp.json`                                                                      |
| .kiro/steering/tech.md                   | ADR-001 to ADR-030; check.yml on PRs only                                              | ADR-037; also pushes to develop                                                     | `ls docs/decisions`; `check.yml:16-20`                                                      |
| .kiro/steering/product.md                | Four scanners; remote server "once SP1 confirms"                                       | Five, with .NET; not bundled                                                        | `scan-repo.ts:64`; `power/mcp.json`                                                         |

### Commits outside the new brief

These were made under the first brief (a full docs audit) before the change of direction. They correct facts only, each with its source in the commit message. Drop them if `docs/` and the spec text should stay as they were.

- 637c650 `docs(runbooks)`: typed word `prod`, log group names, WAF site rule, teardown records, infra README.
- f3da800 `docs(decisions)`: ten ADR status lines point to the amending decision; ADR-003 notes the move to 4 November.
- 733a75b `docs`: build plan, hackathon rules and read-only proposal.
- b815ef9 `docs(demo)`: demo script on the real-session site demo.
- e80aab6 and 7b79165 `docs(specs)`, ac388d4 `docs(showcase-site)`: overview and glossary facts in the spec design and requirements files.

## Board placeholders to fill in

The cards are draft items. Their ids could not be read from this session (the GitHub GraphQL API and the board page are blocked), so each needs the owner's local session to replace it with `https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=<item id>`.

| Page             | Placeholder     | Card                                                                   |
| ---------------- | --------------- | ---------------------------------------------------------------------- |
| How-It-Was-Built | `[board: G01]`  | TAM Go/No-Go                                                           |
| How-It-Was-Built | `[board: G03]`  | Prod preconditions gate (prod Google key and class, Apple certificate) |
| How-It-Was-Built | `[board: D02]`  | Builder Center article                                                 |
| How-It-Was-Built | `[board: D03]`  | Demo video                                                             |
| How-It-Was-Built | `[board: S01]`  | Final rules check on submission day                                    |
| Kiro-Power       | `[board: REL1]` | The 0.1.0 release                                                      |
| MCP-Server       | `[board: REL1]` | The 0.1.0 release                                                      |
| MCP-Server       | `[board: BUG1]` | Layover times in the event's time zone                                 |
| MCP-Server       | `[board: BUG2]` | Layovers on badge pickup day                                           |
| MCP-Server       | `[board: CTO1]` | Package metadata and licences                                          |
| Pass-Service     | `[board: GP1]`  | Google layout aligned with the Apple pass                              |
| Pass-Service     | `[board: P05]`  | Google Wallet publishing access                                        |
| Pass-Service     | `[board: PK1]`  | Prod Google key and class, Apple certificate check                     |
| Pass-Service     | `[board: L01]`  | Venue of each session in the hand-off view                             |
| Showcase-Site    | `[board: L01]`  | Walk from here                                                         |
| Showcase-Site    | `[board: RD1]`  | Real sessions in the demo                                              |
| Showcase-Site    | `[board: SD1]`  | Sample pass matches the Apple pass                                     |
| Showcase-Site    | `[board: LEG1]` | Terms, Accessibility, Security and Credits pages                       |

Workstream links (`views/1?filterQuery=workstream%3A%22<Workstream>%22`) are used on How-It-Was-Built, Operations, Quality, Quality-Gate and every component page; they need no filling in.

## Repo docs the wiki replaces, proposed for deletion

The owner decides. Nothing was deleted. Some files are read by tests, site content or steering, so deleting them needs a matching change first.

| File or folder                        | Replaced by                        | Before deleting                                                                                                                                         |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| docs/runbooks/\*.md                   | Operations pages                   | Safe. `infra/tests/static/lib.mjs` scans the folder if present. The first-deploy notes are a dated record; keep a private copy                          |
| docs/decisions/\*.md                  | Key-Decisions and six themed pages | `packages/contracts/test/events-api-provenance.test.ts:55` reads ADR-023; `site` content cites ADR-037; steering `structure.md:78` says ADRs live there |
| docs/architecture/build-plan.md       | Architecture pages and decisions   | Steering `product.md:11` and `tech.md:7` load it with `#[[file:...]]` as the source of truth; site content cites it                                     |
| docs/spikes-results.md                | How-It-Was-Built (spikes)          | Specs cite it                                                                                                                                           |
| docs/proposals/read-only-wording.md   | Read-Only-By-Default               | Safe                                                                                                                                                    |
| docs/hackathon-rules.md               | (owner's compliance record)        | Keep until submission: the submission-day check uses it; site content cites it                                                                          |
| docs/demo/demo-script.md              | (owner's video script)             | Keep until the video is done                                                                                                                            |
| docs/story/creator-and-inspiration.md | (site About pages)                 | Keep: `site/test/content/creator.test.ts:11` reads it                                                                                                   |
| KIRO-SPEC-PROMPTS.md                  | How-It-Was-Built                   | Site content cites it                                                                                                                                   |
| CONCEPT.md                            | Home, How-It-Was-Built             | Keep: site content quotes it verbatim                                                                                                                   |

## Could not verify

- **The live site.** https://reinvent-compass.vegas and dev.reinvent-compass.vegas are blocked by the session's network policy, so the repo-to-live comparison could not run. Indirect evidence: `main` (1218b31) and `develop` (742862a) have identical `site/` trees, so the live text should differ from the repo only by the owner's two unpushed commits and this PR's two site content changes. To run this check, allow `reinvent-compass.vegas` in the session's network settings.
- **External links.** Of 163 external URLs in the docs, 27 returned 200 (GitHub repo pages, developer.apple.com, nodejs.org, the npm registry). The rest are blocked by the proxy: docs.aws.amazon.com, aws.amazon.com, kiro.dev, angular.dev, developers.google.com, developer.hashicorp.com, agent-plugins.org, builder.aws.com and others. They are untested, not broken. The wiki adds only these external links: the board and its views, https://reinvent-compass.vegas, https://www.conventionalcommits.org and https://docs.aws.amazon.com/events/latest/devguide/mcp-server.html.
- **Probably stale link:** `.kiro/specs/events-client/design.md:34` links `github.com/napi-rs/node-rs/tree/main/packages/keyring`; the installed package names `github.com/Brooooooklyn/keyring-node`.
- **The hackathon page.** No official page was reachable; the 6 November deadline is confirmed only second hand.
- **Owner records the code cannot prove:** the Kiro credits running out on 17 October and who wrote which spec; the contract lock on 16 October; the reviews on 29 October; real-device results; branch protection and CodeQL settings; the GitHub App's live settings; npm trusted publisher settings; whether dev has been torn down; whether the prod Google class exists; the Apple certificate expiry; cost figures; the "Kiro Agent: Configure MCP" behaviour.
- **e2e.** Only Chromium is installed in this session; see the gate results.

## The live wiki and the board today

**Live wiki** (read only; one commit, 5597d8d, 1 November, copied from `main` at d3b9ee2; no generator script exists in the repo):

- Home: status line "coming soon" for the site and API, the click-through demo and live-mode passes "coming soon", "15 operations" (16), and the board and wiki bullet missing.
- Concept: submission shown as 1 November. Decisions and ADR-003: no note of the move to 4 November.
- Build-plan-and-architecture: the S3 row says "16 tools" (24).
- Runbook-first-deploy-notes and Runbook-google-wallet-setup: "Prod is not deployed yet". The google-wallet-setup table still plans the deploy for 29 or 30 October.
- Spec-showcase-site-design and -tasks: one commit behind (tasks 47 and 48).
- `_Sidebar`: "Project board" links the repository's Projects tab, not https://github.com/users/henniefrancis/projects/3.
- Not mirrored: `docs/proposals/` and `fixtures/sample-repo/README.md`, although the README said the wiki holds every doc.
- Passed: no dashes, no private data, every relative link and anchor resolves, all 102 repo links exist.

Publishing `wiki/` replaces all of this.

**Board:** it could not be read (the page needs JavaScript or a sign-in, the proxy blocks the API path, GitHub GraphQL is not available, and the GitHub MCP tools have no Projects support; the repository has no issues, so the cards are drafts). What the repo says, for the owner to check by hand:

- Showcase-site tasks 47 and 48 are merged on `develop` and `main` (a693da5, 2 November): Done.
- Showcase-site tasks 41 and 43: every sub-task is ticked and the work is committed, but the parent boxes are not ticked. Task 44 is unticked, but its code is merged (`site/e2e/layout.spec.ts:85`).
- Pass-service task 46 (prod Google key and class, Apple certificate check) is unticked, although prod has been live since 31 October.
- A card that still dates "Submit" on 1 November is stale (now 4 November). The npm publish is on the evening of 3 November.
- Dev teardown is planned "after 1 November" in several places: check the card against whether dev is still up.
- Private data: check no card names the owner's own reserved sessions, the test layover time, the CloudFront distribution id, the bucket name or the other HCP organisation (these were removed from the docs on 1 November; the board was not part of that).

## Known in flight, noted and not changed

- `README.md:11` status line: wrong (says the production site and Compass API are "coming soon"; prod has been live since 31 October). Owned by another session.
- "Prod is not deployed yet": `docs/runbooks/first-deploy-notes.md:3` (owned by another session) and also `docs/runbooks/google-wallet-setup.md:74`.
- `npx --yes reinvent-compass@0.1.0`: intentionally ahead of the 3 November publish. The npm registry already holds `reinvent-compass` 0.0.1 and 0.0.0-stage.
- The two unpushed /install commits: not duplicated.

## Owner decisions

1. **Site privacy text.** The privacy page promised to purge the schedule snapshot 30 days after the event; no code does that. This PR changes the text to match the code. The alternative is to build the purge. `docs/architecture/build-plan.md:136` still states the purge.
2. **NOTICE.** It says "AWS" and "re:Invent" "are used here only to describe compatibility". The accepted residual risks record the owner's own judgement that the name is used as part of a brand. A legal wording choice, so not edited. Also `site/src/lib/content/legal.ts:37` cites NOTICE for an Apple and Google Wallet trademark sentence NOTICE does not contain.
3. **The architecture image.** Add `wiki/images/compass-architecture.png` from the owner's draft before publishing.
4. **Apple pass back text.** `packages/pass-service/src/apple/pass-texts.ts:13` says "Compass never changes your schedule", which is not true when `COMPASS_ALLOW_WRITES=1`. This is shipped pass text, so it was not changed.
5. **Install page.** No "Kiro Agent: Configure MCP" step, the folder import URL differs from the README, and the other MCP clients list is empty (a test requires it). Check against the unpushed /install commits.
6. **Metaphor table.** "Gate: Venue and room" is quoted from `.kiro/steering/product.md:37`; the pass now shows TERMINAL (venue) and GATE (room). Changing it means changing product.md and the site block together.
7. **Missing files.** `docs/previews/` (cited by `site/ARTWORK.md` and `docs/story`) and `docs/article/builder-center-draft.md` (cited by `docs/hackathon-rules.md:27`) are not in the repo.
8. **Prod commit.** `docs/hackathon-rules.md:57` says `main` runs 46f69ac since 1 November; `main` is now 1218b31. Confirm what prod runs before submission.
9. **Dev teardown date.** Several places say "after 1 November"; the submission is now 4 November.
10. **Kiro import.** The "Import power from GitHub" result is not recorded anywhere, but the README and demo script present it as working; the README also says it is not yet recorded which URL form Kiro accepts.
11. **Spec criteria left as history.** Numbered criteria that no longer match the code: compass-power 8.2 (seventeen tools) and its tool-class glossary; pass-service 25.7 (15 operations); infra 4.9, 4.11 (five WAF rules, now 8), 5.6, 5.10 (10 s), 7.1 to 7.3, 8.3 (four alarms), 8.5 and 8.6 (budget 40 and 20 USD, code 60), 9.3, 9.5, 9.6 (three secrets, six retained); showcase-site 1.3 (five routes), 21.3 (Lighthouse), 7 and 15.4 (made-up sessions); boarding-passes 1.2. Amend or leave as history.
12. **Code comments and config text out of step** (not docs, not edited): `scripts/load-secrets.sh:316,379` (old `secrets/secret-shapes.ts` path); `infra/envs/{dev,prod}/variables.tf:98,171` and `infra/modules/secrets/main.tf:55` (origin-verify and public base URL descriptions); `infra/modules/api/tests/api.tftest.hcl:219` (message says 10 s, asserts 15); `packages/pass-service/src/services/handoff-service.ts:99` ("plus 3", code 2); `packages/core/src/api/quota-tracker.ts:16` (ListEvents and GetEvent can be blocked after a 429); `.github/scripts/audit-check.mjs` (the allowlisted advisories no longer match anything; `npm audit` reports none); `.github/dependabot.yml:3-5` ("until after the 1 November submission"); `.env.example` (two unused variables, the incomplete live-test gate); `contracts/compass-api.openapi.yaml` description (CloudFront base URL); `packages/mcp-server/src/cli/run-cli.ts:63` (usage still offers `post-write-sync`); several Terraform variable descriptions point to `docs/runbooks`.
13. **Leakage scan.** `infra/tests/static/lib.mjs` scans `docs/runbooks` for account ids and emails. The wiki operations pages are not scanned; consider adding `wiki/` to that list.
14. **Early commit trailer.** One commit of 15 October (9540f52) carries a co-author trailer. The wiki does not mention it; the owner decides whether the build story should.
15. **First-timer guide sources.** The skill's facts say "checked on 17 October 2026"; re-check the official FAQ before submission.
