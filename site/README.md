# re:Invent Compass showcase site

The public website of re:Invent Compass (stream S7), live at https://reinvent-compass.vegas. It tells the story ("From your code to your seat, on time."): Compass scans the code you work on and finds the re:Invent sessions that match your stack. It runs a click-through demo on real re:Invent 2026 sessions (a simulated week), explains how to install Compass and what leaves your machine, and serves the `/board` page that a phone opens from the QR code to add unofficial boarding passes to Apple Wallet or Google Wallet.

re:Invent Compass is an independent community project and is not affiliated with, endorsed by, or sponsored by Amazon Web Services.

It is a static Angular 22.2.3 site (standalone components, zoneless, prerendered with `outputMode: "static"`). It has no sign-in, no cookies, no browser storage, no analytics and no request to another origin. The only network call it ever makes is `GET /api/v1/handoffs/{handoffId}` on `/board`.

## Pages

Fourteen routes, all prerendered:

| Route             | What it is                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`               | The story: the code scan, boarding closes at 10:20, the airline metaphor, Plan, Boarding, Fly, three promises                                                        |
| `/demo`           | The demo on real sessions, using the real rules engine, a sample pass and a sample calendar                                                                          |
| `/install`        | The Kiro MCP setting, the power folder import and how to update the Power, the two npx commands, Node.js 24, Claude Desktop, VS Code and the Kiro CLI, and live mode |
| `/privacy`        | What stays on your machine, what leaves it and for how long, forget_me, what this site does                                                                          |
| `/about`          | The Creator: a product summary, the owner's biography, photo and links                                                                                               |
| `/inspiration`    | The Inspiration: the owner's story, quoted from `site/content/creator-and-inspiration.md`                                                                            |
| `/documentation`  | Links to the README, one link for each wiki section, the Kiro specs and the project board                                                                            |
| `/videos`         | The Video Library: the project videos on YouTube, each with a short description                                                                                      |
| `/builder-center` | Builder Center: the articles, the hackathon project and the creator profile on AWS Builder Center                                                                    |
| `/disclaimer`     | Unofficial, not a ticket, the demo data credit, warranty and trademarks                                                                                              |
| `/copyright`      | The copyright line, the Apache License 2.0 and the name and logo rule                                                                                                |
| `/terms`          | Terms of use for the site, the MCP server, the Kiro Power and the Compass GitHub App                                                                                 |
| `/security`       | How to report a problem, how secrets and tokens are handled, and the scope                                                                                           |
| `/accessibility`  | The WCAG 2.2 AA aim and how it is tested                                                                                                                             |
| `/credits`        | The main open-source libraries and their licences                                                                                                                    |
| `/board`          | The hand-off page. It reads `#h=<id>` from the address, removes it, and shows the passes you can add (`noindex`)                                                     |

Every page sets its own title, `og:title`, `og:url` and canonical link to its address on https://reinvent-compass.vegas (`SiteTitleStrategy`, with `pageUrl` in `src/lib/shell/title.ts`); `src/index.html` carries the description, `og:description` and `twitter:card`. There is no `og:image`, because `public/` takes no PNG files.

## Build

From the repository root:

```sh
npx tsc -b                # builds @compass/contracts and @compass/core (the site resolves them from dist)
cd site
npx ng build              # prerenders the sixteen routes
node scripts/check-build-output.mjs   # CSP and site rules on every built HTML file
node scripts/check-budgets.mjs        # JavaScript budgets, gzip
```

The output folder for `scripts/release.sh` is **`site/dist/site/browser/`**. It holds `index.html` and one `<route>/index.html` for each of the other thirteen routes (`expectedRouteFiles` in `scripts/check-build-output.mjs` lists them), the hashed JavaScript and CSS files, and `artwork/`. (`index.csr.html` is the client-side fallback Angular also writes.) Cache the hashed files for a long time and the HTML files for a short one.

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

