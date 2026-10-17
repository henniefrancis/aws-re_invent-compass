# Design Document

## Overview

This design covers S7, the `showcase-site` stream: the public website of re:Invent Compass and its `/board` hand-off page. It owns `site/**` only.

The Site is a static Angular 22.2.3 application with standalone components, zoneless change detection and prerendered output (`outputMode: "static"`). It is served from S3 behind CloudFront at the distribution's default domain (S6). It has five routes:

- `/` (Home_Page): the "Seat released at" story, the airline metaphor, Plan, Board, Fly, and links to the repository, the Builder Center post and the video.
- `/demo` (Demo_Page): a click-through demo that runs the real rules engine (`@compass/core/rules`, S2) in the browser on sessions copied from the synthetic catalog (ADR-016).
- `/install` (Install_Page): the Kiro Power, the npx one-liners and other MCP clients.
- `/privacy` (Privacy_Page): "what leaves your machine", in plain words from build plan section 4.2.
- `/board` (Board_Page): the hand-off page a phone opens from the QR code. It reads the 15-minute capability from the URL fragment, calls `GET /api/v1/handoffs/{handoffId}`, and offers Add to Apple Wallet, Save to Google Wallet and Download calendar (ADR-011).

In the airline metaphor the first four pages are the departures hall and `/board` is the gate.

### Design principles

1. **Static and boring.** Prerendered HTML, same-origin JavaScript and CSS files, no server, no third-party request, no web font, no image CDN. The only network call the Site ever makes is the hand-off read on `/board`.
2. **Logic in plain TypeScript, views in Angular.** Every decision lives in Site_Logic (`site/src/lib/**` and `site/scripts/**`), which has no Angular import and is unit tested to 100% with vitest. Components only bind signals to Site_Logic outputs. This keeps coverage honest with the dependencies already pinned (there is no DOM test environment in the workspace).
3. **Strict CSP by construction.** No inline script, no inline handler, no inline style, no `innerHTML`. A build-time check proves it on every prerendered file, and the browser tests run every flow under the Required_CSP.
4. **The capability is a secret.** The Hand_Off_Id lives in page memory only, is stripped from the address bar as soon as it is read, and travels only in the path of the hand-off routes. It never reaches the console, the title, visible text or storage.
5. **One definition per rule.** The demo reimplements no rule. Boarding, connections, clashes, layovers, rebooking and the safe swap all come from `@compass/core/rules` through one Rules_Port module.
6. **Honest content.** Every Content_Block names its Source_Document; verbatim blocks are checked against the source text by a test. No invented features, numbers or quotes. The Notice is on every page.
7. **Accessible and responsive first.** One responsive layout, 44 px targets, forced-colors styles, no positioned overlays, focus moved to the page heading on navigation, live regions for results.

### Research notes informing the design

