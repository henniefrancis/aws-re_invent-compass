_For architects: how the showcase site at reinvent-compass.vegas is built, what its pages do, and why it makes only one network call._

The showcase site is live at [https://reinvent-compass.vegas](https://reinvent-compass.vegas). It explains Compass, runs a click-through demo, and hosts the `/board` page that hands passes to a phone. It is a static Angular 22.2.3 site, prerendered at build time and served from a private S3 bucket through [CloudFront](Glossary#cloudfront). It has no sign-in, no cookies, no browser storage, no analytics and no request to another origin.

## What is inside

| Folder                                                                                           | Role                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [site/src/app](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/src/app) | Angular components: the shell and one folder per page. They hold no decisions.                                                                                                                                                    |
| [site/src/lib](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/src/lib) | Every decision the site makes, as plain TypeScript: `board`, `demo`, `content`, `design`, `shell` and `time`.                                                                                                                     |
| [site/scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/scripts) | The single source of the CSP and Permissions-Policy, the build output and budget checks, the local static server and the demo session snapshot maker.                                                                             |
| [site/e2e](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/e2e)         | The Playwright and axe browser suite.                                                                                                                                                                                             |
| [site/test](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/test)       | Unit and property tests of [site/src/lib](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/src/lib) and [site/scripts](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/site/scripts). |

## Routes

[app.routes.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/app/app.routes.ts) defines 16 routes, each lazy loaded. [app.routes.server.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/app/app.routes.server.ts) prerenders every one, and [angular.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/angular.json) sets `outputMode` to `static`, so the build is a folder of HTML, JavaScript and CSS with no server.

| Path              | Title                 |
| ----------------- | --------------------- |
| `/`               | Home                  |
| `/demo`           | Demo                  |
| `/install`        | Install               |
| `/privacy`        | Privacy               |
| `/about`          | The Creator           |
| `/inspiration`    | The Inspiration       |
| `/documentation`  | Documentation         |
| `/videos`         | Videos                |
| `/builder-center` | Builder Center        |
| `/disclaimer`     | Disclaimer            |
| `/copyright`      | Copyright and licence |
| `/terms`          | Terms of use          |
| `/security`       | Security              |
| `/accessibility`  | Accessibility         |
| `/credits`        | Open-source credits   |
| `/board`          | Board                 |

A CloudFront Function on the site behaviour rewrites a directory-style path such as `/demo` or `/demo/` to its `index.html`, so clean URLs work against the private bucket.

## Key behaviours

### A strict Content Security Policy

[required-csp.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/scripts/required-csp.mjs) is the single source of the policy:

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self';
connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none';
object-src 'none'; upgrade-insecure-requests
```

CloudFront sends it from a response headers policy in [infra/modules/edge](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra/modules/edge), and a static test keeps the two identical. The build inlines nothing (`inlineCritical` is off), so no style needs `unsafe-inline`, and a build output check proves there is no inline script, handler or style in any built page. `base-uri` is `'self'` because the pages carry `<base href="/">`. CloudFront also sends HSTS, `nosniff`, `Referrer-Policy: no-referrer` and a Permissions-Policy that allows only geolocation, and only for the site itself.

### The board page and its one network call

The `/board` page receives a 15 minute [hand-off](Glossary#hand-off) id in the URL fragment, `#h=<22 characters>`. The fragment never reaches a server.

1. Before the router starts, an app initializer takes the fragment and replaces the address with `/board`, so Back, Forward and history never bring the id back ([early-fragment.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/board/early-fragment.ts)).
2. The id must be the canonical unpadded base64url form of 16 bytes ([fragment.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/board/fragment.ts)).
3. The page makes exactly one request: a same-origin `GET /api/v1/handoffs/{handoffId}` with credentials omitted, no cache, redirects refused and no referrer. A 10 second timer aborts it. It never retries, and it reads a body only for a 200 with `application/json`, so no server error text can reach the page ([handoff-client.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/board/handoff-client.ts)).
4. The view lists each session with its time and [venue](Glossary#venue), and buttons to add the passes to Apple Wallet, save them to Google Wallet and download the week's calendar. Those buttons are links the attendee taps, not requests the page makes.

### Walk from here

On the board page the attendee can tap "Walk from here" for a rough walking time to the venue of the next session. The page asks the browser for its position only on that tap, once, with low accuracy, and keeps the answer in memory for that one estimate. Nothing is sent, stored or logged. The estimate in [walk-estimate.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/board/walk-estimate.ts) is the straight-line distance times a detour factor of 1.6, at 66.7 metres a minute, plus 15 minutes to get into the venue and to the room. Farther than 20 km from the venue, no estimate is given. The venue points come from [data/venues.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/data/venues.json), the same file the rest of Compass uses; they are OpenStreetMap estimates, not official. See [Decisions: Passes and wallets](Decisions-Product-and-Scope#walk-from-here-on-the-board-page).

### The demo

The `/demo` page runs the planning flow in the browser on 17 real sessions of the re:Invent 2026 catalog, read from the AWS Events API and committed as [demo-sessions.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/demo/demo-sessions.json). The snapshot holds only the session code, title, start, end, venue and room, with a source credit and the time it was fetched. Whether a demo session can be reserved and has seats left is a demo setting, not catalog data. [make-demo-sessions.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/scripts/make-demo-sessions.mjs) rebuilds the file from an explicit list of codes.

The demo reimplements no rule. [rules-port.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/demo/rules-port.ts) is the one site module that imports `@compass/core/rules`, so clash, [connection](Glossary#connection), [boarding closes](Glossary#boarding-closes), [layover](Glossary#layover), rebooking and [safe swap](Glossary#safe-swap) results all come from the same engine the MCP server uses. The demo's sample pass draws FLIGHT NAME above TERMINAL and GATE ([pass-layout.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/demo/pass-layout.ts)).

## Interfaces

- **In:** HTTPS from browsers through CloudFront. The site behaviour is cached; `/api/*` goes to the Compass API.
- **Out:** one `GET /api/v1/handoffs/{handoffId}` on `/board`, and nothing else. The browser suite checks on every page that no request leaves the site's origin and that nothing is stored.

## Configuration

The site has no runtime configuration. The build is `npm run build:site` from the repository root, which runs `ng build`, then [check-build-output.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/scripts/check-build-output.mjs) (CSP and site rules on every built HTML file) and [check-budgets.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/scripts/check-budgets.mjs). The owner's release script syncs the build output to the site bucket and invalidates the CloudFront cache. See [Release](Release).

## Build cards

The site was built in the Build workstream ([Build cards on the project board](https://github.com/users/henniefrancis/projects/3/views/1?filterQuery=workstream%3A%22Build%22)). The cards for it:

- [L01: Walk from here](https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=290048024): live walking time to the next session on the board page
- [RD1: real catalog sessions in the demo](https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=290041945)
- [SD1: the sample pass matches the Apple layout](https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=290041819)
- [LEG1: the legal pages](https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=290043504): Terms, Security, Accessibility and Open-source credits

## Related pages

- [User guide: board](User-Guide-Board)
- [Flows](Flows#board)
- [AWS architecture](AWS-Architecture)
- [Security](Security)
- [Quality](Quality)
