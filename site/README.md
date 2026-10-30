# re:Invent Compass showcase site

The public website of re:Invent Compass (stream S7). It tells the story ("From your code to your seat, on time."), runs a click-through demo on real re:Invent 2026 sessions (a simulated week), explains how to install Compass and what leaves your machine, and serves the `/board` page that a phone opens from the QR code to add unofficial boarding passes to Apple Wallet or Google Wallet.

re:Invent Compass is an independent community project and is not affiliated with, endorsed by, or sponsored by Amazon Web Services.

It is a static Angular 22.2.3 site (standalone components, zoneless, prerendered with `outputMode: "static"`). It has no sign-in, no cookies, no storage, no analytics and no request to another origin. The only network call it ever makes is `GET /api/v1/handoffs/{handoffId}` on `/board`.

## Pages

| Route      | What it is                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `/`        | The story: seat released at 10:20, the airline metaphor, Plan, Boarding, Fly, three promises         |
| `/demo`    | The demo on real sessions, using the real rules engine, a sample pass and a sample calendar          |
| `/install` | Kiro Power install steps, the two npx commands, Node.js 24                                           |
| `/privacy` | What stays on your machine, what leaves it and for how long, what this site does                     |
| `/board`   | The hand-off page. It reads `#h=<id>` from the address, removes it, and shows the passes you can add |

## Build

From the repository root:

```sh
npx tsc -b                # builds @compass/contracts and @compass/core (the site resolves them from dist)
cd site
npx ng build              # prerenders the five routes
node scripts/check-build-output.mjs   # CSP and site rules on every built HTML file
node scripts/check-budgets.mjs        # JavaScript budgets, gzip
```

The output folder for `scripts/release.sh` is **`site/dist/site/browser/`**. It holds `index.html`, `demo/index.html`, `install/index.html`, `privacy/index.html` and `board/index.html`, the hashed JavaScript and CSS files, and `artwork/`. (`index.csr.html` is the client-side fallback Angular also writes.) Cache the hashed files for a long time and the HTML files for a short one.

Budgets: initial JavaScript at most 250,000 bytes gzip, and the Demo_Page chunk at most 150,000 bytes gzip. The build checks fail the build and print the measured and allowed sizes.

## Tests

```sh
npx vitest run --coverage --config site/vitest.config.ts    # from the repository root
cd site && npx playwright test -c playwright.config.ts      # browser suite, on demand, after the build
```

- **Unit and property tests** (vitest 4, fast-check, `site/test/`): 100 percent lines, branches, functions and statements over `site/src/lib/**` and `site/scripts/**`, with no exclusion. `site/src/app/**` (the Angular components) is a named exclusion: it holds no decisions, static source tests enforce that, and the browser suite covers it.
- **Browser tests** (Playwright and axe, `site/e2e/`): seven device profiles (Desktop Chrome, Desktop Firefox, Desktop Safari, iPad portrait and landscape, iPhone portrait and landscape), axe with the WCAG 2.0, 2.1 and 2.2 A and AA tags on every page and state, forced colors, a CSP run, a no-other-origin and no-storage check, and a Chromium LCP proxy. They serve the build through `scripts/serve-static.mjs` and mock the hand-off routes with the fixtures in `e2e/fixtures/handoff/`. They never call a deployed API or the live Events API. Install the browsers once with `npx playwright install`.
- The demo is also run against the real rules engine and the real `data/venues.json` (`site/test/demo/real-engine.test.ts`).

## Content security policy

The site is built to run under this Content-Security-Policy (request to S6 for the CloudFront response headers policy):

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests
```

`scripts/required-csp.mjs` is the single source and a test compares this README with it. There is no inline script, handler or style in the built HTML (the Build_Output_Check proves it), no component styles, and no `innerHTML`. `base-uri` is `'self'` because the pages carry `<base href="/">`.

The local Static_Server speaks plain http, and WebKit would rewrite the page's own requests to https under `upgrade-insecure-requests`, so for local runs only it sends the same policy without that one directive (`LOCAL_CSP`). CloudFront should send the full policy above.

Other headers worth setting on the distribution: `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` (the pages also carry `<meta name="referrer" content="no-referrer">`).

## Content and where it comes from

Every unit of copy is a content block in `src/lib/content/` that names its source document and section. A block marked verbatim must appear exactly in that document, and a test checks it. The sources are `CONCEPT.md`, `README.md`, `.kiro/steering/product.md` and `tech.md`, `docs/architecture/build-plan.md` (section 4.2 for the privacy page), `KIRO-SPEC-PROMPTS.md` (the `npx reinvent-compass demo` line), the showcase-site requirements (statements about how this site behaves) and the official Kiro powers installation page. Where a source conflicts with the build plan, the build plan wins. There are no testimonials, no invented numbers and no invented features.

The demo sessions are 17 real sessions of the re:Invent 2026 catalog, read from the AWS Events API and committed as `src/lib/demo/demo-sessions.json` (code, title, start, end, venue and room only, credited to the AWS Events API). `node site/scripts/make-demo-sessions.mjs` rebuilds the file from a local copy of the catalog cache by an explicit list of codes, and refuses to write an unofficial venue or a time outside the event window. Seats and reservations in the demo are demo settings, not catalog data.

## Artwork

All artwork is original, drawn for this site as SVG, and listed with its author in [ARTWORK.md](ARTWORK.md). There is no AWS logo, no Apple or Google badge artwork and no AWS brand colour.

## Things that change after release

- `src/lib/content/links.ts`: the Builder Center post and the video are shown as "coming soon" text until their addresses are set. The Kiro power listing (`kiroPowerListing`) and the npm version pinned in the npx commands (`packageVersion`) work the same way. These ship as a one-file change.
- The Install page shows both "Import power from GitHub" options (the repository address and the `power/` folder) until the day-1 spike SP1 records which one works. The two options are one data entry (`kiroImportOptions` in `src/lib/content/install.ts`).
- Setup for Claude Desktop, VS Code and Kiro CLI is added to the Install page from `packages/mcp-server/README.md` once that file exists (`OTHER_CLIENTS` in `src/lib/content/install.ts`).

## Layout

```text
site/
  src/app/        Angular components (no decisions): shell, pages
  src/lib/        Site_Logic: content, time, design tokens, board, demo
  src/styles/     global stylesheets (tokens, base, layout, components, forced colors, motion)
  public/         original SVG artwork only
  scripts/        build checks and the local static server
  test/           vitest unit, property and static source tests
  e2e/            Playwright specs and hand-off fixtures
```