- **Static prerendering.** With `outputMode` set to `static`, Angular "does not generate a server file or require a Node.js server to serve the app". Prerendered routes are declared in `app.routes.server.ts` with `renderMode: RenderMode.Prerender` and registered through `provideServerRendering(withRoutes(serverRoutes))`. Source: [Angular SSR guide](https://angular.dev/guide/ssr). The prerendered files are written as `<route>/index.html` in the browser output folder; S6's viewer-request CloudFront function rewrites `/board` to `/board/index.html` (S6 design, Edge_Module), so clean URLs work against the private S3 origin.
- **CSP on static hosting.** Angular's guidance for static hosting without per-response nonces is to "avoid inline scripts by setting `optimization.styles.inlineCritical` to `false` and leaving subresource integrity disabled". It also notes that component styles otherwise still need `'unsafe-inline'`. Source: [Angular security guide, Content Security Policy](https://angular.dev/best-practices/security). This design removes component styles entirely (global stylesheet files only, no `[style]` bindings), so the Required_CSP can keep `style-src 'self'`. The fallback is in Open Questions.
- **Hydration.** "Event replay is enabled alongside incremental hydration", and it can be turned off with `withNoIncrementalHydration()`. Source: [Angular hydration guide](https://angular.dev/guide/hydration). Event replay is not used here, because it relies on an inline dispatch script. The Build_Output_Check proves no inline executable script is emitted.
- **Kiro Power install.** The documented routes are the "Add to Kiro" button on kiro.dev/powers and, in the Powers panel, "Add Custom Power", "Import power from GitHub" with a repository URL. A power needs a valid `plugin.json` or `POWER.md` at its package root. No deep-link format is documented. Source: [Kiro powers installation](https://kiro.dev/docs/powers/installation/).
- **Google Wallet save link.** The link is a `https://pay.google.com/gp/v/save/` URL with a signed JWT appended. Source: [Google Wallet, working with JWTs](https://developers.google.com/wallet/generic/use-cases/jwt).
- **Hand-off identifier.** 16 bytes in base64url without padding (RFC 4648 section 5) is 22 characters. The last character carries only 2 data bits, so in the canonical encoding it is one of `A`, `Q`, `g` or `w`. Accepting only that set refuses non-canonical, ambiguous ids. Source: [RFC 4648](https://datatracker.ietf.org/doc/html/rfc4648#section-5).
- **WCAG 2.2.** Contrast (1.4.3, 1.4.11), Reflow at 320 CSS px (1.4.10), Focus Not Obscured (2.4.11), Target Size Minimum (2.5.8, exceeded here by the plan's 44 px rule), Dragging Movements (2.5.7) and Consistent Help (3.2.6) shape the Shell and the browser tests. Source: [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- **Gradient contrast.** Gradients are written with an explicit `in srgb` interpolation method, so the contrast checker's model (linear interpolation of gamma-encoded sRGB channels) matches what browsers paint. Source: [CSS Color 4, interpolation space](https://www.w3.org/TR/css-color-4/#interpolation-space).
- **Calendar files.** Content lines are folded at 75 octets with CRLF and a single leading space on continuation lines; text values escape backslash, semicolon, comma and newline. Source: [RFC 5545 sections 3.1 and 3.3.11](https://datatracker.ietf.org/doc/html/rfc5545#section-3.1). The pinned root devDependency `ical.js` 2.2.1 parses the output in tests.
- **Device emulation.** Playwright ships named device descriptors (including landscape variants) and `forcedColors: 'active'` emulation. Source: [Playwright emulation](https://playwright.dev/docs/emulation).

## Architecture

### Layered view

```mermaid
flowchart TD
  subgraph browser [Browser]
    subgraph views [Angular views site/src/app]
      Shell[Shell: skip link, header, footer]
      Home[HomePage]
      Demo[DemoPage]
      Install[InstallPage]
      Privacy[PrivacyPage]
      Board[BoardPage]
    end
    subgraph logic [Site_Logic site/src/lib]
      Content[content: blocks with sources]
      Time[time: event local formatting]
      Tokens[design: tokens and contrast]
      Port[demo/rules-port]
      Reducer[demo/demo-state reducer]
      Week[demo/week-view]
      Pass[demo/sample-pass]
      Ics[demo/ics]
      Frag[board/fragment]
      Client[board/handoff-client]
      Valid[board/handoff-view]
      BState[board/board-state]
    end
  end
  Rules[(@compass/core/rules S2)]
  Venues[(data/venues.json S2)]
  Catalog[(fixtures/synthetic S0, copied at build)]
  Contracts[(@compass/contracts types S0)]
  API[(GET /api/v1/handoffs/id S5 via CloudFront)]

  Home --> Content
  Install --> Content
  Privacy --> Content
  Shell --> Content
  Demo --> Reducer
  Demo --> Week
  Demo --> Pass
  Demo --> Ics
  Reducer --> Port
  Week --> Port
  Port --> Rules
  Reducer --> Venues
  Reducer --> Catalog
  Board --> Frag
  Board --> Client
  Board --> Valid
  Board --> BState
  Client --> API
  Valid --> Contracts
  Pass --> Contracts
  Demo --> Time
  Board --> Time
```

### Route map and prerendering

| Route      | Component (lazy) | Prerendered content                                              | Browser-only work                                        |
| ---------- | ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `/`        | `HomePage`       | Full story                                                       | None                                                     |
| `/demo`    | `DemoPage`       | Session list for the empty Demo_Week, computed from pure rules   | User actions, `.ics` download                            |
| `/install` | `InstallPage`    | Full guide                                                       | Copy buttons                                             |
| `/privacy` | `PrivacyPage`    | Full page                                                        | None                                                     |
| `/board`   | `BoardPage`      | Reading state ("Opening your boarding passes") plus `<noscript>` | Read fragment, strip it, fetch, validate, render, expiry |

There is no wildcard route. An unknown path gets S3's 403 through CloudFront, because S6 deliberately configures no custom error responses (they would also rewrite API errors). See Open Questions.

### Logic and view split

Angular components hold one `signal` of state each and call pure Site_Logic functions to get a view model. Templates use only `@if`, `@for` and property bindings over that view model. All branching on data (verdicts, board states, validation, labels, times) happens in Site_Logic. Consequences:

- The site vitest run covers every decision at 100% without a DOM environment (`jsdom` is not pinned; see Open Questions).
- Playwright covers the components on the seven Device_Profiles.
- A static source test enforces the split: no file under `site/src/app/**` may contain `fetch(`, `switch (`, `JSON.parse` or a regular expression literal, and review checks that any remaining `if` only guards a call into Site_Logic.

### Build and check pipeline

1. `npx tsc -b` at the root builds `@compass/contracts` and `@compass/core` to `dist` (the Angular build resolves `@compass/core/rules` through the package `default` export condition).
2. `npx ng build` in `site/` prerenders the five routes to `site/dist/site/browser/` with `namedChunks: true` and `statsJson: true`.
3. `node scripts/check-build-output.mjs` runs the Build_Output_Check over every HTML file.
4. `node scripts/check-budgets.mjs` runs the Budget_Check from `index.html` and `stats.json`.
5. On demand: `npx playwright test -c playwright.config.ts` starts the Static_Server on the build output and runs the browser suite.

Until the Integrator wires these into the root `npm run build` and `npm run e2e` scripts and into `site/package.json` (Notes in `tasks.md`), the stream runs them with `npx` from `site/`.

### Module boundaries and ownership

- The stream writes only `site/**`, its spec folder and `docs/article/screenshots/showcase-site/`.
- `@compass/core/rules` is the only `@compass/core` subpath the Site imports, and only `site/src/lib/demo/rules-port.ts` imports it.
- `@compass/contracts` is imported for types only in browser code (no runtime zod in the initial bundle). Tests may import its runtime schemas.
- `data/venues.json` (S2) is imported read-only by `site/src/lib/demo/venue-data.ts`.
- `fixtures/synthetic/catalog.json` (S0) is never bundled. The Demo_Catalog is a committed copy in `site/src/lib/demo/demo-catalog.ts`, and a provenance test compares it with the catalog.
- Nothing in `contracts/**`, `packages/**`, `data/**`, `fixtures/**`, `infra/**`, root configs or any `package.json` is edited.

### Integration points

| Stream | What the Site uses                                                                  | Status and handling                                                                                  |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| S0     | `@compass/contracts` types and PassFields factory; synthetic catalog; `HandoffView` | Merged. Read only.                                                                                   |
| S1     | `normaliseSession` from `@compass/core/catalog`, in the provenance test only        | Merges 22 Oct. Until then the test uses a test-local mapping per the S1 design, then switches.       |
| S2     | Rules_Engine and `data/venues.json`                                                 | Merges 21 Oct. Until then Site_Logic is written against the S2 design signatures with a test double. |
| S3     | Install content for other MCP clients (`packages/mcp-server/README.md`)             | Merges 27 Oct. Until then the Install_Page shows only the Kiro and npx sections.                     |
| S5     | `GET /api/v1/handoffs/{handoffId}` and the bundle and calendar paths it returns     | Contract only. Browser tests mock the route with contract-shaped fixtures.                           |
| S6     | Response headers policy (Required_CSP), directory rewrite, site sync folder         | Requests in `tasks.md` Notes.                                                                        |

## Components and Interfaces

All identifiers are illustrative TypeScript signatures. Files are kebab-case. Site_Logic files import nothing from `@angular/*`.

### Component 1: Workspace and build configuration (`site/`)

Files: `angular.json`, `tsconfig.json`, `tsconfig.app.json`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `src/index.html`, `src/main.ts`, `src/main.server.ts`, `src/app/app.config.ts`, `src/app/app.config.server.ts`, `src/app/app.routes.ts`, `src/app/app.routes.server.ts`.

- `angular.json`: project `site`, builder `@angular/build:application`, `browser: src/main.ts`, `server: src/main.server.ts`, `outputMode: "static"`, `styles: ["src/styles/index.css"]`, `optimization: { scripts: true, styles: { minify: true, inlineCritical: false }, fonts: false }`, `subresourceIntegrity: false`, `namedChunks: true`, `statsJson: true`, `budgets` on raw size as an early warning only (the compressed budgets live in the Budget_Check).
- `tsconfig.json`: the settings the Angular 22.2.3 CLI generates for a new standalone project, plus `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `resolveJsonModule`, `lib: ["ES2024", "DOM"]` and `customConditions: ["@compass/source"]`; includes `src/**`, `test/**`, `e2e/**` and the two config files so ESLint's project service can type them.
- `app.config.ts`:

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: TitleStrategy, useClass: SiteTitleStrategy }, // "<page> | re:Invent Compass"
    provideClientHydration(withNoIncrementalHydration()), // no event replay
  ],
};
```

- `app.routes.ts`: five routes with `loadComponent` and a `title`; `app.routes.server.ts`: the same five paths with `RenderMode.Prerender`.
- `index.html`: `<html lang="en">`, `<meta charset>`, viewport, description, `<meta name="referrer" content="no-referrer">`, favicon link to an original SVG, `<app-root>`. No inline script or style.
- `vitest.config.ts`: `include: ['test/**/*.test.ts']`, environment `node`, `resolve.conditions: ['@compass/source']`, v8 coverage over `src/lib/**/*.ts` and `scripts/**/*.mjs` at 100% for lines, branches, functions and statements, no exclusions.
- `.gitignore`: `.angular/`, `dist/`, `test-results/`, `playwright-report/`.

### Component 2: Shell (`src/app/shell/`)

Files: `app.component.ts`, `site-header.component.ts`, `site-footer.component.ts`, `site-title-strategy.ts`, `focus-on-navigate.ts`, each with an external `.html` template where it renders markup.

- Skip link "Skip to main content" targeting `<main id="main" tabindex="-1">`.
- Header: product name (link to `/`) and a plain wrapping list of four links. No menu button, no overlay, nothing fixed or sticky.
- Footer: the Notice (from `content/notice.ts`), then links in a fixed order: repository, Builder Center post, video, Install, Privacy. An unconfigured URL renders as the text "coming soon" (the decision lives in `content/links.ts` and is covered by example tests).
- `focus-on-navigate.ts`: on each `NavigationEnd` after the first, focuses the page `<h1 tabindex="-1">` through `afterNextRender`. The pure helper `shouldMoveFocus(navigationIndex)` lives in `src/lib/shell/focus.ts`.

### Component 3: Content modules (`src/lib/content/`)

Files: `story.ts`, `metaphor.ts`, `acts.ts`, `principles.ts`, `install.ts`, `privacy.ts`, `notice.ts`, `links.ts`, `content-block.ts`.

```ts
// content-block.ts
type SourceDocument =
  | 'CONCEPT.md'
  | 'README.md'
  | '.kiro/steering/product.md'
  | 'docs/architecture/build-plan.md'
  | 'packages/mcp-server/README.md'
  | 'https://kiro.dev/docs/powers/installation/';

interface ContentBlock {
  id: string;
  text: string;
  source: SourceDocument;
  section?: string; // for example "4.2" or "Act 1: Plan"
  verbatim: boolean; // true: text must appear exactly in the source file
}

// links.ts
interface SiteLinks {
  repository: string; // https://github.com/henniefrancis/aws-re_invent-compass (CONCEPT.md section 12)
  builderCenterPost: string | null;
  video: string | null;
  kiroPowerListing: string | null; // set only if Compass is listed on kiro.dev/powers
  packageVersion: string | null; // npm version pinned in the npx commands once published
}
function footerItems(links: SiteLinks): readonly FooterItem[]; // fixed order; null URL becomes text
```

The Notice block is verbatim from `README.md`. The tagline, "Seat released at 10:20", "Starts 10:30" and "Unofficial. Your badge is your ticket." are verbatim blocks. Paraphrased blocks carry their source and section for human review. The scanner list on the Home_Page comes from the build plan and product steering, not from `CONCEPT.md` section 3, because the plan wins where they differ.

### Component 4: Home, Install and Privacy pages (`src/app/pages/`)

Presentational components bound to the content modules.

- `HomePage`: hero with name and tagline; the "Starts 10:30" versus "Seat released at 10:20" illustration as accessible text plus original inline SVG; the metaphor as a `<table>` with `<th scope="col">`; three act cards (Plan, Board, Fly); principles list; two primary actions (Demo, Install); links block.
- `InstallPage`: plan on a computer, board on any device; Kiro Power steps ("Add to Kiro" only when `kiroPowerListing` is set, else the documented "Import power from GitHub" steps with the repository URL); npx commands; other MCP clients (only after S3 merges, copied from its README); hooks are Kiro only and the guardrail runs in the server. Each command has a copy button using `navigator.clipboard.writeText` on click, with a polite live region. Command strings and copy messages come from `content/install.ts`.
- `PrivacyPage`: three sections (stays on your machine; leaves your machine and for how long; this website), plus the responsible party and how `forget_me` works, all from `content/privacy.ts` with build plan section 4.2 as the source.

### Component 5: Rules_Port (`src/lib/demo/rules-port.ts`)

The only module that imports `@compass/core/rules`. Types are taken with `ReturnType` and `Parameters` from the exported functions, so the Site does not depend on S2 exporting every result type name.

```ts
import * as rules from '@compass/core/rules';
import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';

type Context = Parameters<typeof rules.checkReservation>[2];
type BoardingResult = ReturnType<typeof rules.computeBoarding>;
type ConnectionResult = ReturnType<typeof rules.classifyConnection>;
type ClashReport = ReturnType<typeof rules.findClashes>;
type LayoverReport = ReturnType<typeof rules.checkLayovers>;
type RebookResult = ReturnType<typeof rules.findRebookingOptions>;
type SwapPlan = ReturnType<typeof rules.planSafeSwap>;

interface ScheduleInput {
  commitments: readonly Commitment[];
  sessions: Readonly<Record<string, NormalisedSession>>;
}

interface DayConnection {
  fromRef: string;
  toRef: string;
  result: ConnectionResult;
}

interface RulesPort {
  checkReservation(candidate: NormalisedSession, schedule: ScheduleInput, ctx: Context): Verdict;
  computeBoarding(session: NormalisedSession, ctx: Context): BoardingResult;
  connectionsForDay(day: ScheduleInput, ctx: Context): readonly DayConnection[];
  findClashes(schedule: ScheduleInput, ctx: Context): ClashReport;
  checkLayovers(day: ScheduleInput, ctx: Context): LayoverReport;
  findRebookingOptions(
    baseCode: string,
    candidates: readonly NormalisedSession[],
    favorites: readonly NormalisedSession[],
    ctx: Context,
  ): RebookResult;
  planSafeSwap(
    original: Commitment,
    repeat: NormalisedSession,
    confirmation: ScheduleInput,
    ctx: Context,
  ): SwapPlan;
}

function createRulesPort(): RulesPort;
function createDemoContext(now: string, venueData: unknown): Context; // uses S2 withContextDefaults
```

`connectionsForDay` orders the day's commitments by start and calls `classifyConnection` for each consecutive pair. `classifyConnection` takes S2's internal resolved view, so this needs S2 to export `resolveCommitment` (or a helper that lists a day's connections). That and `withContextDefaults` are Integrator requests to S2 (Open Questions 1). A test double in `site/test/doubles/rules-double.ts` implements `RulesPort` for edge cases the curated data cannot reach.

### Component 6: Demo catalog and context (`src/lib/demo/demo-catalog.ts`, `venue-data.ts`)

```ts
interface DemoEvent {
  timezone: string; // from the synthetic sessionTime.timezone of the copied records
  now: string; // fixed demo instant: 18:00 event local time on the day before the first demo day
  windowStart: string; // 00:00 event local time on the first demo day
  windowEnd: string; // 23:59 event local time on the last demo day
}

const DEMO_EVENT: DemoEvent;
const DEMO_SESSIONS: readonly NormalisedSession[]; // 12 to 24, copied from fixtures/synthetic/catalog.json
const DEMO_SOURCE_IDS: readonly string[]; // the syn-NNN ids, same order
const STARTER_WEEK: readonly string[]; // sessionIds held by "Start with a sample week"
const GUIDED_CLASH: {
  tryAdd: string; // the session the guided path names
  clashesWith: string; // a STARTER_WEEK session that overlaps it
  heldRepeat: string; // the -R repeat of clashesWith, overlapping no other STARTER_WEEK session
};

// venue-data.ts
import venueFile from '../../../../data/venues.json';
const DEMO_VENUE_DATA: unknown; // passed to createDemoContext, validated by S2's schema in a test
```

Curation rules: the engineer picks records from the synthetic catalog that cover every pattern in Requirement 7 criterion 3, copies them, and normalises each with the S1 mapping. Nothing is edited by hand. If a pattern is missing the stream stops and asks the Integrator (Requirement 7 criterion 4).

### Component 7: Demo reducer and week view (`src/lib/demo/demo-state.ts`, `week-view.ts`)

```ts
type Pending =
  | { kind: 'warn'; sessionId: string; reasons: readonly string[] }
  | {
      kind: 'block';
      sessionId: string;
      reasons: readonly string[];
      rebook: RebookResult;
      swapOffer: { originalSessionId: string; repeatSessionId: string } | null;
    };

type SwapStep = 'offered' | 'repeatReserved' | 'confirmed' | 'done' | 'stopped';

interface SwapProgress {
  originalSessionId: string;
  repeatSessionId: string;
  blockedSessionId: string;
  step: SwapStep;
  plan: SwapPlan | null;
  reasons: readonly string[];
}

interface DemoState {
  commitments: readonly Commitment[]; // ordered by startsAt
  pending: Pending | null;
  swap: SwapProgress | null;
  selectedPassSessionId: string | null;
  announcement: string; // text for the polite live region
}

type DemoAction =
  | { type: 'loadStarter' }
  | { type: 'add'; sessionId: string }
  | { type: 'confirmWarn' }
  | { type: 'dismiss' }
  | { type: 'remove'; ref: string }
  | { type: 'bookRepeat'; sessionId: string }
  | { type: 'startSwap' }
  | { type: 'advanceSwap' }
  | { type: 'addLayover'; start: string; end: string }
  | { type: 'selectPass'; sessionId: string }
  | { type: 'reset' };

interface DemoDeps {
  rules: RulesPort;
  catalog: ReadonlyMap<string, NormalisedSession>;
  context: Context;
}

const EMPTY_DEMO: DemoState;
function reduceDemo(state: DemoState, action: DemoAction, deps: DemoDeps): DemoState;

// week-view.ts
interface WeekItemView {
  ref: string;
  kind: 'reservedSession' | 'personalTime';
  code: string | null;
  title: string;
  gate: string; // "Venue, Room" or "Venue not published"
  timeRange: string; // event local wall clock
  boarding: string; // "Seat released at 10:20 AM", or the not-applicable or unknown reason
}
interface ConnectionView {
  classification: string;
  text: string;
} // class stated in words
interface LayoverView {
  lines: readonly string[];
  suggestions: readonly { start: string; end: string; label: string }[];
}
interface WeekDayView {
  date: string;
  heading: string;
  items: readonly WeekItemView[];
  connections: readonly ConnectionView[];
  layovers: LayoverView;
}

function toScheduleInput(
  commitments: readonly Commitment[],
  catalog: ReadonlyMap<string, NormalisedSession>,
): ScheduleInput;
function buildWeekView(state: DemoState, deps: DemoDeps): readonly WeekDayView[];
function buildCatalogView(state: DemoState, deps: DemoDeps): readonly CatalogDayView[]; // the list of Requirement 8.1
```

Reducer rules:

- `add`: look up the session; call `checkReservation(candidate, toScheduleInput(commitments), context)`. Allow adds; warn sets `pending.warn`; block sets `pending.block` with `findRebookingOptions(baseCode, DEMO_SESSIONS, [], context)` and a `swapOffer` when the clash partner (a held reserved session that overlaps the candidate, as reported by `findClashes` on the schedule plus the candidate) has a repeat in the catalog.
- `confirmWarn` adds the pending session. `dismiss` clears `pending`.
- `startSwap`: `checkReservation(repeat, schedule, context)`. Block stops the swap with its reasons and leaves `commitments` unchanged. Warn shows its reasons with the swap offer. Otherwise, or after warn, `step = 'offered'`.
- `advanceSwap` runs one step per call: `offered` to `repeatReserved` (adds the repeat); `repeatReserved` to `confirmed` (calls `planSafeSwap(original, repeat, toScheduleInput(commitments), context)`; safe continues, unsafe or failed removes the repeat, keeps the original and stops with the plan's reasons); `confirmed` to `done` (removes the original and announces that the blocked session can now be added).
- `bookRepeat` behaves as `add` for the repeat.
- `addLayover` adds a `personalTime` commitment titled "Layover" with the block's start and end.
- Every branch writes a plain-English `announcement`; reasons are copied from the Rules_Engine unchanged.
- The reducer never reads the clock; `context.now` is the fixed demo instant.

### Component 8: Sample pass (`src/lib/demo/sample-pass.ts`)

```ts
interface SamplePass {
  sessionCode: string;
  title: string; // normalisePassText, then 77 characters plus three ASCII dots when longer than 80
  gate: string; // "Venue, Room" or "Venue not published"
  seatReleasedAt: string; // event local wall clock of boarding closes
  walkFromPrevious: string | null; // "6 min walk from <venue>" when known
  nextConnection: string | null; // "<code> at <time>, <n> min walk" when known
  label: 'Sample pass. Made-up session.';
  disclaimer: 'Unofficial. Your badge is your ticket.';
  accessibleName: string; // every field above in one sentence list
  passFields: {
    // the PassFields input shape, validated in tests
    sessionCode: string;
    title: string;
    venue: string;
    room: string;
    startsAt: string;
    endsAt: string;
    walkFromPrevious?: { minutes: number; fromVenue: string };
    nextConnection?: { sessionCode: string; startsAt: string; venue: string; walkMinutes: number };
  };
}

function fitTitle(title: string): string; // normalisePassText, then 77 characters plus "..." when longer than 80
function clampWalk(minutes: number): number; // whole minutes from 0 to 90
// passFields.venue and passFields.room are empty strings when the session has none; "Venue not published" is display text only.
function buildSamplePass(sessionId: string, state: DemoState, deps: DemoDeps): SamplePass | null;
```

`SamplePassComponent` renders an original inline SVG card (no barcode, no QR code, no AWS mark or colour) with `role="img"`, `aria-label` set to `accessibleName`, and visible text for every field.

### Component 9: Sample calendar (`src/lib/demo/ics.ts`)

```ts
interface IcsAlarm {
  minutesBeforeStart: number;
  description: 'Boarding closes' | 'Leave now';
}
interface IcsEvent {
  uid: string;
  start: string;
  end: string;
  summary: string;
  location: string;
  description: string;
  alarms: readonly IcsAlarm[];
}

function escapeText(value: string): string; // backslash, semicolon, comma, newline
function foldLine(line: string): readonly string[]; // 75 octets, UTF-8 safe, continuation starts with one space
function toUtcStamp(iso: string): string; // YYYYMMDDTHHMMSSZ
function demoCalendarEvents(state: DemoState, deps: DemoDeps): readonly IcsEvent[];
function serialiseCalendar(events: readonly IcsEvent[], dtstamp: string): string; // CRLF joined
```

Rules: `PRODID:-//re:Invent Compass//Showcase demo//EN`; `UID:<sessionId or layover ref>@demo.reinvent-compass.invalid`; `DTSTAMP` from `DEMO_EVENT.now`; times in UTC; reserved sessions get "Boarding closes" 10 minutes before start and "Leave now" `10 + walkingMinutes` before start when the connection from the previous commitment is known; personal time gets no alarm; descriptions say "Made-up session for the re:Invent Compass demo. Unofficial. Your badge is your ticket." The component turns the string into a `Blob`, clicks a temporary anchor with `download="compass-demo-week.ics"`, then revokes the object URL.

### Component 10: Board fragment parser (`src/lib/board/fragment.ts`)

```ts
type HandoffId = string & { readonly __brand: 'HandoffId' };
type FragmentResult = { ok: true; id: HandoffId } | { ok: false };

const HANDOFF_FRAGMENT = /^#h=([A-Za-z0-9_-]{21}[AQgw])$/;
function parseBoardFragment(hash: string): FragmentResult;
```

No trimming, decoding or case folding. Any other form (missing `h=`, extra parameters, padding, percent encoding, wrong length, wrong last character) is refused.

### Component 11: Hand-off client (`src/lib/board/handoff-client.ts`)

```ts
interface ResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
type FetchLike = (url: string, init: RequestInit) => Promise<ResponseLike>;

type HandoffOutcome =
  | { kind: 'ok'; body: unknown }
  | { kind: 'status'; status: number }
  | { kind: 'notJson' }
  | { kind: 'network' }
  | { kind: 'timeout' };

function buildHandoffRequest(id: HandoffId): { url: string; init: RequestInit };
// url: '/api/v1/handoffs/' + id
// init: { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
//         referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal }

function fetchHandoff(
  id: HandoffId,
  deps: { fetch: FetchLike; timeoutMs: number; setTimer: SetTimer; clearTimer: ClearTimer },
): Promise<HandoffOutcome>; // exactly one call to deps.fetch; never retries
```

### Component 12: Hand-off view validator (`src/lib/board/handoff-view.ts`)

```ts
import type { CompassApi } from '@compass/contracts';
type HandoffViewWire = CompassApi.components['schemas']['HandoffView'];

interface BoardSession {
  serialNumber: string;
  sessionCode: string;
  title: string;
  startsAt: string;
}
interface AppleBundle {
  path: string;
  number: number; // 1 for the first bundle
  of: number; // how many Apple bundles the hand-off holds
}
interface ValidatedHandoff {
  expiresAt: string;
  sessions: readonly BoardSession[];
  appleBundles: readonly AppleBundle[];
  googleSaveUrl: string | null;
  calendarPath: string | null;
}

function validateHandoffView(body: unknown, id: HandoffId): ValidatedHandoff | null;
```

A hand-written validator (zod stays out of the browser bundle) enforcing Requirement 17 criteria 3 to 5. A compile-time assertion checks that the accepted wire shape is assignable to `HandoffViewWire` and back, so a contract change breaks the build. Strings are never interpreted as HTML; Angular text binding renders titles.

### Component 13: Board state machine and view model (`src/lib/board/board-state.ts`)

```ts
type BoardState =
  | { kind: 'reading' }
  | { kind: 'invalidLink' }
  | { kind: 'loading' }
  | { kind: 'ready'; handoff: ValidatedHandoff }
  | { kind: 'expired' }
  | { kind: 'rateLimited' }
  | { kind: 'unavailable' };

type BoardEvent =
  | { type: 'fragmentRead'; result: FragmentResult }
  | { type: 'requestStarted' }
  | { type: 'outcome'; outcome: HandoffOutcome; validated: ValidatedHandoff | null }
  | { type: 'clock'; nowMs: number };

interface BoardAction {
  kind: 'apple' | 'google' | 'calendar';
  href: string;
  label: string;
}
interface BoardViewModel {
  heading: string;
  message: string;
  busy: boolean;
  canRetry: boolean;
  actions: readonly BoardAction[];
  sessions: readonly { code: string; title: string; time: string }[];
  expiresText: string | null; // "This link works for about 12 more minutes."
  timezoneNote: string | null; // "Times are event local time (UTC-08:00)."
  deviceHint: string | null;
  announcement: string;
}

function reduceBoard(state: BoardState, event: BoardEvent): BoardState;
function toBoardViewModel(state: BoardState, nowMs: number): BoardViewModel;
function canRetry(state: BoardState): boolean; // only Unavailable and Rate_Limited
function bundleLabel(bundle: AppleBundle): string; // "Add to Apple Wallet", or "Add to Apple Wallet (bundle 2 of 3)" when there are several
function msUntilExpiry(handoff: ValidatedHandoff, nowMs: number): number;
```

Mapping: `ok` with a validated body is Ready; `ok` with `null` validation, `notJson`, `network`, `timeout` and any status other than 404 and 429 are Unavailable; 404 is Expired; 429 is Rate_Limited. `clock` at or after `expiresAt` turns Ready into Expired. Messages are constants; none is built from the id or from a response body.

### Component 13b: Board controller (`src/lib/board/board-controller.ts`, CTO H4)

The whole /board flow lives in Site_Logic behind injected browser functions, so it is unit tested at 100%. The component only wires up the browser globals.

```ts
interface BoardControllerDeps {
  readHash: () => string;
  replaceState: (path: string) => void;
  fetch: FetchLike;
  setTimer: SetTimer;
  clearTimer: ClearTimer;
  now: () => number;
  onChange: (state: BoardState) => void;
}
interface BoardController {
  start(): Promise<void>;
  retry(): Promise<void>;
  dispose(): void;
  state(): BoardState;
}
function createBoardController(deps: BoardControllerDeps): BoardController;
```

Rules: `start()` reads the hash once (a second call does nothing), calls `replaceState('/board')` before any request, whether or not the fragment is valid, and sends no request for an invalid fragment. A valid fragment sends exactly one request, and the id stays in a private variable. `retry()` sends exactly one request, and only from Unavailable or Rate_Limited. One expiry timer switches Ready to Expired when the clock reaches `expiresAt`; a wait longer than the browser timer limit (2^31 - 1 ms) is done in steps; the timer is cleared on every state change and on `dispose()`, after which late answers are ignored.

### Component 14: Board page component (`src/app/pages/board/`)

- Prerendered in the Reading state with `<noscript>` text and `<meta name="robots" content="noindex">` (set through Angular `Meta` for this route only).
- The component holds no flow logic (CTO H4). In `afterNextRender` it builds the Board_Controller (Component 13b) with the browser globals (`location.hash`, `Location.replaceState` from `@angular/common`, the global `fetch`, `setTimeout`, `clearTimeout`, `Date.now`) and calls `start()`; "Try again" calls `retry()`; `ngOnDestroy` calls `dispose()`.
- The controller's `onChange` writes the state to a signal. The view model comes from `toBoardViewModel(state, Date.now())`.
- After each state change, focus moves to the state heading (`tabindex="-1"`) and the announcement goes to the polite live region.
- Action links are plain `<a href>` elements: Apple bundle paths (`type="application/vnd.apple.pkpasses"`), the validated Google save URL, and the calendar path with `download`. No JavaScript download path, so iOS Safari hands the bundle to Wallet natively.

### Component 15: Time formatting (`src/lib/time/time-format.ts`)

```ts
function formatWallClock(iso: string): string; // "10:20 AM" from the string's own local part
function offsetLabel(iso: string): string; // "UTC-08:00" (or "UTC" for Z)
function formatInZone(iso: string, timeZone: string): string; // Intl, en-US, numeric hour, 2-digit minute
function dayHeading(isoDate: string): string; // "Monday 30 November", from an event local YYYY-MM-DD
function timezoneNote(isos: readonly string[]): string | null; // one note when all offsets agree, else null (per-row offsets shown)
```

The Board_Page uses `formatWallClock` (it knows no IANA zone). The demo uses `formatInZone` with `DEMO_EVENT.timezone`.

### Component 16: Design tokens and contrast (`src/lib/design/`, `src/styles/`)

```ts
type Hex = `#${string}`;
interface Gradient {
  stops: readonly { colour: Hex; at: number }[];
} // 0..1, ascending
interface ContrastPair {
  name: string;
  foreground: Hex;
  background: Hex | Gradient;
  kind: 'text' | 'nonText';
}

function relativeLuminance(hex: Hex): number; // WCAG 2.x definition
function contrastRatio(a: Hex, b: Hex): number; // (L1 + 0.05) / (L2 + 0.05)
function interpolateSrgb(g: Gradient, t: number): Hex;
function worstContrast(fg: Hex, bg: Hex | Gradient, samples?: number): number; // default 256 plus every stop
const TOKENS: Readonly<Record<string, Hex>>;
const GRADIENTS: Readonly<Record<string, Gradient>>;
const CONTRAST_PAIRS: readonly ContrastPair[];
```

Styles (`src/styles/`): `index.css` imports `tokens.css` (custom properties matching `TOKENS` and `GRADIENTS`, gradients written `linear-gradient(in srgb, ...)`), `base.css` (system font stack, focus ring of at least 3:1, `min-block-size` and `min-inline-size` of 44px on buttons and navigation links), `layout.css` (single responsive layout, no fixed or sticky positioning), `components.css` (BEM-style classes for every component), `forced-colors.css` (`@media (forced-colors: active)` using `CanvasText`, `LinkText`, `ButtonText`, `ButtonBorder` and `Highlight`, borders on cards and buttons) and `motion.css` (`@media (prefers-reduced-motion: reduce)` removes every transition). A test checks that `tokens.css` declares exactly the values in `TOKENS` and `GRADIENTS`.

### Component 17: Build_Output_Check (`site/scripts/check-build-output.mjs`)

```js
/** @returns {{ rule: string, file: string, detail: string }[]} */
export function findOutputIssues(html, { file, expectNoindex });
export function expectedRouteFiles(); // index.html, demo/, install/, privacy/, board/ index.html
export async function runCli({ distDir, readFile, listFiles }); // { code, stdout, stderr }
```

Rules: every expected route file exists; no `<script>` without a same-origin `src` unless `type="application/json"`; no `on*` attribute; no `javascript:` URL; no `<style>` element; no `style` attribute; no absolute URL in `src`, in `href` of `link`, or in `srcset` (resource loads stay same-origin); exactly one `<h1>`; `lang="en"`; the Notice text present; `noindex` on the board page only. A small tag and attribute scanner (aware of quotes, comments and raw text) does the parsing, with no dependency. The CLI follows the S0 `.github/scripts` pattern: a pure `runCli` plus an entry guard, so the wiring is covered in-process.

### Component 18: Budget_Check (`site/scripts/check-budgets.mjs`)

```js
export function gzipSize(buffer); // zlib.gzipSync level 9 length
export function initialFiles(indexHtml); // module scripts and modulepreload links
export function closure(metafileOutputs, startFiles); // static imports only
export function demoFiles(metafileOutputs, initial); // demo route chunk closure minus initial
export function evaluateBudgets(sizes, limits); // { pass, lines }
export async function runCli({ distDir, readFile });
```

Limits: initial 250,000 bytes; demo 150,000 bytes, both gzip compressed. The demo route chunk is the output whose `entryPoint` is `src/app/pages/demo/demo-page.component.ts` in `stats.json`.

### Component 19: Static_Server (`site/scripts/serve-static.mjs`, `site/scripts/required-csp.mjs`)

```js
export const REQUIRED_CSP; // the Glossary string, single source; README quotes it, a test compares
export const SECURITY_HEADERS; // CSP, X-Content-Type-Options nosniff, Referrer-Policy no-referrer
export function resolveSitePath(urlPath); // '/' to index.html; extensionless '/x' to '/x/index.html'; traversal or unknown to 403
export function contentType(file);
export function createStaticServer({ root, readFile }); // node:http, used only by Playwright
```

It mirrors S6's directory rewrite and returns 403 for unknown paths, like S3 through CloudFront.

### Component 20: Browser test suite (`site/e2e/`, `site/playwright.config.ts`)

- Projects: the seven Device_Profiles from Playwright's pinned device registry (desktop Chromium, Firefox and WebKit; an iPad descriptor and its landscape variant; an iPhone descriptor and its landscape variant). `retries: 0`. `webServer` starts the Static_Server on the build output.
- Specs: `pages.spec.ts`, `demo.spec.ts`, `board.spec.ts`, `a11y.spec.ts`, `forced-colors.spec.ts` (Chromium), `csp.spec.ts`, `privacy-network.spec.ts`, `layout.spec.ts` (targets, reflow at 320 px, short viewport, focus not obscured), `performance.spec.ts` (Chromium LCP proxy until Lighthouse is pinned).
- Hand-off routes are mocked with `page.route` from fixtures in `site/e2e/fixtures/handoff/` (ready with one bundle; ready with three bundles, Google and calendar; ready with Apple only; 404; 429; 500; malformed; wrong bundle path; foreign Google host). A vitest test validates every "ready" fixture with `validateHandoffView` and checks every negative fixture is rejected.
- Waits use focus, headings and live region text only.

## Data Models

### Imported from `@compass/contracts` (types only in browser code)

- `NormalisedSession`, `Commitment`, `Verdict`: the demo's session, commitment and guardrail shapes.
- `CompassApi.components['schemas']['HandoffView']`: the hand-off response, checked at compile time against the validator.
- `createPassFieldsSchema` (tests only): validates `SamplePass.passFields` for the demo event window.
- `SessionWireSchema` (tests only): validates the synthetic records the Demo_Catalog is copied from.

### Imported from `@compass/core/rules` (through the Rules_Port only)

`Context` and every result type, taken with `Parameters` and `ReturnType`, plus `withContextDefaults` and the requested `resolveCommitment` (Open Questions 1).

### Internal models owned by this stream

| Model              | Where                          | Notes                                                                 |
| ------------------ | ------------------------------ | --------------------------------------------------------------------- |
| `ContentBlock`     | `lib/content/content-block.ts` | Text plus Source_Document, section and verbatim flag                  |
| `SiteLinks`        | `lib/content/links.ts`         | A null URL renders as "coming soon" text                              |
| `DemoEvent`        | `lib/demo/demo-catalog.ts`     | Fixed demo instant and window; timezone from data                     |
| `DemoState`        | `lib/demo/demo-state.ts`       | Memory only                                                           |
| `WeekDayView`      | `lib/demo/week-view.ts`        | Display strings only                                                  |
| `SamplePass`       | `lib/demo/sample-pass.ts`      | Includes the PassFields input shape                                   |
| `IcsEvent`         | `lib/demo/ics.ts`              | Serialised to RFC 5545                                                |
| `HandoffId`        | `lib/board/fragment.ts`        | Branded string, memory only                                           |
| `ValidatedHandoff` | `lib/board/handoff-view.ts`    | Only produced by the validator                                        |
| `BoardState`       | `lib/board/board-state.ts`     | Holds no id; bundle and calendar paths are the only id-bearing values |
| `ContrastPair`     | `lib/design/contrast.ts`       | Every foreground and background pairing used by the styles            |

### Cross-cutting data rules

- **No persistence.** No cookie, web storage, IndexedDB, Cache API or service worker anywhere; enforced by a static source test and a browser test.
- **No clock in demo logic.** `Date.now()` and `new Date()` are banned under `src/lib/demo/**`; the Board_Page passes `Date.now()` in from the component.
- **Same origin only.** The only `fetch` is in `handoff-client.ts`, with a relative URL. Absolute URLs exist only in `links.ts` (navigation) and as the Google prefix constant in `handoff-view.ts`.
- **Text, never HTML.** No `innerHTML` or sanitiser bypass; every dynamic string is bound as text.

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system, essentially a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

The Site is a good fit for property-based testing where its logic is pure: the fragment parser, the hand-off request builder, the response validator, the board state machine, time formatting, the demo reducer, the sample pass and calendar builders, the contrast maths and the two build checks. Page layout, axe results, forced colors and real browser behaviour are covered by the Playwright suite rather than by properties. Content provenance is checked by example tests over the fixed content set.

### Property 1: The fragment parser accepts exactly the canonical hand-off ids

_For any_ 16 random bytes, `#h=` followed by their unpadded base64url encoding is accepted and the returned id decodes back to the same bytes; _for any_ other string (wrong prefix, extra characters, padding, percent encoding, any length other than 22, any character outside the base64url alphabet, or a last character outside `A`, `Q`, `g`, `w`), the parser returns `{ ok: false }`.

**Validates: Requirements 16.1, 16.2, 16.3**

### Property 2: An invalid link never sends a request

_For any_ fragment that the parser refuses, driving the Board_Controller leads to the Invalid_Link state, the hash is read once, `replaceState('/board')` runs, and the injected fetch is called zero times, including after any number of "Try again" calls. _For any_ valid id, `replaceState('/board')` runs before the first fetch, the hash is read once, and each "Try again" makes exactly one fetch.

**Validates: Requirements 16.3, 16.4, 17.1, 17.2**

### Property 3: The hand-off request is one same-origin GET carrying the id only in the path

_For any_ valid id, `buildHandoffRequest` returns the relative URL `/api/v1/handoffs/<id>` and an init with method GET, credentials omitted, `cache: 'no-store'`, `redirect: 'error'`, no body and no header containing the id; and _for any_ fetch behaviour (resolve, reject, never settle), `fetchHandoff` calls fetch exactly once and settles by the timeout.

**Validates: Requirements 16.6, 17.1, 17.2**

### Property 4: Hand-off view validation is all or nothing

_For any_ body generated from the `HandoffView` schema with paths built for the same id, the validator accepts it and returns every session and action unchanged; _for any_ single mutation (a missing or extra field, a wrong type, a non-UUID serial, a date-time without offset, zero or more than 80 sessions, a bundle path for another id or out of order, too many bundles, a calendar path for another id, or a Google URL that is not https, not on `pay.google.com`, not under `/gp/v/save/`, or carries user info or a port), the validator returns `null`.

**Validates: Requirements 17.3, 17.4, 17.5, 17.6**

### Property 5: Every request outcome maps to exactly one board state

_For any_ outcome (status 100 to 599 with or without a body, not JSON, network error, timeout) and validation result, `reduceBoard` from Loading yields exactly one of Ready (status 200 with a validated body), Expired (404), Rate_Limited (429) or Unavailable (everything else), and the view model of any state other than Ready has no action links.

**Validates: Requirements 17.7, 18.1, 18.4, 18.5, 18.7**

### Property 6: The hand-off id never reaches visible text, the title or the console

_For any_ valid id and _for any_ sequence of board events, every string in every view model (heading, message, announcement, expiry text, timezone note, device hint, session rows and action labels) is free of the id, and the id appears only inside action `href` values that start with `/api/v1/handoffs/<id>/`; Site_Logic contains no console call.

**Validates: Requirements 2.4, 16.5, 16.6**

### Property 7: Local expiry removes every action

_For any_ validated hand-off and _for any_ clock value, the state after a `clock` event is Expired with no actions exactly when the clock is at or after `expiresAt`, and stays Ready with unchanged actions otherwise.

**Validates: Requirements 18.6**

### Property 8: Apple bundle labels cover each bundle exactly once

_For any_ bundle count from 1 to 8, the labels name bundles 1 to N once each as "Add to Apple Wallet (bundle K of N)", and a single bundle is labelled "Add to Apple Wallet" with no number. A hand-off view gives one Apple action per bundle path, in order, each with a different label. (The labels do not name pass ranges: the contract does not say how passes are split across bundles.)

**Validates: Requirements 18.2**

### Property 9: Event local time formatting preserves the wall clock

_For any_ ISO 8601 date-time with an offset, `formatWallClock` shows the hour and minute written in the string in 12-hour form; _for any_ instant and IANA zone, `formatInZone` equals `formatWallClock` of the same instant written with that zone's offset at that instant; and `timezoneNote` returns one note exactly when all offsets in the view agree.

**Validates: Requirements 9.5, 18.1**

### Property 10: The demo week follows the guardrail exactly

_For any_ sequence of demo actions over the Demo_Catalog, a session enters the Demo_Week only through an allow verdict, a warn verdict followed by `confirmWarn`, or a completed safe swap step; a block verdict never changes the Demo_Week; and every reason shown equals, in order, the reasons the Rules_Port returned.

**Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.11**

### Property 11: The demo week stays consistent

_For any_ sequence of demo actions, the commitments are ordered by start, `findClashes` over the Demo_Week reports no clash between reserved sessions, removing a just-added commitment returns the previous Demo_Week, and `reset` returns `EMPTY_DEMO`.

**Validates: Requirements 8.9, 9.4, 13.2**

### Property 12: The safe swap runs in order and cancels only after a safe confirmation

_For any_ swap start state and _for any_ Rules_Port answers (allow, warn or block for the repeat; safe, unsafe or failed from `planSafeSwap`), the steps happen only in the order reserve repeat, confirm, cancel original; the original leaves the Demo_Week only after `planSafeSwap` returned safe for a schedule that holds the repeat; and on block, unsafe or failed the Demo_Week ends equal to the Demo_Week before the swap.

**Validates: Requirements 10.4, 10.5, 10.6, 10.7**

### Property 13: The demo is deterministic and clock free

_For any_ action sequence, running `reduceDemo` twice from `EMPTY_DEMO` yields deeply equal states, and the result does not change when the system clock is moved.

**Validates: Requirements 7.6, 13.1**

### Property 14: Sample pass fields follow the pass rules

_For any_ reserved session in any reachable Demo_Week, `buildSamplePass` returns fields that validate against `createPassFieldsSchema` for the demo window, a title of at most 80 characters with no ellipsis character that ends with three ASCII dots exactly when the normalised original was longer than 80, "Venue not published" as the display gate and an empty `venue` in the fields for a session with no venue, walk minutes from 0 to 90, a seat-released time 10 minutes before the start, and the fixed label and disclaimer.

**Validates: Requirements 11.2, 11.3, 11.4**

### Property 15: The sample calendar is valid RFC 5545 with the right alarms

_For any_ reachable Demo_Week, the serialised calendar parses with `ical.js`, uses CRLF only, has no content line longer than 75 octets, has one `VEVENT` per commitment whose summary round trips through escaping, gives each reserved session a "Boarding closes" alarm at 10 minutes and a "Leave now" alarm at 10 plus the walking minutes exactly when the walk is known, gives personal time no alarm, and uses the fixed `DTSTAMP` and `.invalid` UIDs.

**Validates: Requirements 12.2, 12.3, 12.4, 12.5**

### Property 16: Contrast maths is correct and every token pair passes

_For any_ two colours, `contrastRatio` is symmetric, lies between 1 and 21, and equals 1 for identical colours; _for any_ gradient and foreground, `worstContrast` is no greater than the contrast at any stop or sample; and every entry in `CONTRAST_PAIRS` reaches 4.5:1 for text and 3:1 for non-text at its worst point, with no token on the AWS brand colour denylist.

**Validates: Requirements 6.6, 19.2, 19.3**

### Property 17: The budget check measures and classifies chunks correctly

_For any_ generated output graph and file sizes, `closure` returns exactly the files reachable through static imports, `demoFiles` equals the demo closure minus the initial closure, and `evaluateBudgets` passes exactly when each compressed total is at or under its limit.

**Validates: Requirements 21.1, 21.2, 21.4**

### Property 18: The build output check finds every CSP-breaking construct

_For any_ generated clean HTML document, `findOutputIssues` reports nothing; _for any_ such document with one injected violation (an inline executable script, an `on*` attribute, a `javascript:` URL, a `<style>` element, a `style` attribute, or a cross-origin resource URL) at a random position, it reports exactly that rule, and text that only looks like a violation inside comments or quoted attribute values of other attributes is not reported.

**Validates: Requirements 3.1, 3.2, 3.5, 3.8**

## Error Handling

### Error taxonomy

| Where   | Condition                                                     | Result shown to the user                                                                                    | Notes                             |
| ------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Board   | No fragment or malformed fragment                             | Invalid_Link: "This link is not complete. Scan the QR code again on your computer."                         | No request sent                   |
| Board   | 404                                                           | Expired: "This link has expired or is not valid. Links last 15 minutes. Create a new one on your computer." | Same text for unknown and expired |
| Board   | 429                                                           | Rate_Limited: "Too many tries. Wait a minute, then try again." plus "Try again"                             | No automatic retry                |
| Board   | Network error, timeout, other status, not JSON, rejected body | Unavailable: "We could not load your passes. Check your connection and try again." plus "Try again"         | Body never displayed              |
| Board   | Clock reaches `expiresAt`                                     | Expired, actions removed                                                                                    | One timer, cleared on destroy     |
| Demo    | Verdict warn                                                  | Reasons plus "Add anyway" and "Keep my week"                                                                | Reasons unchanged                 |
| Demo    | Verdict block                                                 | Reasons, rebooking options, safe swap offer when available                                                  | Week unchanged                    |
| Demo    | Swap pre-check block, or plan unsafe or failed                | "This swap cannot be made safely." plus the reasons                                                         | Week restored                     |
| Demo    | Unknown rule result                                           | The reason the Rules_Engine gives                                                                           | Item stays visible                |
| Demo    | Empty week                                                    | Download button disabled with "Add a session first."                                                        |                                   |
| Install | Clipboard write rejected                                      | Live region: "Copy did not work. Select the command and copy it."                                           |                                   |
| Build   | Output rule broken                                            | Build fails, file and rule named                                                                            | Build_Output_Check                |
| Build   | Budget exceeded                                               | Build fails, measured and allowed sizes named                                                               | Budget_Check                      |

### Handling rules

- **Refuse, never reinterpret.** Malformed fragments and responses are refused whole; nothing is trimmed, decoded or partially rendered.
- **No automatic retries.** The board sends one request per user intent. "Try again" is the only way to send another.
- **No error text from the server.** Problem bodies are never read for display; status alone decides the state.
- **No logging.** Site_Logic and components never call `console`; errors become states, not log lines.
- **Fail the build, not the visitor.** CSP and budget problems stop the build so they never reach production.

## Testing Strategy

### Tooling

- **vitest 4** with v8 coverage at 100% lines, branches, functions and statements over `site/src/lib/**/*.ts` and `site/scripts/**/*.mjs`, with no exclusion, through `site/vitest.config.ts` (and the root `npm test` once the Integrator adds the site project).
- **fast-check** 4.10.2 (root devDependency): each property test runs at least 100 iterations and is tagged `// Feature: showcase-site, Property {n}: {text}`.
- **ical.js** 2.2.1 (root devDependency) parses calendar output in tests.
- **Playwright** 1.64.1 and **@axe-core/playwright** 4.14.0 (root devDependencies) for the on-demand browser suite.
- Tests live in `site/test/`, mirroring `src/lib/` and `scripts/`, named `<module>.test.ts`.

### Property test mapping and tagging

| Property              | Generators (illustrative)                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| 1 fragment            | 16-byte arrays; arbitrary strings; mutations of valid fragments                  |
| 2 invalid no request  | refused fragments and valid ids against the Board_Controller with recording deps |
| 3 request             | valid ids; fetch that resolves, rejects or never settles, with fake timers       |
| 4 validator           | bodies built from the `HandoffView` shape and single-field mutations             |
| 5 outcome mapping     | statuses 100 to 599, bodies, validation results, network and timeout             |
| 6 id secrecy          | ids plus random event sequences, scanning every view model string                |
| 7 local expiry        | hand-offs with random `expiresAt` and clocks around the boundary                 |
| 8 bundle labels       | bundle counts 1 to 8; validated hand-offs                                        |
| 9 time                | instants, offsets from minus 12 to plus 14 hours, IANA zones                     |
| 10 guardrail fidelity | action sequences over the Demo_Catalog with the real port and the double         |
| 11 week consistency   | action sequences including remove and reset                                      |
| 12 safe swap          | start states and double answers for the pre-check and `planSafeSwap`             |
| 13 determinism        | action sequences run twice, with the clock faked to different values             |
| 14 sample pass        | reachable weeks and long titles                                                  |
| 15 calendar           | reachable weeks, unicode titles and long locations                               |
| 16 contrast           | random colours and gradients; the fixed token set                                |
| 17 budgets            | random acyclic import graphs and sizes around the limits                         |
| 18 output check       | generated clean documents plus one injected violation at random positions        |

### Unit and example tests (not properties)

- **Content provenance:** every verbatim Content_Block occurs exactly in its Source_Document file; every block names an allowed source; the Notice equals the `README.md` sentence; the impersonation denylist ("official AWS", "endorsed by AWS", "an AWS product", "AWS approved", "Amazon's", "powered by AWS") appears nowhere in content or templates; no em dash or en dash in any content string.
- **Demo catalog provenance:** every `DEMO_SESSIONS` entry equals the normalised form of the synthetic record with the same id (S1 `normaliseSession` once merged, else the S1-design mapping); every source record validates with `SessionWireSchema`; the scenario coverage of Requirement 7 criterion 3 holds; `GUIDED_CLASH` reaches a block in three actions.
- **Venue data:** `data/venues.json` validates with S2's venue data schema.
- **Links:** null URLs render as "coming soon" text; footer order is fixed.
- **Shell focus helper**, **copy messages**, **README contains `REQUIRED_CSP` exactly**, **`tokens.css` matches `TOKENS`**, **hand-off fixtures validate as expected**.
- **Static server:** path resolution (root, extensionless rewrite, traversal refused, unknown 403), headers, and a real in-process server on port 0.

### Static source checks (vitest, over `site/src`)

- No `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `caches`, `serviceWorker`, `sendBeacon` or `console.`.
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `bypassSecurityTrust`, `eval(` or `new Function`.
- No `styles:`, `styleUrl`, `[style` or `style=` in components and templates; no `NgModule`; no `zone.js` import.
- `@compass/core/` imported only as `@compass/core/rules` and only in `rules-port.ts`; `fetch(` only in `handoff-client.ts`; no absolute `http` URL outside `links.ts` and `handoff-view.ts`.
- No `Date.now` or `new Date(` under `src/lib/demo/`; no `fetch(`, `switch (`, `JSON.parse` or regular expression literal under `src/app/`.

### Browser tests (Playwright, on demand)

| Spec                      | Checks                                                                                                                                                                                          | Profiles |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `pages.spec.ts`           | Each page renders its `<h1>`; navigation moves focus to the heading; title; footer Notice and link order                                                                                        | All 7    |
| `demo.spec.ts`            | Guided clash: block with reasons announced, safe swap in three steps, add the blocked session, sample pass, `.ics` download parsed with `ical.js`                                               | All 7    |
| `board.spec.ts`           | Each fixture state; invalid fragments send no request; fragment stripped after load; focus on the state heading; local expiry with a fake clock                                                 | All 7    |
| `a11y.spec.ts`            | axe with WCAG 2.0, 2.1 and 2.2 A and AA tags on every page and every board and demo state                                                                                                       | All 7    |
| `forced-colors.spec.ts`   | `forcedColors: 'active'`; controls, focus ring and borders visible; axe re-run                                                                                                                  | Chromium |
| `csp.spec.ts`             | Zero `securitypolicyviolation` events under the Required_CSP across all flows                                                                                                                   | All 7    |
| `privacy-network.spec.ts` | Every request is same-origin; the id appears only in hand-off route paths and never in console messages; storage and cookies empty after every flow                                             | All 7    |
| `layout.spec.ts`          | Controls at least 44 by 44; no horizontal scroll at 320 px; short viewport: no positioned element and the focused element never covered while tabbing; board first action in the first viewport | All 7    |
| `performance.spec.ts`     | Chromium LCP proxy under CPU and network throttling, under 2.5 s (Lighthouse mobile once pinned)                                                                                                | Chromium |

### Coverage scope

Site_Logic is covered to 100% by vitest. Angular components (`site/src/app/**`) and Playwright specs are outside the unit coverage scope by design (see Open Questions 3); the static checks keep decisions out of components, and the browser suite exercises every component on the seven profiles.

## Open Questions

Each item records the option this design takes (the one the build plan prefers, or the one that keeps the plan's rules), so the build can proceed.

1. **S2 public surface.** `classifyConnection` takes S2's internal resolved view, and `withContextDefaults` is not in the S2 export list. Chosen: ask S2 (through the Integrator) to export `resolveCommitment` (or a helper that lists a day's connections) and `withContextDefaults` from `@compass/core/rules`. Fallback if refused: the Rules_Port builds the resolved view for demo sessions (all fields present by curation) with an equivalence test, and copies the documented defaults with a test that compares them to `CONTEXT_DEFAULTS`.
2. **Exact CSP string.** S6 owns the response headers policy and has not fixed the value. Chosen: the Required_CSP with `style-src 'self'`, made possible by having no component styles. Fallback, only if the Angular runtime is shown to inject styles: add `'unsafe-inline'` to `style-src` alone, as Angular's static hosting guidance allows, and record it. Trusted Types (`require-trusted-types-for 'script'`) is a possible later hardening, verified by the CSP browser test before adoption.
3. **Component unit coverage.** The workspace pins no DOM test environment. Chosen: 100% vitest coverage of Site_Logic, with components kept decision free and covered by Playwright. If the CTO requires component unit tests, the Integrator must pin `jsdom` and set up the Angular unit-test runner.
4. **Root and CI wiring.** Root `npm test`, `npm run build` and `npm run e2e`, the `site/package.json` scripts and the Playwright browser install in `e2e.yml` are outside `site/**`. Chosen: Integrator requests in `tasks.md`; the stream runs the commands with `npx` meanwhile.
5. **Fragment after reading.** Chosen: strip it from the address bar with `Location.replaceState('/board')`, so the capability does not stay in browser history. Trade-off: a reload shows Invalid_Link and the attendee scans the QR code again (the link lasts 15 minutes anyway).
6. **Builder Center post and video URLs.** They exist only on 31 October and 1 November, after the 29 October site freeze. Chosen: `links.ts` renders "coming soon" text until set; the URLs ship in a one-file `hotfix/1.0.1` change to `links.ts` after submission, through the normal hotfix flow.
7. **Official FAQ link for the 10-minute rule.** No URL is recorded in the Source_Documents. Chosen: cite "the official re:Invent 2026 FAQ" by name; link it once S3's first-timer-guide skill records the official URL.
8. **Kiro one-click install.** Kiro documents no deep-link format, and a listing on kiro.dev/powers is not confirmed. Chosen: show "Add to Kiro" only when `kiroPowerListing` is set; otherwise the documented "Import power from GitHub" steps. Whether the import accepts the repository's `power/` folder follows S3's README.
9. **Other MCP clients.** Chosen: copy setup from `packages/mcp-server/README.md` after S3 merges (27 October); never invent configuration before that.
10. **Wallet button artwork.** Apple and Google publish official badges with usage rules, and Google calls its link "Add to Google Wallet". Chosen: plain-text buttons with the plan's wording ("Add to Apple Wallet", "Save to Google Wallet") and no third-party artwork, so the Site carries no trademark artwork at all.
11. **Hand-off path format.** The contract types `bundlePaths` and `calendarPath` as strings. Chosen: require root-relative paths that match the route templates for the same id; S5 to confirm, and `boardUrl` to be `https://<distribution>.cloudfront.net/board#h=<id>`.
12. **Demo scenario coverage.** The demo needs a clash pair whose held side has a non-clashing `-R` repeat. Chosen: curate from the committed synthetic catalog; if the pattern is missing, request an S0 catalog change rather than invent a session.
13. **Lighthouse.** Not pinned in the workspace. Chosen: the Integrator adds `lighthouse` with an exact pin for the LCP budget; until then a Chromium LCP proxy runs in Playwright.
14. **Hydration.** Chosen: `provideClientHydration(withNoIncrementalHydration())` with no event replay. If the build still emits an inline script, or hydration misbehaves without Zone.js, drop hydration (the prerendered HTML still gives the LCP) and record it.
15. **Unknown routes.** S6 configures no custom error responses, so a mistyped path shows S3's 403. Chosen: no 404 page in v1.
16. **Privacy contact.** The plan names the responsible party but no contact channel. Chosen: link to the repository; the owner may add a contact before the freeze.
17. **Colour scheme.** Chosen: one light theme plus forced-colors support; no dark theme in v1.

## Implementation deviations and decisions

Recorded by the implementer (showcase-site stream). Each item is a change from, or a clarification of, the design above.

1. **Stats file name.** The Angular 22.2.3 application builder writes `browser-stats.json` (and `server-stats.json`), not `stats.json`. The Budget_Check reads `browser-stats.json`. The static build also writes `index.csr.html` next to `index.html`; the Build_Output_Check scans it for the inline script, handler and style rules, but it has no prerendered body, so the one `<h1>`, Notice and `noindex` rules do not apply to it.
2. **Site ESLint configuration.** The root `eslint.config.js` lints every `site/**/*.html` file with the type-aware rules and so fails on the Angular template parser. `site/eslint.config.mjs` (ESLint 10 looks configuration up from each file's folder) restates the root rules for the site with the type-aware rules switched off for `.html`. It takes the typescript-eslint configs from `@typescript-eslint/eslint-plugin` directly, because reading them through the `typescript-eslint` helper records a second project root and breaks the untyped root files. An Integrator request asks for the override in the root file, after which the site file can be deleted.
3. **Coverage scope (CTO M10, Integrator decision).** `site/src/app/**` is an explicit, named coverage exclusion: the vitest coverage scope is `src/lib/**/*.ts` and `scripts/**/*.mjs` only. An ADR is recorded at merge. The static "no decisions in components" checks stay and are the guard that makes the exclusion safe.
4. **Vitest root (CTO L7).** `site/vitest.config.ts` sets `root` to the site folder, so `npx vitest run --config site/vitest.config.ts` works from the repository root. The vitest 4 coverage option `all` no longer exists; the `include` list alone decides which files count.
5. **Class and file names.** Page components are named `HomePage`, `DemoPage`, `InstallPage`, `PrivacyPage` and `BoardPage` in `<name>-page.component.ts`; the root component is `AppComponent` in `src/app/shell/`.
6. **Content sources (Component 3).** `SourceDocument` also allows `.kiro/steering/tech.md` (Node.js 24), `KIRO-SPEC-PROMPTS.md` (the `npx reinvent-compass demo` line, which the build plan does not spell out) and `.kiro/specs/showcase-site/requirements.md` (statements about how this site itself behaves). The Kiro page is named `kiro.dev/docs/powers/installation` without a scheme, so the only absolute URLs in `src` stay in `links.ts` and `handoff-view.ts`. Every block has a required `section`; the helpers `quoted` (verbatim) and `summary` build blocks.
7. **Time helpers.** `dayHeading` takes only the event local date, because a calendar date needs no zone. `formatWallClock` returns the fixed text "Time not available" and `offsetLabel` returns "offset not available" for a value that is not an ISO 8601 date-time with an offset, so a bad value never shows an invented time.
8. **Kiro import options (CTO M11).** The Install_Page shows both "Import power from GitHub" options, the repository address and the `power/` folder of the repository, until the day-1 spike SP1 records which one works. The two options are one data entry (`kiroImportOptions` in `content/install.ts`).
9. **Google save link note (CTO L6).** The research notes no longer repeat a claim about a JWT length limit, which was not checked against the page it cited. The site does not use that figure.
10. **Build checks (Components 17 and 18).** The tag scanner of the Build_Output_Check is built from sticky regular expressions (comment, declaration, tag with quote-aware attributes), with raw text elements jumped over; a tag whose quote never closes is read as text. `runCli` takes `listFiles` and `readFile`, and `runDefault(distDir)` binds them to the real folder, so the whole wiring is covered in process. The Budget_Check reads the metafile from `dist/site/browser-stats.json` (one folder above the browser output) through a `statsPath` argument. "Initial JavaScript" is the static import closure of the module scripts and modulepreload links of the prerendered `index.html`, so it includes the Home_Page route chunk. The board page sets `<meta name="robots" content="noindex">` in its component constructor (through Angular `Meta`), so it is part of the prerendered head from task 5 on.
11. **Board logic details (Components 10 to 13b).** `ResponseLike` has only `status` and `text()`; the client reads the body of a 200 response only, never an error body. `src/lib/time/iso.ts` adds a strict ISO 8601 parser (`parseIsoWithOffset`): `Date.parse` accepts 30 February and the hour 24, so the validator uses the strict one, and the validated hand-off carries `expiresAtMs`. A Google save link is accepted only when it starts with the literal `https://pay.google.com/gp/v/save/` and the rest is a token of letters, digits, dots, hyphens and underscores (a JWT), so userinfo, a port, a query, a different host and any other spelling of the host are all refused. The `retry` event is gone from the state machine: the controller checks `canRetry` and then sends `requestStarted`. A wait for expiry longer than the browser timer limit is done in steps. The Board_Controller (Component 13b) is the CTO H4 change; Requirement 22 criterion 7 and Property 2 were updated with it.
12. **Bundle labels (CTO L8).** Apple bundles are labelled "bundle N of M" (design Component 13, Property 8, Requirement 18 criterion 2) because the contract does not say how passes are split across bundles.
13. **No-JavaScript notice on /board (Requirement 18 criterion 10).** A `<noscript>` element with child elements breaks hydration: a browser that runs scripts parses its children as text, so the client DOM would not match the server HTML. The notice is therefore a plain paragraph in the prerendered Reading state, shown while `scriptRuns` is false; the component sets it true in `afterNextRender`, which removes the paragraph. A visitor without JavaScript keeps it. The hand-off fixtures are JSON files with `status`, `contentType` and either `body` or `rawBody`; their sessions are real records of the synthetic catalog.
14. **Rules port and demo seams (Components 5 to 7, CTO M8, integrator note on venues).** S2 now exports `connectionsForDay(schedule, context, day?)`, `energyForDay`, `resolveCommitment` and `withContextDefaults`, so the port calls `connectionsForDay` and rebuilds no resolution (Open Question 1 is settled; its fallback is not used). `checkLayovers` takes `(schedule, context, onlyDay?)` and reports per day (`days: DayLayover[]`), and `findClashes` reports pairs with `aIndex` and `bIndex`. The result types in `rules-port.ts` are written out from the committed S2 design because the engine is still an empty module on this branch; `isRulesEngineReady` is true only when all eight functions exist, and `createDemoRuntime(engine, venueData)` (in `demo-deps.ts`) returns null otherwise, in which case the Demo_Page says that the demo cannot run. `DemoDeps` lives in `demo-deps.ts`, not in `demo-state.ts`. `data/venues.json` is not on this branch either, so `venue-data.ts` holds a null seam with the two-line change for the Integrator in its header. The unit tests run the demo against `test/doubles/rules-double.ts`, which follows the S2 shapes with simple answers and lives in `test/` only.
15. **Demo catalog (Component 6, integrator notes on venues and repeats).** The 15 sessions are copied from the final synthetic catalog (10fea0c and 546aff6, where every -R session is a true repeat of its base session and codes are unique): 2026-12-01 syn-068 (SEC431), syn-120 (keynote, not reservable), syn-003 (AIM321), syn-046 (overlaps syn-003), syn-024 (BWP213), syn-076 (ARC228, overlaps syn-024), syn-002 (DAT204); and 2026-12-04 syn-063, syn-087 (breakout, not reservable), syn-008 (no venue), syn-025 (BWP213-R), syn-047, syn-026, syn-028 (NET217), syn-069 (SEC431-R2). Sessions at Mandalay Bay, which is not one of the six official 2026 venues, are not used, and a test checks every venue against the six official names (and against `data/venues.json` when that file is present). The Starter_Week is syn-024 (BWP213, Tuesday) and syn-028 (NET217, Friday): a clean week with no impossible connection and no layover problem, as the integrator ruled. A missing meal layover cannot be had with comfortable connections from this catalog: sessions start on a 30 minute grid and last 60, 90 or 120 minutes, so a comfortable gap is at least 30 minutes and the meal window (11:30 to 14:00, 30 free minutes needed) then always keeps its 30 free minutes. The scenario is therefore kept as data (syn-003 beside syn-024 fills the window) and is checked in the real-engine test, which adds syn-003 next to the Starter_Week and asserts that the engine reports the missing meal and suggests a block. The Add this layover button is covered by unit tests with the test double engine and is not reached in the browser by the guided path. Unit tests that need impossible connections or a layover use a four session test week (`richWeek` in `test/support/demo-harness.ts`: syn-003, syn-024, syn-002, syn-028). `GUIDED_CLASH` is `tryAdd` syn-076 (ARC228, The Venetian, Tuesday 13:00), `clashesWith` syn-024 (BWP213, MGM Grand, Tuesday 13:00) and `heldRepeat` syn-025 (BWP213-R, The Venetian, Friday 11:30). Both BWP213 sessions have seats and the same title, and the real-engine test runs the whole guided story (blocked, offered, reserve, confirm, cancel, add) with the real engine. No walking minute is hard coded: connection results come from the engine and the venue file. The provenance test compares every entry with S1 `normaliseSession` (the test-local normaliser was removed).
16. **Demo reducer details (Component 7).** `toScheduleInput`, `commitmentOfSession`, `commitmentRef` and `sortCommitments` live in `lib/demo/schedule.ts` (shared by the reducer and the views). While a swap is in progress (`offered`, `repeatReserved` or `confirmed`) the reducer holds `add`, `bookRepeat`, `confirmWarn`, `remove`, `loadStarter`, `startSwap` and `addLayover` with the announcement "Finish or cancel the swap first."; "Keep my week" (`dismiss`) cancels the swap and takes a reserved repeat back out; `reset` always wins. A finished swap (`done` or `stopped`) is cleared by the next action. `remove` and `addLayover` also clear a pending warning or block, because it described the old week. "Add anyway" adds the session directly and does not ask the engine a second time. The swap offer comes from `findClashes` on the week plus the candidate: the clash partner is the held reserved session the candidate overlaps, and the offered repeat is the first catalog session whose `repeatOf` is the partner's code and that is not already held. `loadStarter` puts the Starter_Week in without a verdict, which is the one way a session is held with no guardrail answer; its announcement names the session to try. The Property 10 test skips that action for this reason.
17. **Sample pass and calendar (Components 8 and 9, CTO M9 and L10).** The pass follows S4: `normalisePassText` (`lib/demo/pass-text.ts`, a written-out copy of the one in `@compass/contracts`: importing the package at run time put its zod schemas into the Demo_Page chunk and took it from 11 kB to 109 kB gzip; a property test proves the copy gives the same text as the original), a title of more than 80 characters becomes its first 77 characters plus three ASCII dots, walk minutes are clamped to 0 to 90, and `passFields.venue` and `passFields.room` are empty strings when the session has none ("Venue not published" is display text only). The previous and next commitment and their walks come from `lib/demo/neighbours.ts`, which asks the port's `connectionsForDay` once for the day. The walk is the engine's `walkingMinutes`, which is the walk plus its buffer; the pass says "N min walk", the calendar description says "walk plus buffer", the "Leave now" alarm is set at `10 + walkingMinutes` minutes before the start, and the Demo_Page states this in one line (L10). `toUtcStamp` lives in `lib/time/iso.ts` (the demo folder may not call `new Date`). A session that cannot be reserved but was added to the week shows the engine's reason (for example "needs no reservation") where the seat release time would be.
18. **Demo page (Component 13).** Only the sample pass is a separate component (`SamplePassComponent`); the verdict panel, swap panel, week list, calendar download and catalog list share one template, and every panel is built by `lib/demo/demo-view.ts` (verdict and swap views, page text, guided hint) and `lib/demo/pass-layout.ts` (the SVG lines), which are unit tested. After a tap the page scrolls the verdict and swap panels into view without moving focus, and the polite live region announces the result. While the engine or the venue file is missing the page shows "The demo cannot run in this build." and the prerendered `demo/index.html` holds that message instead of the session list; once the Integrator wires S2 (tasks.md Notes 16) the same build prerenders the list. Measured at this commit: initial JavaScript 93132 bytes gzip, Demo_Page chunk 11333 bytes gzip, before the S2 engine is added.
19. **S2 wired in (integrator note after S2 merged, 8e1277b).** `rules-port.ts` imports the eight engine functions by name (so the bundler keeps only those) and re-exports the engine's own `Context`, `ContextInput`, `ScheduleInput` and result types; the engine's `SwapPlan.outcome` also has "unknown", which the reducer treats like unsafe. `venue-data.ts` imports `data/venues.json` as it is (researched walking estimates and aliases), so no walking minute is written in the site. The site `tsconfig.json` no longer sets `noPropertyAccessFromIndexSignature`, because it type checks the engine source through the `@compass/source` condition and that source does not follow the flag. The fake engine stays for edge cases and `site/test/demo/real-engine.test.ts` runs the guided path, the connection and calendar numbers and two properties on the real engine and the real venue file. The prerendered `demo/index.html` now holds the session list. The Open Question 1 fallback is not used.
20. **Required_CSP and the Static_Server (Component 19, CTO L9).** (a) `base-uri` is `'self'`, not `'none'`: the built pages carry `<base href="/">` so that the router and the relative asset links work at `/demo` and at `/demo/`, and `base-uri 'none'` blocks that element. The requirements Glossary was changed to match and S6 is asked (Integrator request) to send this value. (b) The Static_Server answers over plain http, and WebKit (every iPad and iPhone profile) honours `upgrade-insecure-requests` there and rewrites the page's own requests to https, which fails with "SSL connect error". For local runs only the Static_Server therefore sends the Required_CSP without that one directive (`LOCAL_CSP` in `scripts/required-csp.mjs`); CloudFront sends the full policy. (c) zod, which the engine and `@compass/contracts` use, builds its schemas when their modules load and by default probes `new Function("")`, which a strict CSP reports as a `script-src eval` violation. `lib/demo/zod-jitless.ts` sets zod's `jitless` option and is the first import of `rules-port.ts`, so it runs before the engine; it imports `zod/v4/core`, so the Integrator should declare `zod` (already pinned at 4.6.7 in the workspace) in `site/package.json`. (d) The Static_Server answers 403 for an unknown path and for any method but GET, binds to 127.0.0.1 and takes the port from the first argument (default 4173).
21. **Browser suite (Component 20).** The profiles are `desktop-chromium`, `desktop-firefox`, `desktop-webkit`, `ipad-portrait`, `ipad-landscape`, `iphone-portrait` and `iphone-landscape` (descriptors Desktop Chrome, Desktop Firefox, Desktop Safari, iPad (gen 7), iPad (gen 7) landscape, iPhone 14, iPhone 14 landscape). WebKit does not Tab to links by default, so the keyboard checks focus each control with `focus()` and the skip link test finds the first focusable element in the DOM. The board page strips its own fragment, so every second visit in one test goes through `about:blank` first (`openBoard`); a plain second `goto` would be a navigation within the document. Browsers log "Failed to load resource" for the 404, 429 and 500 answers of the mocked route; the console assertions ignore those lines, because the site itself writes nothing to the console. The LCP check is the Chromium proxy under CPU and network throttling. Firefox is not installed on the build machine and could not be downloaded, so that profile was not run.
22. **Date independent browser suite (QA H1).** The hand-off fixtures keep a fixed `expiresAt` for the vitest checks, but `mockHandoff` rewrites `expiresAt` of every ready body to 15 minutes after the page clock (`installClock` sets the page clock and remembers it; with no clock installed it is 15 minutes after now). No browser test depends on the real date, and a test runs the Ready state with the page clock in 2026 and in 2031.
23. **Hand-off validation hardening (QA M2, M3, L2, security L-1).** `ResponseLike` gains `headers`; the client parses a 200 only when the content type is `application/json` (any other type is `notJson`, and the body is not read). The validator refuses a hand-off with no action, a Google token that is not JWT shaped or is over 4096 characters, a title outside 1 to 80 characters and a session code outside 1 to 20 (Requirement 17 criteria 8 to 10). Fixtures `no-action` and `wrong-content-type` cover the new refusals.
24. **Expiry on arrival and on waking (QA M4, L9).** The `outcome` event carries the device clock (`nowMs`), and a validated hand-off whose `expiresAtMs` has passed settles as Expired, never Ready. The controller takes `subscribeVisible` and `onRefresh`: it re-checks the expiry on every visibilitychange to visible and every pageshow (`lib/board/visibility.ts`, wired to `document` and `window` by the component), and the remaining-time text is capped at 15 minutes. Requirement 18 criteria 11 and 12.
25. **Fragment taken early (QA L8, security L-3).** An app initializer (`provideAppInitializer` in `app.config.ts`, browser only) runs `takeBoardFragment` before the router's first navigation: on `/board` it reads the raw fragment from `location.href` (`rawFragment`, never decoded, so `%41` reaches the parser and is refused) and calls `history.replaceState(null, '', '/board')`. The fragment waits in a one-shot holder (`FRAGMENT_HOLDER`) that the board page empties once, so a Back to `/board` shows Invalid_Link instead of reusing an old id. The controller still replaces the address before its request. Requirement 16 criterion 8; e2e tests prove that no history call ever carries a `#` and that Back and Forward never restore it.
26. **Focus after a demo action (QA M1, L6, L7).** `lib/demo/demo-focus.ts` names the element to focus (verdict-title, swap-title, swap-next, swap-add, demo-week, remove-<key>) when an action removes the focused control; the page focuses it after the next render, and otherwise only scrolls the panels into view. The Add button of a session in the week uses `aria-disabled` so it keeps focus. Week items carry a `label` (the code, or the title with the start time, such as "Layover at 12:00 PM") that names the Remove buttons, and the layover suggestion buttons name their time. The calendar download appends the anchor to the page, clicks it, removes it, and revokes the object URL a tick later. Requirement 19 criteria 9 and 9a.
27. **Pass title and impossible walks (QA L1, L4).** `fitTitle` keeps exactly the first 77 characters of the normalised title plus three dots, even when the 77th character is a space (S4 and Requirement 11.2). `lib/demo/neighbours.ts` also returns the engine class of each walk (`walkClass`); the sample calendar sets no "Leave now" alarm when that class is impossible and says so in the event description (Requirement 12 criterion 3). Property 15 checks both.
28. **Build output check hardening (QA L3).** The Build_Output_Check reads URL attributes as a browser does (character references decoded, tabs and line breaks removed, leading control characters dropped) before it looks for `javascript:`, and it also refuses a meta refresh, a base element whose href is not "/", object and embed elements, any iframe, and an svg use element that points outside the page. Property 18 includes these violations, and the clean documents carry `<base href="/">` as the built pages do.
