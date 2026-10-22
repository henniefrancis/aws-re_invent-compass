# Requirements Document

## Introduction

This spec (S7, showcase-site) covers the public website of re:Invent Compass and its `/board` hand-off page. It owns `site/**` only.

In the airline metaphor the site is the departures hall and the gate. The departures hall tells the story ("From your code to your seat, on time."), lets anyone try a click-through demo on made-up sessions, and explains how to install Compass and what leaves the attendee's machine. The gate is `/board`: the page a phone opens after scanning the QR code that Compass prints on the computer, where the attendee adds unofficial boarding passes to Apple Wallet or Google Wallet, or downloads a calendar file.

The site is plan on a computer, board on any device (ADR-005). It is a static Angular 22 application, prerendered to files and served from S3 behind CloudFront at the distribution's default domain. It has no sign-in, no cookies, no analytics and no third-party requests. The demo runs the real rules engine (`@compass/core/rules`, owned by S2) in the browser on sessions copied from the synthetic catalog (ADR-016). The `/board` page reads a 15-minute hand-off capability from the URL fragment only (ADR-011), calls one hand-off route from `contracts/compass-api.openapi.yaml`, and never stores, logs or shares that capability.

re:Invent Compass is an unofficial, independent community project. The site never implies AWS endorsement and uses no AWS logos, colours or trademark artwork.

Scope boundary: this stream does not build the rules engine (S2), the Events API client (S1), the MCP server or Power (S3), the pass builder or `.ics` export of the product (S4), the Compass API (S5) or any infrastructure, including the CloudFront response headers policy and the directory rewrite function (S6). It reads `contracts/**`, `packages/contracts/**`, `fixtures/synthetic/**` and `data/venues.json` and never edits them.

## Glossary