The site is built to run under this Content-Security-Policy. CloudFront sends it from the site response headers policy (`aws_cloudfront_response_headers_policy.site` in `infra/modules/edge`):

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests
```

`scripts/required-csp.mjs` is the single source and a test compares this README with it. There is no inline script, handler or style in the built HTML (the Build_Output_Check proves it), no component styles, and no `innerHTML`. `base-uri` is `'self'` because the pages carry `<base href="/">`.

The local Static_Server speaks plain http, and WebKit would rewrite the page's own requests to https under `upgrade-insecure-requests`, so for local runs only it sends the same policy without that one directive (`LOCAL_CSP`). CloudFront sends the full policy above.

The same headers policy also sends `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (the pages also carry `<meta name="referrer" content="no-referrer">`) and the `Permissions-Policy` from `scripts/required-permissions-policy.mjs`, which allows only `geolocation=(self)` for Walk from here. A test in `infra` compares that policy with `infra/modules/edge/locals.tf`.

## Content and where it comes from

Every unit of copy is a content block in `src/lib/content/` that names its source document and section. A block marked verbatim must appear exactly in that document, and a test checks it. The sources (`SourceDocument` in `src/lib/content/content-block.ts`) are:

- `CONCEPT.md`, `README.md`, `.kiro/steering/product.md` and `.kiro/steering/tech.md`
- `wiki/Privacy.md`, `wiki/Data-and-Privacy.md`, `wiki/Decisions-Architecture.md` and `wiki/Getting-Started.md` (the privacy page, log retention and point-in-time recovery, the hand-off link, the hooks note)
- `KIRO-SPEC-PROMPTS.md` (the `npx reinvent-compass demo` line)
- `.kiro/specs/showcase-site/requirements.md` (statements about how this site behaves)
- `packages/mcp-server/README.md` (the code scan, the client setup, live mode, read-only by default, GitHub, updating the Power and what leaves your machine)
- `NOTICE`, `LICENSE` and `SECURITY.md` (the legal and security pages)
- `site/content/creator-and-inspiration.md` (The Creator and The Inspiration)
- `wiki/Hackathon.md` (the demo data rule and its credit)
- `wiki/Decisions-Product-and-Scope.md` (Walk from here)
- the official Kiro powers installation page at kiro.dev

Where a source conflicts with the code, the code wins, then the wiki. There are no testimonials, no invented numbers and no invented features.

The demo sessions are 17 real sessions of the re:Invent 2026 catalog, read from the AWS Events API and committed as `src/lib/demo/demo-sessions.json` (code, title, start, end, venue and room only, credited to the AWS Events API). `node site/scripts/make-demo-sessions.mjs` rebuilds the file from a local copy of the catalog cache by an explicit list of codes, and refuses to write an unofficial venue or a time outside the event window. Seats and reservations in the demo are demo settings, not catalog data.

## Artwork

Every file in `public/` is listed with its author in [ARTWORK.md](ARTWORK.md). The drawings are original SVG. The exceptions are the vendors' official "Add to Apple Wallet" and "Add to Google Wallet" badges on the board page and the owner's own photo and link images (WebP) on The Creator page. There is no AWS brand colour, and `public/` takes no PNG files.

## Things that change after release

- `src/lib/content/links.ts`: the Builder Center post and the video are shown as "coming soon" text until their addresses are set. The Kiro power listing (`kiroPowerListing`) works the same way. These ship as a one-file change.
- The npx commands, the client setup and the npm line on the Home and Install pages take the npm version from `packageVersion` in the same file. A new release changes that one value.
- The Install page gives one "Import power from GitHub" address: the `power/` folder URL. SP1 recorded on 4 November that Kiro imports the folder URL and refuses the repository root. The option is one data entry (`kiroImportOptions` in `src/lib/content/install.ts`).
- Setup for Claude Desktop, VS Code and the Kiro CLI is on the Install page, from `packages/mcp-server/README.md` (`OTHER_CLIENTS` and `clientConfig` in `src/lib/content/install.ts`).

## Layout

```text
site/
  src/app/        Angular components (no decisions): shell, pages
  src/lib/        Site_Logic: content, time, design tokens, board, demo
  src/styles/     global stylesheets (tokens, base, layout, components, forced colors, motion)
  public/         SVG artwork, the vendor wallet badges and the owner's WebP images (see ARTWORK.md)
  scripts/        build checks and the local static server
  test/           vitest unit, property and static source tests
  e2e/            Playwright specs and hand-off fixtures
```
