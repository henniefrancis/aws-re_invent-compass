# Builder Center screenshots

All images use fixture data only: the made-up synthetic catalog (`fixtures/synthetic/catalog.json`), the simulated mode of Compass, and the mocked hand-off route of the site. No sign-in, no live endpoint, no real name, email, token or identifier appears in any of them. The terminal images are rendered from the real command output (ANSI codes removed) into a dark terminal-style page with Playwright; the site images are Playwright screenshots of the local build.

## Placeholders in `builder-center-draft.md`

| Placeholder in the draft                                                            | Image                                                                                                                                                                                           | Status                                                                                                 |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Hero: an unofficial boarding pass on a phone lock screen showing "Seat released at" | `showcase-site/05-sample-boarding-pass.png` (the sample pass from the demo, rendered at phone scale)                                                                                            | Stand-in. A real lock screen needs a phone with a real pass, which was out of scope.                   |
| The generated week spec open in Kiro, design.md with reasons and connection times   | `compass-power/01-demo-scan-and-plan.png` (scan and plan summary)                                                                                                                               | Not captured. The Kiro editor view needs the Kiro app. The terminal plan summary is the closest image. |
| Demo clash, the guardrail blocking a booking with its plain-English reasons         | `showcase-site/02-demo-guided-clash-blocked.png`, `showcase-site/08-demo-guided-clash-iphone.png`, `compass-power/02-demo-clash-and-safe-swap.png`, `itinerary-rules/01-guardrail-verdicts.png` | Captured.                                                                                              |
| QR hand-off in the terminal                                                         | `compass-power/03-demo-qr-handoff.png`                                                                                                                                                          | Captured. The link never resolves in simulated mode.                                                   |
| A pass in Apple Wallet, then the same pass in expired passes after a cancel         | `showcase-site/06-board-ready-desktop.png`, `showcase-site/07-board-ready-iphone.png` (the /board page with mocked fixture data)                                                                | Not captured. Apple Wallet needs a phone with a real signed pass. The board page is the closest image. |
| The terminal demo ending with "The demo finished. Every step worked."               | `compass-power/04-demo-finished.png` (the whole run is in `compass-power/05-demo-full-run.png`)                                                                                                 | Captured.                                                                                              |

## Every image, by stream

| Spec task              | Folder             | Image                                         | Shows                                                                                |
| ---------------------- | ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| S1 events-client, 20   | `events-client/`   | `01-simulated-sign-in-and-catalog-read.png`   | sign_in, refresh_catalog (120 sessions) and find_sessions for BWP213 and its repeat  |
| S2 itinerary-rules, 18 | `itinerary-rules/` | `01-guardrail-verdicts.png`                   | checkReservation: BWP213 allowed, ARC228 blocked with its reason, BWP213-R allowed   |
|                        |                    | `02-rules-tests-passing.png`                  | the rules test run, 18 files and 424 tests passing                                   |
| S3 compass-power, 31   | `compass-power/`   | `01-demo-scan-and-plan.png`                   | demo steps 1 to 3: sign in, scan, plan                                               |
|                        |                    | `02-demo-clash-and-safe-swap.png`             | demo steps 4 to 6: the blocked clash, the safe swap, the reservation                 |
|                        |                    | `03-demo-qr-handoff.png`                      | demo step 8: the 15 minute link and its QR code                                      |
|                        |                    | `04-demo-finished.png`                        | demo steps 9 and 10 and "The demo finished. Every step worked."                      |
|                        |                    | `05-demo-full-run.png`                        | the whole demo in one image                                                          |
| S4 boarding-passes, 10 | `boarding-passes/` | `01-sample-pass-fields.png`                   | the pass fields built for NET217 (walk from the previous session, next connection)   |
|                        |                    | `02-offline-itinerary-page.png`               | the offline itinerary page, desktop                                                  |
|                        |                    | `03-offline-itinerary-page-iphone.png`        | the same page on an iPhone viewport                                                  |
|                        |                    | `04-passes-tests-passing.png`                 | the passes test run, 15 files and 277 tests passing                                  |
| S5 pass-service, 30    | `pass-service/`    | `01-contract-and-security-suites-passing.png` | the contract and security suites, verbose                                            |
|                        |                    | `02-lambda-bundles-and-test-summary.png`      | both Lambda bundle sizes and hashes, and the full test summary (40 files, 352 tests) |
| S6 infra, 18           | `infra/`           | `01-terraform-fmt-and-tflint-clean.png`       | `terraform fmt -check` and `tflint` with no findings                                 |
|                        |                    | `02-static-infra-tests.png`                   | the static infra tests (62 passed, 2 skipped, 0 failed)                              |
| S7 showcase-site, 18   | `showcase-site/`   | `01-home-desktop.png`                         | the home page at 1440x900                                                            |
|                        |                    | `02-demo-guided-clash-blocked.png`            | the demo, ARC228 blocked against BWP213, at 1440x900                                 |
|                        |                    | `03-demo-safe-swap-done.png`                  | the safe swap finished                                                               |
|                        |                    | `04-demo-sample-boarding-pass.png`            | the sample boarding pass in the demo page at 1440x900                                |
|                        |                    | `05-sample-boarding-pass.png`                 | the sample boarding pass alone, at phone scale                                       |
|                        |                    | `06-board-ready-desktop.png`                  | /board Ready with the mocked fixture route at 1440x900                               |
|                        |                    | `07-board-ready-iphone.png`                   | /board Ready on an iPhone 14 viewport (the one bundle fixture, whole page)           |
|                        |                    | `08-demo-guided-clash-iphone.png`             | the blocked clash on an iPhone 14 viewport                                           |

## Not captured

- A pass on a phone lock screen, a pass in Apple Wallet or Google Wallet, and the expired-passes view after a cancel: all need a real phone and real signed passes.
- The week spec open in Kiro (design.md): needs the Kiro app.
- The S5 local harness round trip log: the harness needs Apple signing files, which are not part of simulated mode. The bundle sizes and test suites are shown instead.
- Trivy, shellcheck and `terraform test` for S6: `terraform fmt`, `tflint` and the static tests were captured; the others were not part of this round.
