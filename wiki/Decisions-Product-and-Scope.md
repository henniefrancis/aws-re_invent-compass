_For architects: the decisions that set what Compass does, for whom, by when and on which devices, with the reasons and what they cost._

Each section is one decision with four parts: the context, the decision, why, and the trade-off. Where a later decision or the code changed it, the section says so. The [Key decisions](Key-Decisions) page lists every decision on every theme.

## Submit before the hackathon deadline

**Context:** The re:Invent Catalog API Builder Challenge closes on 6 November 2026 at 11:59 PM Pacific time. On 15 October 2026 the specs, the reviews, the release gate, the README, the Builder Center article, the demo video and the showcase site were all still to do.

**Decision:** Submit on an earlier target date of the owner's own, and keep the days before the hard deadline as a buffer. The first target was 1 November 2026.

**Why:** A buffer absorbs a slip without risking the entry. The plan had to say what would be cut or merged if the schedule slipped.

**Trade-off:** About 17 days from kickoff to the first target. That forced parallel streams and an [early contract lock](Decisions-Delivery-and-Tooling#early-contract-lock).

**Later:** On 31 October 2026 the owner moved the target to 4 November 2026, because the npm package was due to publish on 3 November, which it did. The 6 November deadline is unchanged.

## Scope answers from the first architecture interview

**Context:** On 15 October 2026 a solutions-architect pass over the concept raised ten open questions that had to be closed before a build plan could be written.

**Decision:** The owner answered all ten the same day:

- Plan on a computer, board on any device (see [the next section](#plan-on-a-computer-and-board-on-any-device)).
- Several builders work on different specs at the same time, so the plan runs parallel streams.
- A showcase site with the story, a click-through demo on made-up sessions, install steps and a "what leaves your machine" page. No sign-in, no cookies, no analytics.
- An [attendee-only pass API](Decisions-Architecture#an-attendee-only-pass-api) that checks the attendee's [AWS Builder ID](Glossary#aws-builder-id) ID token.
- A [cloud hand-off](Decisions-Architecture#cloud-hand-off-to-the-phone) to get passes to the phone, accepting short-lived pass content on the server.
- Real, live data in the product, and [made-up sessions](#made-up-sessions-for-tests-and-the-public-demo) in tests and the public demo.
- The [toolchain](Decisions-Delivery-and-Tooling#toolchain), [Terraform in a personal HCP Terraform organisation](Decisions-Infrastructure#terraform-state-and-runs-in-hcp-terraform) and the [branching model](Decisions-Delivery-and-Tooling#branching-model).
- Apple's pass update web service is in scope: a cancelled reservation's pass must go away, and every pass must expire (see [Update, void and expire every pass](Decisions-Passes-and-Wallets#update-void-and-expire-every-pass)).

**Why:** Closing every open question on day one let the parallel streams start from one fixed plan.

**Trade-off:** The cloud hand-off overrode the kickoff answer that nothing is stored on a server, and the Apple update service means storing device registrations. Both are personal data, handled in [Personal data on the server](Decisions-Security-and-Privacy#personal-data-on-the-server).

**Later:** The answer to submit as version 1.0.0 did not hold. The first release is 0.1.0: the git tag is `v0.1.0` and the npm package `reinvent-compass` was published as 0.1.0 on 3 November 2026. Two fix releases followed on 4 November and a third on 5 November, and [packages/mcp-server/package.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/package.json) is now at 0.1.3.

## Plan on a computer and board on any device

**Context:** Planning needs the [attendee](Glossary#attendee)'s code and an [MCP client](Glossary#mcp-client), which only a computer has. During the week the attendee lives on a phone.

**Decision:**

- **Plan on a computer.** The [Kiro Power](Glossary#kiro-power) and the local [MCP server](Glossary#mcp-server) run on the attendee's computer, in Kiro, Claude Desktop, VS Code or the Kiro CLI.
- **Board on any device.** Phones and tablets get Apple or Google Wallet [boarding passes](Glossary#boarding-pass) through a QR [hand-off](Glossary#hand-off), and an `.ics` calendar file.
- The showcase site and its demo work on any device with no install.
- The site's browser tests run on seven device profiles: desktop Chromium, Firefox and WebKit, and iPad and iPhone in portrait and landscape ([site/e2e/support/profiles.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/e2e/support/profiles.ts)).

**Why:** Each job runs where it naturally happens, and there is no hosted web app that has to sign attendees in.

**Trade-off:** The Power must work on Windows, macOS and Linux. On Linux with no Secret Service keychain, the token store keeps tokens in process memory only, so the attendee signs in again after a restart. The local product still works with no [Compass API](Glossary#compass-api) at all: the calendar file needs no server.

**Later:** An offline itinerary page (`itinerary.html`) was also planned for phones and tablets. Its writer is in `@compass/core`, but no tool in 0.1.3 writes it, so the calendar file is the offline view.

## Made-up sessions for tests and the public demo

**Context:** The product uses real, live data. It was not known whether a real catalog snapshot may be published, and CI must never call the live [Events API](Glossary#events-api).

**Decision:**

- A generator and a 120-session [synthetic catalog](Glossary#synthetic-catalog) in the real data shape, in [fixtures/synthetic](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/fixtures/synthetic), checked against the same zod schemas as live data.
- The synthetic catalog feeds the unit tests, [simulated mode](Glossary#simulated-mode) (`COMPASS_MODE=simulated`) and the site demo. Both test configurations set simulated mode, so no test can reach a live transport.
- Real recordings stay private, in a git-ignored folder. Live smoke tests run only behind `COMPASS_LIVE_TESTS=1`, by the owner, on his own machine.

**Why:** Judges and people who are not attending can try the whole flow with no account, and nothing private is published.

**Trade-off:** Made-up data can drift from the real shape. The day-one real-data spike compared a private recording with the contracts and the synthetic catalog, so differences could be fixed in the contracts early. This stays until AWS confirms a real snapshot may be published.

## Walk from here on the board page

**Context:** At re:Invent the [venues](Glossary#venue) are far apart. The venue file, [data/venues.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/data/venues.json), holds walking times between the six venues from OpenStreetMap foot routing. An attendee in a hotel lobby wants a different answer: how long from where I am to my next session, and when must I leave. Location is personal data, and the first rule is that it stays on the phone.

**Decision:**

- Only the next session (the first that has not started, by the event's own time) gets a "Walk from here" button.
- The browser asks for the location only when the attendee taps, once, with a rough fix and no cached fix older than 30 seconds. Nothing is asked when the page loads. If the prompt is never answered, the page gives up after 20 seconds ([site/src/lib/board/locate.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/board/locate.ts)).
- The estimate is worked out on the phone ([site/src/lib/board/walk-estimate.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/src/lib/board/walk-estimate.ts)): straight-line distance times a detour factor of 1.6, at 66.7 metres a minute, rounded up. "Leave by" is the session start minus the walk minus 15 minutes to get into the venue and to the room. When that time has passed, the page says "Leave now."
- The page shows "About N min walk.", the leave-by time, "This is an estimate." and the time it was worked out. A Directions link opens Apple Maps on an iPhone and Google Maps elsewhere, naming only the venue's point.
- No estimate when location is denied, unavailable or timed out, when the session has no venue or the venue has no map point, or when the phone is more than 20 km away.
- The edge sends `Permissions-Policy: geolocation=(self)`. One value in [site/scripts/required-permissions-policy.mjs](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/site/scripts/required-permissions-policy.mjs) is the source, and an infra static test checks that the CloudFront value equals it.
- The Venetian uses the Venetian Expo point, where its sessions are held, so the phone and the venue file agree.

**Why:** The board page already holds the attendee's sessions and opens on their phone. Working it out on the phone means the location never reaches a Compass server, so there is nothing to keep, secure or delete.

**Trade-off:** The estimate is rough on purpose: it does not know the pedestrian bridges, closed doors or crowds, and one detour factor covers the whole Strip. It has not been compared with real walks. The Caesars Forum point lies on its loading-dock side, so directions may end there.

## Related pages

- [Key decisions](Key-Decisions)
- [User guide: Board](User-Guide-Board)
- [Showcase site](Showcase-Site)
- [Privacy](Privacy)
- [Decisions: Passes and wallets](Decisions-Passes-and-Wallets)