- **Site**: The Angular application in `site/`, served as static files from S3 behind CloudFront at `https://<distribution>.cloudfront.net`.
- **Shell**: The layout shared by every page: skip link, header, navigation, main landmark and footer.
- **Home_Page**: The route `/`, which tells the product story.
- **Demo_Page**: The route `/demo`, the click-through demo on made-up sessions.
- **Install_Page**: The route `/install`, the install guide.
- **Privacy_Page**: The route `/privacy`, "what leaves your machine".
- **Board_Page**: The route `/board`, the hand-off page opened on a phone from the QR code.
- **Hand_Off**: A 15-minute capability created by `POST /api/v1/handoffs` (S5) that lets a phone fetch chosen passes.
- **Hand_Off_Id**: 16 random bytes encoded as base64url without padding (22 characters), carried in the URL fragment `#h=`.
- **Hand_Off_View**: The 200 response body of `GET /api/v1/handoffs/{handoffId}`, the `HandoffView` schema in `contracts/compass-api.openapi.yaml`.
- **Board_State**: One of Reading, Invalid_Link, Loading, Ready, Expired, Rate_Limited or Unavailable.
- **Rules_Engine**: The pure, browser-safe rules engine exported by `@compass/core/rules` (S2), including `checkReservation`, `computeBoarding`, `classifyConnection`, `findClashes`, `checkLayovers`, `findRebookingOptions` and `planSafeSwap`.
- **Rules_Port**: The single Site module that imports the Rules_Engine. Every other Site module reaches the Rules_Engine through it.
- **Demo_Catalog**: The small set of sessions the demo offers, copied from `fixtures/synthetic/catalog.json` and normalised to `NormalisedSession`.
- **Starter_Week**: A fixed set of Demo_Catalog sessions the user can load in one action.
- **Demo_Week**: The commitments the user holds in the demo (reserved sessions and personal time).
- **Demo_State**: The whole in-memory state of the demo: the Demo_Week, any pending decision, any safe swap in progress and the selected sample pass.
- **Demo_Context**: The Rules_Engine `Context` used by the demo: a fixed demo instant as `now`, the event timezone from the synthetic data, the venue data from `data/venues.json`, and the Rules_Engine defaults.
- **Sample_Pass**: An image of an unofficial boarding pass for one Demo_Week session, rendered by the Site.
- **Sample_Calendar**: An RFC 5545 `.ics` file of the Demo_Week, built in the browser.
- **Source_Document**: One of `CONCEPT.md`, `README.md`, `.kiro/steering/product.md`, `docs/architecture/build-plan.md`, and for install content `packages/mcp-server/README.md` (S3) and the official Kiro powers installation guide.
- **Content_Block**: One unit of Site copy, kept in a content module with the Source_Document it comes from.
- **Notice**: The exact sentence from `README.md`: "re:Invent Compass is an independent community project and is not affiliated with, endorsed by, or sponsored by Amazon Web Services."
- **Required_CSP**: The Content-Security-Policy the Site is built to run under: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests`.
- **Build_Output_Check**: The Node script in `site/scripts/` that inspects every prerendered HTML file after a build.
- **Budget_Check**: The Node script in `site/scripts/` that measures compressed JavaScript sizes after a build.
- **Static_Server**: The Node script in `site/scripts/` that serves the built output for browser tests, emulating the CloudFront directory rewrite and sending the Required_CSP.
- **Device_Profiles**: The seven browser test profiles: Desktop Chrome, Desktop Firefox, Desktop WebKit, iPad portrait, iPad landscape, iPhone portrait and iPhone landscape.
- **Site_Logic**: The TypeScript modules under `site/src/lib/**` and the Node scripts under `site/scripts/**`. They hold every decision; Angular components only bind to their outputs.
- **Integrator**: Claude on the `develop` branch, who owns root configs, every `package.json`, the lockfile and cross-stream changes.

## Requirements

### Requirement 1: Static, prerendered Angular site

**User Story:** As the owner, I want the site built as static prerendered files, so that it is fast, cheap and served from S3 behind CloudFront with no server.

#### Acceptance Criteria

1. THE Site SHALL be built with Angular 22.2.3 using standalone components only, and SHALL declare no NgModule in `site/src`.
2. THE Site SHALL run zoneless through `provideZonelessChangeDetection()`, and SHALL NOT import or bundle `zone.js`.
3. WHEN the Site is built, THE build SHALL use the `@angular/build:application` builder with `outputMode: "static"` and SHALL prerender the routes `/`, `/demo`, `/install`, `/privacy` and `/board` to one `index.html` file each in the browser output folder.
4. THE Site SHALL load each page route lazily through `loadComponent`, so that one page's code is not part of another page's initial bundle.
5. WHEN the built output is deployed, THE Site SHALL need no runtime server and no API other than the hand-off routes used by the Board_Page.
6. IF the Site needs a dependency that no workspace `package.json` pins, THEN THE showcase-site stream SHALL record an Integrator request in the `tasks.md` Notes and SHALL NOT install it.
7. WHILE prerendering, THE Site SHALL NOT read `window`, `document`, `location`, `history` or the URL fragment, and SHALL run browser-only code only after the first render in the browser.

### Requirement 2: Privacy of the site itself

**User Story:** As a visitor, I want the site to collect nothing about me, so that I can try it and open my passes without being tracked.

#### Acceptance Criteria

1. THE Site SHALL NOT include sign-in, accounts or any authentication flow.
2. THE Site SHALL NOT set or read cookies.
3. THE Site SHALL NOT read or write `localStorage`, `sessionStorage`, IndexedDB or the Cache API, and SHALL NOT register a service worker.
4. THE Site SHALL NOT include analytics, tracking, telemetry, error reporting, `navigator.sendBeacon` or any `console` output.
5. WHEN any page loads or is used, THE Site SHALL send requests only to its own origin, and SHALL NOT load scripts, styles, fonts, images or data from any other origin.
6. THE Site SHALL reach external sites (the repository, the Builder Center post, the video, Kiro and the Google Wallet save URL) only through links the user chooses.
7. THE Site SHALL keep all Demo_State and all Board_Page state in page memory only, so that reloading or closing the page discards it.

### Requirement 3: Strict CSP compatibility

**User Story:** As the security reviewer, I want the site to run under a strict Content-Security-Policy, so that a script injection on `/board` cannot run.

#### Acceptance Criteria

1. THE built output SHALL contain no inline executable script: every `<script>` element either has a same-origin `src` attribute or has `type="application/json"`.
2. THE built output SHALL contain no inline event handler attribute (an attribute whose name starts with `on`) and no `javascript:` URL, however it is spelled with character references, tabs or line breaks, and no meta refresh, no base element other than `<base href="/">`, no object, embed or iframe element, and no svg use element that refers to anything outside the page.
3. THE Site source SHALL NOT use `eval`, `new Function`, a string argument to `setTimeout` or `setInterval`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or any Angular `bypassSecurityTrust` method.
4. THE build configuration SHALL set `optimization.styles.inlineCritical` to `false`, SHALL leave subresource integrity off, and SHALL NOT enable hydration event replay or incremental hydration.
5. THE Site SHALL load all styles from same-origin stylesheet files: components SHALL declare no `styles` or `styleUrl`, and templates SHALL contain no `style` attribute and no `[style]` binding, so that the built HTML contains no `<style>` element and no `style` attribute.
6. THE showcase-site stream SHALL publish the Required_CSP in `site/README.md` as the request to S6 for the CloudFront response headers policy.
7. WHEN the Site is served with the Required_CSP, THE Site SHALL run every page and every flow with zero CSP violations.
8. IF any prerendered HTML file breaks criterion 1, 2 or 5, THEN THE Build_Output_Check SHALL fail the build and name the file and the rule.

### Requirement 4: Site shell and navigation

**User Story:** As a visitor on any device, I want the same clear layout on every page, so that I always know where I am and how to get around.

#### Acceptance Criteria

1. THE Shell SHALL render on every page a skip link to the main content as the first focusable element, a header with the product logo as the link home, a main navigation of four groups (Product: Try the demo and Install; Project: Repository, Documentation, Builder Center post and Video; About: The Inspiration and The Creator; Legal: Privacy, Disclaimer, and Copyright and licence; each item with a one-line description) and a "Try the demo" button, exactly one `<main>` landmark, and a footer (amended 21 October 2026 by owner decisions, tasks 26 and 28).
2. THE Shell footer SHALL show on every page, centred and compact, the heading "Disclaimer Notice" with the Notice exactly as written under it, and no links: the repository, the Builder Center post and the video are in the Project group of the main navigation (amended 21 October 2026 by owner decision, task 27).
3. WHERE the Builder Center post URL or the video URL is not yet configured, THE Shell SHALL show that item as plain text saying it is coming soon, and SHALL NOT render a link to an unknown address.
4. WHEN the user navigates to a page within the Site, THE Shell SHALL set the document title to `<page name> | re:Invent Compass` and SHALL move keyboard focus to the page's single `<h1>` heading.
5. THE Shell SHALL NOT use fixed or sticky positioned elements. Each navigation group SHALL be a disclosure: a button with `aria-expanded` that shows or hides its panel, one panel open at a time, closed by a second press, by Escape (focus returns to its button), by a click outside the header and by any navigation. On wide screens a panel MAY open over the content below the header; on narrow screens a "Menu" button shows the groups in the page flow (amended 21 October 2026 by owner decision, task 26: it said no menus that open over content).
6. THE Site SHALL set `lang="en"` on the `<html>` element and SHALL include `<meta name="referrer" content="no-referrer">` in the document head.
7. THE Site SHALL use the look of the Compass QR page and pass: the owner's Pass Designer gradient behind the page, the main content on a dark card, white text and the pass's orange for links and buttons, with every text and graphic pairing meeting WCAG 2.2 AA and no AWS brand colour (owner request of 21 October 2026, task 25).

### Requirement 5: Home page story

**User Story:** As a judge or a first-time attendee, I want to understand in under a minute what Compass does and why, so that I want to try the demo.

#### Acceptance Criteria

1. THE Home_Page SHALL show the product name and the tagline "From your code to your seat, on time." (amended 20 October 2026 by owner decision, task 24: it was "Plan like a spec. Board like a flight.")
2. THE Home_Page SHALL tell the "Seat released at" story: a reserved seat is held only until 10 minutes before the session starts, and Compass shows "Seat released at 10:20" where most tools show "Starts 10:30", attributing the rule to the official re:Invent 2026 FAQ.
3. THE Home_Page SHALL show the airline metaphor table with the terms and meanings from the product steering.
4. THE Home_Page SHALL present the three acts Plan, Boarding and Fly (amended 20 October 2026, task 24: the second act was Board) with content from `CONCEPT.md` section 3, using the scanner list from the build plan and product steering (Terraform, AWS CDK TypeScript, AWS SDK for JavaScript v3 and boto3) where `CONCEPT.md` differs.
5. THE Home_Page SHALL state in plain words the principles "The badge is the ticket", "A human approves every write" and "Local first".
6. THE Home_Page SHALL link to the Demo_Page and the Install_Page as its two primary actions.
7. THE Home_Page SHALL state that Compass passes are unofficial, carry the text "Unofficial. Your badge is your ticket." and never replace the attendee's badge.

### Requirement 6: Content provenance and no impersonation

**User Story:** As the owner, I want every word on the site to be true and clearly unofficial, so that judges trust it and AWS is never misrepresented.

#### Acceptance Criteria

1. THE Site SHALL take every factual statement, number and feature description from a Source_Document, and every Content_Block SHALL name its Source_Document.
2. WHERE a Content_Block is marked verbatim, THE Content_Block text SHALL appear exactly in its named Source_Document.
3. THE Site SHALL NOT include testimonials, invented quotes, invented numbers, invented features, or targets presented as achieved results.
4. THE Site SHALL NOT display any AWS logo, AWS trademark artwork, AWS brand colour or wording that suggests an official AWS product, and SHALL use "re:Invent" and "AWS" only as plain-text descriptive names.
5. THE Site SHALL use only original artwork, kept as same-origin SVG files or inline SVG markup, each listed with its author in an artwork manifest in `site/`.
6. THE Site design tokens SHALL NOT include any colour on the AWS brand colour denylist kept in the Site tests.
7. THE Site copy SHALL follow the product voice: plain English, short sentences, and no em dash or en dash in any copy, code, comment, test name or commit message.
8. WHERE a Source_Document conflicts with the build plan, THE Site SHALL follow the build plan.

### Requirement 7: Demo catalog

**User Story:** As a judge, I want the demo to use realistic but clearly made-up sessions, so that I can see the real behaviour without any real attendee data.

#### Acceptance Criteria

1. THE Demo_Catalog SHALL contain only sessions copied from `fixtures/synthetic/catalog.json`, each normalised to the `NormalisedSession` shape from `@compass/contracts`, with no field invented or changed.
2. THE Demo_Catalog SHALL contain from 12 to 24 sessions across at least two event days.
3. THE Demo_Catalog SHALL include: two sessions on the same day that overlap in time; a held Starter_Week session that has a `-R` repeat which overlaps no other Starter_Week session; two consecutive sessions at different venues; at least one session that is not reservable; and enough sessions inside one day's meal window to make a missing meal layover reachable.
4. IF the synthetic catalog does not contain a pattern listed in criterion 3, THEN THE showcase-site stream SHALL stop and ask the Integrator for an S0 catalog change and SHALL NOT invent a session.
5. THE Demo_Page SHALL label the sessions as made up and state that nothing in the demo touches a real schedule.
6. THE Demo_Context SHALL take the event timezone from the synthetic session data and SHALL use a fixed demo instant as `now`, and THE demo logic SHALL NOT read the system clock.
7. WHERE a Demo_Catalog session has no venue, THE Demo_Page SHALL show "Venue not published", and SHALL NOT invent a value for any missing field.

### Requirement 8: Building a demo week through the guardrail

**User Story:** As a judge, I want to pick sessions and watch the guardrail allow, warn or block each booking, so that I see the core idea working on my own phone.

#### Acceptance Criteria

1. THE Demo_Page SHALL list the Demo_Catalog grouped by event day, each session showing its code, title, type, level, venue and room, start and end time, and boarding closes time.
2. THE Demo_Page SHALL offer a "Start with a sample week" action that loads the Starter_Week, and SHALL offer an add button for every listed session.
3. WHEN the user adds a session, THE Demo_Page SHALL call `checkReservation` through the Rules_Port with that session, the current Demo_Week and the Demo_Context.
4. WHEN `checkReservation` returns allow, THE Demo_Page SHALL add the session to the Demo_Week.
5. WHEN `checkReservation` returns warn, THE Demo_Page SHALL show every returned reason and SHALL add the session only after the user chooses "Add anyway".
6. WHEN `checkReservation` returns block, THE Demo_Page SHALL show every returned reason, SHALL NOT add the session, and SHALL offer the options of Requirement 10.
7. THE Demo_Page SHALL show the reasons from the Rules_Engine exactly as returned, without rewording, dropping or adding any reason.
8. WHEN a verdict is shown, THE Demo_Page SHALL announce the decision and its reasons through a polite live region.
9. THE Demo_Page SHALL let the user remove any commitment from the Demo_Week.
10. THE Demo_Page SHALL offer a guided path from the Starter_Week that names the session to try, so that a blocked clash is reached in no more than three user actions from page load.
11. THE Demo_Page SHALL reimplement no rule: every boarding, connection, clash, layover, rebooking and swap result SHALL come from the Rules_Engine.

### Requirement 9: Connections, boarding and layovers

**User Story:** As a first-time attendee, I want to see when each seat is released, how long each walk is and where I have no time to eat, so that I understand why my week is or is not realistic.

#### Acceptance Criteria

1. THE Demo_Page SHALL show for each reserved session in the Demo_Week the boarding closes time returned by `computeBoarding`, or the not-applicable or unknown reason it returns.
2. THE Demo_Page SHALL show for each pair of consecutive commitments on the same day the connection classification (comfortable, tight, impossible or unknown), the walking minutes and the reason returned by the Rules_Engine, including the word "estimate" where the Rules_Engine reports it.
3. THE Demo_Page SHALL show for each day of the Demo_Week the layover report returned by `checkLayovers`: a missing meal layover, a long stretch, and each suggested block or the reason none could be placed.
4. WHEN the user chooses a suggested layover block, THE Demo_Page SHALL add it to the Demo_Week as personal time with that block's start and end.
5. THE Demo_Page SHALL show all times in event local time and SHALL state the event timezone once per view.
6. WHEN the Rules_Engine returns an unknown result, THE Demo_Page SHALL show the reason it gives and SHALL NOT hide the item.

### Requirement 10: Rebooking and safe swap

**User Story:** As a judge, I want to take the suggested safe swap after a blocked clash, so that I see how Compass moves a booking to a repeat without risking the seat.

#### Acceptance Criteria

1. WHEN a session is blocked, THE Demo_Page SHALL show the rebooking options returned by `findRebookingOptions` for that session's base code over the Demo_Catalog, each with its reason, or the "no alternative found" message it returns.
2. WHEN the user chooses a repeat option, THE Demo_Page SHALL run that repeat through Requirement 8 criteria 3 to 6.
3. WHEN a session is blocked by a clash with a held session that has a repeat in the Demo_Catalog, THE Demo_Page SHALL offer a safe swap that moves the held session to its repeat.
4. WHEN the user starts a safe swap, THE Demo_Page SHALL first check the repeat with `checkReservation` against the Demo_Week, and IF that verdict is block, THEN THE Demo_Page SHALL say the swap cannot be made safely, show the reasons, and leave the Demo_Week unchanged.
5. WHEN the safe swap proceeds, THE Demo_Page SHALL run three visible steps in this order, one per user action: reserve the repeat (simulated), confirm by calling `planSafeSwap` with the Demo_Week as the confirmation schedule, and cancel the original (simulated).
6. THE Demo_Page SHALL cancel the original only WHEN `planSafeSwap` has returned outcome safe for a confirmation schedule that holds the repeat.
7. IF `planSafeSwap` returns outcome unsafe or failed, THEN THE Demo_Page SHALL show its reasons, remove the simulated repeat reservation, and keep the original in the Demo_Week.
8. WHEN a safe swap completes, THE Demo_Page SHALL invite the user to add the session that was blocked and SHALL run it through Requirement 8 criteria 3 to 6.

### Requirement 11: Sample boarding pass

**User Story:** As a judge, I want to see what a boarding pass looks like for a session in my demo week, so that I understand what lands on the attendee's phone.

#### Acceptance Criteria

1. WHEN the user chooses a reserved session in the Demo_Week, THE Demo_Page SHALL show a Sample_Pass for it.
2. THE Sample_Pass SHALL show, as on the Apple pass (amended 20 October 2026): the owner's logo; SESSION with the session code; TERMINAL with the venue or "Venue not published"; GATE with the short room (the part of the room after the first comma) or "Room not published"; FLIGHT NAME with the title as `normalisePassText` leaves it and, when that is longer than 80 characters, its first 77 characters followed by three ASCII dots (the ellipsis character is not in the pass text allowlist); DATE with the event date and the 24-hour start and end times in the event timezone; BOARDING CLOSES with the 24-hour boarding closes time from the Rules_Engine; and, as small lines under the card face, the walk from the previous commitment where known, the next connection where known, the label "Sample pass. Made-up session." and the disclaimer "Unofficial. Your badge is your ticket." Label text on the card SHALL reach a contrast of 4.5:1 against the card background.
3. THE Sample_Pass SHALL show no barcode, no QR code, no AWS logo and no AWS brand colour.
4. THE Sample_Pass fields SHALL validate against the PassFields schema from `@compass/contracts` built for the demo event window.
5. THE Sample_Pass SHALL be rendered as inline SVG with `role="img"` and an accessible name that states every field shown.

### Requirement 12: Sample calendar file

**User Story:** As a judge, I want to download a calendar file of my demo week, so that I see the "leave now" and "boarding closes" alarms Compass sets.

#### Acceptance Criteria

1. THE Demo_Page SHALL offer a "Download sample calendar" action that saves a `.ics` file of the current Demo_Week, built in the browser with no request.
2. THE Sample_Calendar SHALL be valid RFC 5545: CRLF line endings, content lines folded at 75 octets, escaped text values, one `VCALENDAR` with `VERSION:2.0` and a `PRODID`, and one `VEVENT` per commitment with `UID`, `DTSTAMP`, `DTSTART`, `DTEND` and `SUMMARY`.
3. THE Sample_Calendar SHALL, where it says "walking minutes", mean the Rules_Engine walk plus its buffer (`walkingMinutes`), and the Demo_Page SHALL say so. THE Sample_Calendar SHALL give each reserved session a "Boarding closes" alarm 10 minutes before its start, and a "Leave now" alarm at the boarding closes time minus the walking minutes from the previous commitment WHERE that walk is known and the Rules_Engine does not class the connection as impossible. WHERE the connection is impossible, THE Sample_Calendar SHALL omit the "Leave now" alarm and say in the description that the walk does not fit in the time available.
4. WHERE the walk from the previous commitment is unknown or there is no previous commitment that day, THE Sample_Calendar SHALL omit the "Leave now" alarm for that session and say in its description that the walk is unknown.
5. THE Sample_Calendar SHALL use the fixed demo instant for `DTSTAMP`, UIDs under the reserved `.invalid` domain, and descriptions that say the session is made up and that the pass is unofficial.
6. WHILE the Demo_Week is empty, THE Demo_Page SHALL disable the download action and say why.

### Requirement 13: Demo determinism and offline behaviour

**User Story:** As a judge on a phone with a weak connection, I want the demo to behave the same every time and keep working once loaded, so that it never surprises me.

#### Acceptance Criteria

1. THE demo logic SHALL be a pure reducer over Demo_State and user actions, so that the same action sequence from the same start state always yields a deeply equal Demo_State.
2. THE Demo_Page SHALL hold Demo_State in page memory only and SHALL offer a "Start over" action that returns to the empty state.
3. WHEN the Demo_Page has loaded, THE Demo_Page SHALL work with no further network request.
4. THE Demo_Page SHALL work on a phone with no install and no sign-in.

### Requirement 14: Install page

**User Story:** As an attendee or judge on a computer, I want clear install steps, so that I can run Compass in Kiro or another MCP client.

#### Acceptance Criteria

1. THE Install_Page SHALL explain how to add the Kiro Power: through the "Add to Kiro" button on kiro.dev/powers WHERE a listing URL is configured, and otherwise through Kiro's documented "Import power from GitHub" flow with the repository URL.
2. THE Install_Page SHALL show the commands `npx reinvent-compass` (start the server) and `npx reinvent-compass demo` (run the whole flow in simulated mode), and SHALL state that Node.js 24 or later is required.
3. WHEN S3 has merged into `develop`, THE Install_Page SHALL show setup for Claude Desktop, VS Code and Kiro CLI using the content of `packages/mcp-server/README.md`, and SHALL state that hooks are Kiro only while the guardrail runs in the server for every client.
4. WHILE S3 has not merged into `develop`, THE Install_Page SHALL show only the Kiro Power and npx sections and SHALL NOT invent client configuration.
5. THE Install_Page SHALL explain plan on a computer, board on any device: planning and booking run on the attendee's computer, and phones get passes through the QR hand-off.
6. WHERE a command is shown, THE Install_Page SHALL offer a copy button that copies the exact command text and announces "Copied" through a polite live region.

### Requirement 15: Privacy page

**User Story:** As an attendee, I want to know exactly what leaves my machine and for how long, so that I can decide to trust Compass.

#### Acceptance Criteria

1. THE Privacy_Page SHALL explain in plain words, from build plan section 4.2 and the product principles, what stays on the attendee's machine: the access and refresh tokens, the catalog cache, the schedule snapshot, the issued-pass record, the week spec, the code scan and the generated files.
2. THE Privacy_Page SHALL explain what leaves the machine: the ID token, sent only to the Compass API as proof of sign-in and never stored there; the printable pass fields, kept until session end plus 24 hours; the attendee name, only when the attendee opts in; Apple device push tokens, kept until the device unregisters or the pass record expires; and pass objects held by Google for Google Wallet passes.
3. THE Privacy_Page SHALL explain that hand-offs expire in 15 minutes, that the hand-off link lives in the URL fragment, and that `forget_me` deletes the attendee's pass records, device registrations and hand-offs on the server and the local files, but NOT the server rate counters, which expire when their one-hour window ends plus 2 minutes (build plan 4.2, P13).
4. THE Privacy_Page SHALL explain what this Site does: no sign-in, no cookies, no analytics, no third-party requests, a demo that runs in the browser on made-up sessions, and a Board_Page that keeps the hand-off link in page memory only.
5. THE Privacy_Page SHALL name the responsible party as given in build plan section 4.2.
6. THE Privacy_Page SHALL state that no wallet lets a pass be deleted remotely: a cancelled session's pass is voided, and every pass expires at its session end.
7. THE Privacy_Page SHALL state that the Compass server runs in the AWS us-east-1 Region (N. Virginia, United States), outside South Africa, and that Apple and Google also process data when the attendee adds a pass to a wallet (build plan 4.2, P15 and P16, and the paragraph after the table).
8. THE Privacy_Page SHALL name a contact channel for requests about the attendee's data: private vulnerability reporting on the project repository, linked from the repository address in the links file, with no personal email address.
9. THE Privacy_Page SHALL state that the attendee may also complain to the Information Regulator (South Africa) (build plan 4.2).

### Requirement 16: Hand-off fragment handling on the board page

**User Story:** As an attendee holding my phone, I want the hand-off link to stay private, so that nobody else can use it and it never sits in my browser afterwards.

#### Acceptance Criteria

1. WHEN the Board_Page starts in the browser, THE Board_Page SHALL read the Hand_Off_Id only from the URL fragment, in the exact form `#h=<id>`, and SHALL NOT read it from the path or the query string.
2. THE Board_Page SHALL accept the Hand_Off_Id only WHEN it is exactly 22 characters from the base64url alphabet and is the canonical unpadded encoding of 16 bytes.
3. IF the fragment is absent, has any other form, or carries an id that fails criterion 2, THEN THE Board_Page SHALL show the Invalid_Link state and SHALL NOT send any request.
4. WHEN the Board_Page has read the fragment, THE Board_Page SHALL remove the fragment from the address bar by replacing the current history entry with `/board`, without a navigation.
5. THE Board_Page SHALL keep the Hand_Off_Id in page memory only, and SHALL NOT write it to cookies, web storage, IndexedDB, the console, the document title or any visible text.
6. THE Board_Page SHALL send the Hand_Off_Id only in the path of same-origin requests to the hand-off routes of `contracts/compass-api.openapi.yaml`, and to no analytics, log, error report or other origin.
7. THE Board_Page SHALL include `<meta name="robots" content="noindex">`.
8. THE Site SHALL take the fragment from the raw address and remove it from the address bar before the router's first navigation, so that neither the router nor the history ever holds it; Back and Forward SHALL never restore it, and the page SHALL refuse a percent-encoded id without decoding it.

### Requirement 17: Hand-off request and response validation

**User Story:** As the security reviewer, I want the board page to call one route and accept only a response that matches the contract exactly, so that a tampered or broken response can never put a harmful link on the page.

#### Acceptance Criteria

1. WHEN a valid Hand_Off_Id has been read, THE Board_Page SHALL send exactly one `GET /api/v1/handoffs/{handoffId}` request to the Site origin, with credentials omitted, caching disabled, redirects refused, no request body and a 10 second timeout.
2. THE Board_Page SHALL NOT retry a request automatically, and SHALL send a further request only when the user chooses "Try again".
3. WHEN the response status is 200, THE Board_Page SHALL accept the body only WHEN it matches the `HandoffView` schema: every required field present with the right type, no unknown field, every `serialNumber` a UUID, every `startsAt` and the `expiresAt` an ISO 8601 date-time with offset, and from 1 to 80 `sessions`.
4. THE Board_Page SHALL accept `apple.bundlePaths` only WHEN each path is exactly `/api/v1/handoffs/{handoffId}/apple/{i}` for the same Hand_Off_Id with `i` counting from 0 in order, and the number of paths is at most the number of sessions divided by 10, rounded up.
5. THE Board_Page SHALL accept `calendarPath` only WHEN it is null or exactly `/api/v1/handoffs/{handoffId}/calendar.ics` for the same Hand_Off_Id, and SHALL accept `google` only WHEN it is null or its `saveUrl` is an `https` URL on host `pay.google.com` with a path that starts with `/gp/v/save/`, no user info and no port.
6. IF any rule in criteria 3 to 5 fails, THEN THE Board_Page SHALL reject the whole response, show the Unavailable state, and SHALL NOT render any part of the body.
7. THE Board_Page SHALL NOT display any text from an error response body.
8. THE Board_Page SHALL parse a 200 response only WHEN its Content-Type is application/json (parameters allowed), and otherwise SHALL show the Unavailable state without reading the body.
9. THE Board_Page SHALL treat a hand-off that offers no action at all (no Apple bundle, no calendar and no Google link) as Unavailable.
10. THE Board_Page SHALL accept a Google save link only WHEN its token looks like a JWT (three base64url segments, the first starting eyJ, at most 4096 characters), a title only WHEN it has 1 to 80 characters, and a session code only WHEN it has 1 to 20 characters.

### Requirement 18: Board actions and states

**User Story:** As an attendee holding my phone, I want one clear screen with the right buttons, or one clear message when the link no longer works, so that I get my passes in a few taps.

#### Acceptance Criteria

1. WHEN a Hand_Off_View is accepted, THE Board_Page SHALL show the Ready state: the sessions (code, title and start time in event local time), when the hand-off expires, and the available actions.
2. THE Ready state SHALL offer one "Add to Apple Wallet" link per Apple bundle path, labelled "bundle N of M" when there is more than one bundle (the contract does not say how passes are split across bundles, so the label never names pass numbers); one "Save to Google Wallet" link WHERE `google` is not null; and one "Download calendar" link WHERE `calendarPath` is not null.
3. THE Ready state SHALL explain in one short line which action suits which device (Apple Wallet on iPhone, Google Wallet on Android, the calendar file on iPad or any other device), and THE Board_Page SHALL NOT detect the device or browser.
4. WHEN the response status is 404, THE Board_Page SHALL show the Expired state, with one message for both unknown and expired hand-offs that tells the user to create a new hand-off on their computer.
5. WHEN the response status is 429, THE Board_Page SHALL show the Rate_Limited state, asking the user to wait a minute and offering "Try again".
6. WHEN the device clock reaches the hand-off `expiresAt` while the Ready state is shown, THE Board_Page SHALL switch to the Expired state and remove every action link.
7. IF the request fails for any other reason (network error, timeout, any other status, a body that is not JSON, or a body rejected under Requirement 17), THEN THE Board_Page SHALL show the Unavailable state with "Try again".
8. WHEN the Board_Page changes state after a request, THE Board_Page SHALL move focus to the heading of the new state and announce it through a polite live region.
9. WHILE the request is in flight, THE Board_Page SHALL mark its content region busy and show a loading message.
10. WHERE JavaScript is not available, THE Board_Page SHALL show a message that it needs JavaScript to open the hand-off link.
11. WHEN a response arrives after the hand-off `expiresAt` by the device clock, THE Board_Page SHALL show the Expired state and never the Ready state.
12. WHEN the page becomes visible again or is shown from the back-forward cache, THE Board_Page SHALL check the expiry again, switch to Expired when it has passed, and refresh the remaining time text, which SHALL never say more than 15 minutes.

### Requirement 19: Accessibility (WCAG 2.2 AA)

**User Story:** As a visitor who uses a screen reader, a keyboard, high contrast or a small screen, I want every page to work for me, so that Compass is usable by every attendee.

#### Acceptance Criteria

1. THE Site SHALL meet WCAG 2.2 level AA on every page and in every Board_State and demo state.
2. THE Site SHALL give all text a contrast ratio of at least 4.5:1 against its background, measured at the worst point of any gradient behind it.
3. THE Site SHALL give focus indicators, control borders and meaningful graphics a contrast ratio of at least 3:1 against adjacent colours.
4. WHILE forced colors are active, THE Site SHALL keep every control, focus indicator, border and status visible using system colours.
5. THE Site SHALL give every interactive control other than links inside running text a target of at least 44 by 44 CSS pixels.
6. THE Site SHALL make every function operable by keyboard alone, in a logical focus order, with a visible focus indicator, no keyboard trap and no dragging movement.
7. THE Site SHALL ensure the focused element is never hidden by other content.
8. THE Site SHALL use one `<h1>` per page, headings in order, landmarks, lists, tables with header cells, and an accessible name for every control.
9. THE Site SHALL announce dynamic results (verdicts, swap steps, board states and copy confirmations) through live regions, and SHALL NOT move focus except as stated in Requirement 4 criterion 4 and Requirement 18 criterion 8, and except when a demo action removes the control that had focus (a panel closes, a step button is replaced by the next, or an item leaves the list). Then focus SHALL move to the heading of the panel the action opened, to the control that continues the action, to the Remove button of the item that follows the removed one (or the one before it), or to the heading "Your week".
   9a. THE Site SHALL give controls that repeat on a page accessible names that differ, for example "Remove Layover at 12:00 PM", and SHALL keep a control that only reports a state (the Add button of a session already in the week) focusable by using aria-disabled instead of disabled.
10. WHILE the user prefers reduced motion, THE Site SHALL show no animation and no transition.
11. THE Site SHALL reflow with no horizontal scrolling at a viewport width of 320 CSS pixels.
12. THE Site SHALL convey no information by colour alone, and SHALL state every connection class and verdict in text.

### Requirement 20: Responsive layout

**User Story:** As a judge, I want the site to work on my laptop, tablet or phone in either orientation, so that I can try it wherever I am.

#### Acceptance Criteria

1. THE Site SHALL lay out correctly on each of the seven Device_Profiles.
2. THE Site SHALL use one responsive layout, with no separate mobile site and no device detection.
3. WHILE the viewport is short (iPhone landscape), THE Site SHALL keep every page usable with no content or focused element hidden behind a positioned element, verified by a short-viewport test.
4. THE Board_Page SHALL show its first action in the first viewport on iPhone portrait.

### Requirement 21: Performance budgets

**User Story:** As a judge on a phone, I want the site to load quickly, so that I can try it in under two minutes.

#### Acceptance Criteria

1. THE initial JavaScript of the Site SHALL be at most 250 kB (250,000 bytes) compressed with gzip.
2. THE Demo_Page route chunk, together with the chunks only it loads, SHALL be at most 150 kB (150,000 bytes) compressed with gzip.
3. THE Home_Page Largest Contentful Paint SHALL be under 2.5 seconds on Lighthouse mobile.
4. IF a budget in criterion 1 or 2 is exceeded in the build output, THEN THE Budget_Check SHALL fail the build and report the measured and allowed sizes.
5. THE Site SHALL use the system font stack and no web font, and SHALL give every image fixed dimensions so that it causes no layout shift.

### Requirement 22: Testing

**User Story:** As the owner, I want the site proven by unit, property and browser tests, so that it ships with no surprises on judging day.

#### Acceptance Criteria

1. THE showcase-site test suite SHALL achieve 100% lines, branches, functions and statements with vitest for all Site_Logic, with no named coverage exclusion.
2. THE showcase-site test suite SHALL implement each correctness property in the design as one fast-check property test with at least 100 runs.
3. THE showcase-site stream SHALL provide Playwright tests for the seven Device_Profiles with axe checks against the WCAG 2.2 A and AA rules on every page and state, a forced-colors run, a run under the Required_CSP, a no-other-origin request check and a no-storage check, run on demand only.
4. THE Playwright tests SHALL wait only on application state (focus, headings and live region text), SHALL NOT wait on URLs or fixed sleeps, and SHALL run with no retries.
5. THE Playwright tests SHALL serve the built output through the Static_Server and SHALL mock the hand-off routes with contract-shaped fixtures, and no test SHALL call a deployed Compass API or the live Events API.
6. THE Site SHALL keep Angular components free of decisions beyond binding to Site_Logic outputs, so that the unit-tested Site_Logic holds every decision.
7. THE Board_Page flow (read the hash once, remove the fragment before any request, send one request per user intent, expire locally) SHALL live in a Board_Controller in Site_Logic behind injected browser functions, so that the unit tests prove its order of effects and the component only wires up the browser globals.

### Requirement 23: Ownership and delivery

**User Story:** As the integrator, I want this stream to stay inside its folder and hand over a documented, committed site, so that merging it is safe.

#### Acceptance Criteria

1. THE showcase-site stream SHALL edit only files under `site/**` and `.kiro/specs/showcase-site/`, plus screenshots under `docs/article/screenshots/showcase-site/` as the workflow steering requires.
2. IF the stream needs a change outside `site/**` (root configs, any `package.json`, the lockfile, CI workflows, contracts, the rules engine, the synthetic catalog or infrastructure), THEN THE stream SHALL write it as an Integrator request in the `tasks.md` Notes and SHALL NOT make it.
3. THE stream SHALL commit locally after each top-level task with Conventional Commits scoped `showcase-site`, subject and body passed through multiple `-m` flags, with no Co-Authored-By trailer and no AI attribution, and SHALL NOT push, merge, open a pull request or tag.
4. THE stream SHALL provide `site/README.md` covering the build, the tests, the output folder for the release script, the Required_CSP, the content sources and the artwork manifest.
5. THE stream SHALL save two or three screenshots of the Site working (the Home_Page, the blocked clash in the demo on a phone profile, and the Board_Page Ready state with mocked data) to `docs/article/screenshots/showcase-site/` for the Builder Center post.

### Requirement 24: About the creator

**User Story:** As a visitor, I want to know who built Compass, so that I know it is a community project with a real person behind it.

#### Acceptance Criteria

1. THE Site SHALL have an About_Page at `/about`, titled "The Creator", reached from the About group of the main navigation (renamed by the owner on 21 October 2026, task 28).
2. THE About_Page SHALL say that re:Invent Compass was built by Hennie Francis, an AWS Community Builder, as an entry in the re:Invent Catalog API Builder Challenge, and that more about Hennie is coming soon. The owner adds the full page later (owner decision of 21 October 2026, task 26).

### Requirement 25: The Inspiration

**User Story:** As a visitor, I want to know what inspired Compass, so that I understand why it works the way it does.

#### Acceptance Criteria

1. THE Site SHALL have an Inspiration_Page at `/inspiration`, titled "The Inspiration", reached from the About group with the description "What inspired the project direction".
2. THE Inspiration_Page SHALL say that the project started from a first-time attendee's worry: a reserved seat is only held until 10 minutes before the session starts, and re:Invent already works like an airline, so Compass plans the week like a spec and boards it like a flight. The owner adds the full story later (owner decision of 21 October 2026, task 28).

### Requirement 26: Documentation

**User Story:** As a builder, I want one place that points to the project's documentation, so that I can read how Compass is built and run.

#### Acceptance Criteria

1. THE Site SHALL have a Documentation_Page at `/documentation`, titled "Documentation", reached from the Project group.
2. THE Documentation_Page SHALL link, in the repository, to the README, the build plan, the architecture decision records, the runbooks and the Kiro specs, each with a one-line description, and SHALL build every address from the repository address in `links.ts`.

### Requirement 27: Legal pages

**User Story:** As a visitor, I want the disclaimer and the copyright terms written out, so that I know what Compass is, what it is not and who owns it.

#### Acceptance Criteria

1. THE Site SHALL have a Disclaimer_Page at `/disclaimer` and a Copyright_Page at `/copyright`, reached with Privacy from the Legal group of the main navigation.
2. THE Disclaimer_Page SHALL state the Notice exactly as written; that a Compass pass is unofficial and is not a ticket, and the badge is the ticket; that session details come from the AWS Events API and can change, so the official re:Invent app is the source of truth; that the software is provided "as is", without warranties, as the Apache License 2.0 says; and that AWS and re:Invent are trademarks of Amazon.com, Inc. or its affiliates, and Apple Wallet and Google Wallet of their owners, used only to describe compatibility.
3. THE Copyright_Page SHALL state "Copyright 2026 Hennie Francis"; that the code is licensed under the Apache License 2.0, which lets anyone use, change and share it as long as they keep the copyright notice, the licence and the NOTICE file and say what they changed; that the name "re:Invent Compass" and its logo identify the original project and are not licensed for derivative works, so a fork must use a different name; and SHALL link to the LICENSE and NOTICE files in the repository.

### Requirement 28: More legal pages

**User Story:** As a visitor, I want the terms, the accessibility promise, the security policy and the open-source credits written out, so that I know the rules, what to expect and who to thank.

#### Acceptance Criteria

1. THE Legal group of the main navigation SHALL hold, in order, Terms of use (`/terms`), Privacy, Disclaimer, Copyright and licence, Security (`/security`), Accessibility (`/accessibility`) and Open-source credits (`/credits`), each prerendered.
2. THE Terms_Page SHALL say, in plain English and dated 22 October 2026: the terms cover the website, the Compass MCP server and the Kiro Power; Compass is free and open source, provided as is under the Apache License 2.0 and used at your own risk; Compass does not guarantee a seat, because AWS re:Invent decides seats, sessions and times and the official re:Invent app is the source of truth; Compass passes are unofficial and are not tickets, and your badge is your ticket; a hand-off link and its QR code work for 15 minutes and give access to your passes, so do not share them; do not misuse the pass service (no automated mass requests, no attempts to read other people's passes, no attempts to break its security) and report security problems privately; you are responsible for your AWS Builder ID and for what you approve, and by default Compass does not change your re:Invent schedule; and the terms may change, with the date showing the last change.
3. THE Accessibility_Page SHALL state the WCAG 2.2 AA aim of Requirement 19, what it means for a visitor, how the site is tested (Requirement 22.3), that the passes themselves are drawn by Apple Wallet and Google Wallet, and how to report a barrier through the repository's issues.
4. THE Security_Page SHALL summarise SECURITY.md (private reporting, what to include, the acknowledgement, scope, secrets) and the read-only default and labelled catalog data, and SHALL link to the private reporting form and to SECURITY.md.
5. THE Credits_Page SHALL list the main open-source libraries Compass runs on and is tested with, each with what it does and its licence; a test SHALL check every licence against the installed package.
