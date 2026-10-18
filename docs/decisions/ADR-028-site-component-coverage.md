# ADR-028 Site component coverage exclusion

Status: Accepted, 2026-10-18 (CTO decision during the S7 spec review, integrator record).

## Context

Build plan section 11.2 requires 100% unit coverage with named exclusions only. The S7 showcase site is Angular 22 with standalone, zoneless components. Unit-testing the components would need a DOM test environment (jsdom), which is not pinned in the workspace and adds a dependency for little gain.

## Decision

- Every decision in the site lives in plain TypeScript under `site/src/lib/**` and `site/scripts/**`, which is covered to 100% by vitest with no ignore comments.
- `site/src/app/**` (the Angular components and templates) is a **named coverage exclusion**. Components only wire browser globals and render state that the library computes.
- The components are covered instead by the Playwright and axe browser suite (`site/e2e/`), across seven profiles: desktop Chromium, Firefox and WebKit, and iPad and iPhone in portrait and landscape (all WebKit).
- A static test keeps decisions out of components (no fetch, switch, JSON.parse or regex literals under `src/app`).

## Consequences

- CI runs the site unit suite (`npm run test:site`) and the site build checks (`npm run build:site`). The browser suite runs in `e2e.yml` (on demand), which is now a real job: it type checks, builds the site, installs Chromium, WebKit and Firefox with `npx playwright install --with-deps`, runs `npm run e2e` on all seven profiles and uploads the HTML report as an artifact. The first local run of all seven profiles had 612 passed, 60 skipped and 0 failed.
- A decision added to a component is a review finding: move it into `site/src/lib/**` with a unit test.

## Source

- re:Invent Compass build plan, section 11.2.
- S7 spec, design Open Question 3, and the CTO spec review M10 (17 October 2026).
