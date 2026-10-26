# Proposed wording for the owner's drafts

Proposals for the owner's drafts, `README.md` and `docs/article/builder-center-draft.md`. These drafts are the owner's, so nothing here has been applied. Each item names the current text and gives replacement text to paste. Line numbers are from the drafts as of 26 October 2026 (develop at `dcf0f1f`).

Facts the wording rests on (each from the code, the specs or the runbooks on develop):

- **Tagline.** "From your code to your seat, on time." (`.kiro/steering/product.md`, `CONCEPT.md`, the site). It replaced "Plan like a spec. Board like a flight." on 20 October (showcase-site Requirement 1, task 24). The owner's story keeps "Plan like a spec, board like a flight" as a section title (`docs/story/creator-and-inspiration.md`).
- **The contest.** Its name is the "re:Invent Catalog API Builder Challenge". It opened on 24 September 2026 and the hard deadline is 6 November 2026 (`docs/hackathon-rules.md`).
- **24 tools.** `mcpTools` in `packages/contracts/src/mcp-tools.ts` has 24 keys, `createCompassServer` registers every one, `TOOL_SPECS` in `packages/mcp-server/src/server/tool-registry.ts` has the same 24, and the "## The tools" table in `packages/mcp-server/README.md` has 24 rows. `issue_boarding_passes` is gone: `issue_all_boarding_passes` and `issue_boarding_pass` replaced it (compass-power task 51).
- **Read-only by default.** In live mode Compass never changes the re:Invent schedule unless `COMPASS_ALLOW_WRITES=1` is set in the environment of the Compass MCP server. Every Events API write is refused before any request. The five schedule tools still run the guardrail and reply with what they would have done, that nothing changed, and that the change can be made in the re:Invent app. With writes on in live mode, the schedule tools, `show_schedule` and `sign_in` start their reply with "Writes are on: Compass can change your real re:Invent schedule after you approve each change." Simulated mode never calls the Events API, so it needs no setting. Passes still work, because they live on the Compass pass service.
- **Your tech and your GitHub.** `scan_repo` reads a folder, or a dev folder of git repositories (up to 50), for AWS services and other technology (.NET, Node.js, Python, React, Docker and more). `connect_github` connects the read-only Compass GitHub App (Contents: read and Metadata: read only); `scan_github` reads nothing until you confirm the list; `disconnect_github` deletes the GitHub sign-in on this machine. `show_my_tech` and `find_sessions_by_tech` read the tech list on your machine. The tech list is never sent anywhere.
- **The pass.** The Apple pass follows the owner's Pass Designer design: SESSION (the session code), FLIGHT NAME (the title, the primary field), TERMINAL (the venue), GATE (the room), DATE (day and times) and BOARDING CLOSES. The back holds ABOUT, UNOFFICIAL PASS, the seat rule, then ROOM, WALK FROM PREVIOUS, NEXT SESSION and NAME when known, then TIMES, IF YOUR PLANS CHANGE and PRIVACY (`packages/pass-service/src/apple/pass-template.ts`). The Google pass has the same front rows (TERMINAL and GATE; DATE and BOARDING CLOSES) and the same texts, with no NAME (pass-service task 47). Nothing on the pass says "Seat released at".
- **What the pass says about being unofficial.** Its UNOFFICIAL PASS text reads "This is not a ticket. Your re:Invent badge is your official ticket. Bring it to every session." The short line "Unofficial. Your badge is your ticket." is in the calendar file, on the QR page and on the site, not on the pass itself (`packages/pass-service/src/apple/pass-texts.ts`). The Apple pass labels are orange on black; their closeness to the AWS colours is an accepted deviation (pass-service design, "Pass Designer event ticket").
- **Google Wallet publishing access** was approved on 21 October 2026, so any Android user can save a pass and the "[TEST ONLY]" mark is gone (`docs/runbooks/google-wallet-setup.md`). The owner approved the Google pass on Android on 25 October and checked the Apple pass on an iPhone (pass-service tasks 44.3 and 47.5). The board page button is now "Add to Google Wallet" (`site/src/lib/board/board-state.ts`).
- **Link or QR code.** `send_to_phone` takes `show`: `link`, `qr` (a branded page with the QR code opens in your browser) or `both`. Without it, it asks "Link or QR code?" and creates nothing. The link works for 15 minutes. The board page offers Apple Wallet bundles of up to 10 passes each.
- **Version and address.** The code is at version 0.1.0 and every command is `npx --yes reinvent-compass@0.1.0`. The built-in Compass API address is `https://reinvent-compass.vegas` (ADR-031). Nothing is published yet: the owner deploys prod first, then tags `v0.1.0`, and the publish waits for the owner's approval (`docs/runbooks/npm-release.md`). Prod is not deployed yet (`docs/runbooks/first-deploy-notes.md`).
- **Hooks.** Only the PreToolUse hooks ship: one runs the guardrail on Compass booking calls, the other blocks writes through the remote `awsevents` server. The PostToolUse sync hook was removed (ADR-024). Kiro does not honour `disabledTools` inside a Power, which is why the Power does not bundle the official server (ADR-024).
- **Kiro setup.** Kiro starts no MCP server until "Kiro Agent: Configure MCP" is set to Enabled in Settings (`packages/mcp-server/README.md`).
- **Runbooks.** `docs/runbooks` has ten files: alarms, first-deploy-notes, google-class, google-wallet-setup, kill-switch, npm-release, release, rollback, secrets and teardown.
- **The site.** Routes in `site/src/app/app.routes.ts`: Home, Demo, Install, Privacy, The Creator (`/about`), The Inspiration, Documentation, Disclaimer, Copyright and licence, Terms of use, Security, Accessibility, Open-source credits, and Board. The Legal menu in `site/src/lib/content/links.ts` lists Terms of use, Privacy, Disclaimer, Copyright and licence, Security, Accessibility and Open-source credits; the About menu lists The Inspiration and The Creator; the Project menu lists Documentation.

## README.md

**Line 3** (tagline). Replace "**Plan like a spec. Board like a flight.**" with:

> **From your code to your seat, on time.**

**Line 5** (summary). "book it safely" matches `.kiro/steering/product.md`, but with read-only by default the first claim is more exact as:

> re:Invent Compass helps a first-time AWS re:Invent attendee plan their week from their own code, check every booking against the walks and clashes before it happens, and get into every reserved session on time.

**Line 7.** Replace "checks every booking before it is sent" so the sentence covers read-only and the tech scan:

> It ships as a Kiro Power plus a local MCP server that any desktop MCP client can run. It reads your code (and, if you allow it, your GitHub repositories) to learn your tech, writes your week as a Kiro spec, reads your real re:Invent schedule without changing it unless you turn writes on, checks every booking against the guardrail, and issues unofficial Apple Wallet and Google Wallet boarding passes that void when a session is cancelled and expire when it ends.

**Line 9.** The contest name and dates. Replace with:

> Built for the re:Invent Catalog API Builder Challenge (September to November 2026).

**Line 11** (status). Replace with:

> **Status: built, version 0.1.0, not yet released.** The code, tests and infrastructure are in this repository, and the code is set to version 0.1.0. These parts are **coming soon**: the production site and Compass API at `https://reinvent-compass.vegas`, the npm package `reinvent-compass` (published after the production deploy), the Kiro Power listing, the Builder Center article and the demo video. Links will be added here when they are live.

**Line 18** (contents). Replace with the new count and add the new section from the item under line 136:

> - [The 24 tools](#the-24-tools)
> - [Your tech list and GitHub](#your-tech-list-and-github)

**Line 33.** Align the number with the pass: replace `It is **"Seat released at 10:20"**` with:

> It is **"Boarding closes 10:20"**, plus the walk from wherever you are.

**Lines 46 and 47** (airline table). The venue is the terminal and the room is the gate, and the main field of the pass is now the title (FLIGHT NAME). Replace both rows with:

> | Terminal and gate | Venue and room | TERMINAL and GATE on the front of every pass |
> | Boarding closes | Start minus 10 minutes | BOARDING CLOSES on the front of every pass |

**Line 56** (Plan). Replace "Compass scans your own repository to see which AWS services you use and how deeply" with:

> 1. **Plan** (on your computer, in Kiro or another MCP client). Compass scans your own code (a project, a dev folder of git repositories, or, after you confirm the list, your GitHub repositories through a read-only GitHub App) to see which AWS services you use and how deeply, and which other technology you use, such as .NET, Node.js or Python. It suggests sessions with a reason for each and writes the week to `.kiro/specs/my-reinvent-week/` as `requirements.md`, `design.md` and `tasks.md`. Each task is one action you approve.

**Line 57** (Board). Replace with:

> 2. **Board** (on your phone). A short-lived link or QR code moves your passes to your phone. Each pass shows the session code, the title as the flight name, the venue as the terminal, the room as the gate, the date and times, and **Boarding closes**. The back shows the full room, the walk from the previous session and the next connection.

**Line 62.** Node.js 24 or newer is right (`engines` in `packages/mcp-server/package.json`). The Requirements section under "Hackathon rules row 3" below can replace this line.

**Line 67.** Replace `npx --yes reinvent-compass@<version> demo` with:

> `npx --yes reinvent-compass@0.1.0 demo`

**Line 70.** Replace the note with:

> > **Coming soon:** this works once `reinvent-compass` 0.1.0 is published to npm, which happens after the production deploy.

**Line 89.** Replace "(address **coming soon**)" with:

> The showcase site will also run a click-through demo on any phone, with no install and no sign-in, at `https://reinvent-compass.vegas` (**coming soon**).

**Lines 93 to 97** (Install the Kiro Power). Add the Kiro setting first. Replace step 1 with these two steps (renumber the rest):

> 1. In Kiro, open Settings and set "Kiro Agent: Configure MCP" to Enabled. Kiro starts no MCP server until you do.
> 2. Open the Powers panel and choose **Add Custom Power**.

**Line 103.** Replace `npx --yes reinvent-compass@<version>` with `npx --yes reinvent-compass@0.1.0`.

**Line 112.** Replace "Run `refresh_catalog`, then plan, check and book. Every write asks for your approval." with:

> 4. Run `refresh_catalog`, then plan and check. Compass is read-only by default: it reads your real schedule, and the booking tools tell you what they would do and that you make the change in the re:Invent app. See [Read-only by default](#read-only-by-default).

**New section after step 4 of Live mode** (before "Boarding passes in live mode need..."):

> ### Read-only by default
>
> Signed in with your Builder ID, Compass reads the live catalog and your real reservations, standby list and layovers. It never changes them unless you turn writes on yourself. Until then the five schedule tools run the guardrail and reply with what they would have done, and every Events API write is refused before any request is sent, so nothing can change your schedule by accident. Boarding passes still work, because they live on the Compass pass service.
>
> To let Compass make changes, each one still approved by you first, set `COMPASS_ALLOW_WRITES=1` in the `env` of the Compass MCP server in your client's MCP settings. While writes are on, every schedule reply starts with "Writes are on". Only you should change this setting: the Power tells the agent never to. Details are in [packages/mcp-server/README.md](packages/mcp-server/README.md#read-only-by-default).

**Line 114.** Replace with:

> Boarding passes in live mode need the production Compass API at `https://reinvent-compass.vegas`, which is **coming soon**.

**Lines 116 to 136** ("The 17 tools" and its table). Replace the heading and the whole table with:

> ## The 24 tools
>
> | Tool                        | Kind         | What it does                                                                                                   |
> | --------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
> | `sign_in`                   | local action | Signs you in with your AWS Builder ID. Opens your browser.                                                     |
> | `sign_out`                  | local action | Revokes your sign-in and clears the stored tokens.                                                             |
> | `refresh_catalog`           | read         | Loads the session catalog into a private local cache.                                                          |
> | `find_sessions`             | read         | Searches and filters the cached catalog.                                                                       |
> | `scan_repo`                 | read         | Scans a folder (or a dev folder of repos) read-only for AWS services and tech.                                 |
> | `show_my_tech`              | read         | Lists your tech list on this machine: AWS services first, then other technology.                               |
> | `find_sessions_by_tech`     | read         | Finds catalog sessions on a technology, or on the tech you use the most.                                       |
> | `connect_github`            | local action | Connects the read-only Compass GitHub App. Shows a code to enter on GitHub.                                    |
> | `scan_github`               | read         | Reads your GitHub repositories, read-only, after you confirm the list.                                         |
> | `disconnect_github`         | local action | Deletes the GitHub sign-in on this machine.                                                                    |
> | `check_itinerary`           | read         | Runs the guardrail over proposed sessions. Writes nothing.                                                     |
> | `show_schedule`             | read         | Lists your reservations, standby list and layovers with their ids. Writes nothing.                             |
> | `plan_week`                 | local action | Plans a week and writes it as a Kiro spec in the workspace, after you confirm.                                 |
> | `export_calendar`           | local action | Writes an `.ics` calendar file of your schedule.                                                               |
> | `reserve_with_guardrails`   | write        | Reserves 1 to 10 sessions after the guardrail passes. Changes your real schedule when writes are on.           |
> | `cancel_reservation`        | write        | Cancels a reservation, with the safe swap rule. Changes your real schedule when writes are on.                 |
> | `add_standby`               | write        | Favourites sessions as backups. Changes your real schedule when writes are on.                                 |
> | `remove_standby`            | write        | Removes a favourite. Changes your real schedule when writes are on.                                            |
> | `add_layover`               | write        | Creates, changes or deletes personal time. Changes your real schedule when writes are on.                      |
> | `issue_all_boarding_passes` | write        | Creates unofficial boarding passes for all your reserved sessions; approving the call is the one confirmation. |
> | `issue_boarding_pass`       | write        | Creates one boarding pass for a session you hold; without a session it asks which.                             |
> | `send_to_phone`             | write        | Makes a 15-minute link for your passes: shown as a link, a QR code in your browser, or both.                   |
> | `sync_passes`               | write        | Makes the passes match your schedule. It can void passes.                                                      |
> | `forget_me`                 | write        | Deletes your pass data on the server and on this machine.                                                      |

**New section after the Approvals paragraph** (before "How Compass uses the AWS Events API"):

> ## Your tech list and GitHub
>
> Every scan adds to one tech list on your machine: the AWS services you use (with depth) and the other technology you use, such as .NET, C#, Node.js, TypeScript, Python, Java, Go, React, Angular, Docker, Kubernetes and Terraform. Ask "What tech do I work on?" (`show_my_tech`) or "Find me sessions on .NET" (`find_sessions_by_tech`). `plan_week` ranks sessions by the whole list.
>
> - **A dev folder.** Point `scan_repo` at a folder of projects. Each git repository one or two levels down is scanned on its own, up to 50.
> - **GitHub, read-only.** `connect_github` signs you in to the Compass GitHub App with a code you enter on github.com. The app has only Contents: read and Metadata: read, so it can never change your code. `scan_github` lists the repositories it is about to read and reads nothing until you confirm. Each repository is read in memory and dropped; nothing is written to disk.
> - **Disconnect.** `disconnect_github` (or `forget_me`) deletes the GitHub sign-in on this machine. To remove the app on GitHub as well, uninstall it in your GitHub settings.
>
> The tech list stays in your app-data folder and is never sent anywhere.

**Line 138** (Approvals). Replace the paragraph with:

> **Approvals.** Only three read tools may be auto-approved: `refresh_catalog`, `find_sessions` and `check_itinerary`, and the Power ships no auto-approve list. `scan_repo`, `show_schedule`, `show_my_tech`, `find_sessions_by_tech` and the three GitHub tools read your own data or your GitHub account, so approve each call. `scan_github` also asks you to confirm the repositories first. **Write tools must never be auto-approved.** In live mode the schedule tools change nothing until you set `COMPASS_ALLOW_WRITES=1`. Where your client supports it, Compass also asks you to confirm before it changes your schedule, listing the sessions and any warnings. Declining writes nothing. For the two pass tools, your client's approval is the one confirmation. There is no background booking, no seat polling and no retry loop on reservations.

**Lines 156 and 157.** No change: `add_layover` takes `action: create`, `update` or `delete` (`packages/contracts/src/mcp-tools.ts`).

**Line 165** (official remote MCP server). "it is not yet confirmed" is settled (ADR-024). Replace with:

> - **The official remote MCP server.** AWS publishes its own MCP server at `https://api.awsevents.com/mcp`. It is fine for reading, but its write tools skip both the Compass guardrail and the Compass read-only setting. The Kiro hook template blocks writes through it. The Power does not bundle it, because Kiro does not honour `disabledTools` inside a Power (ADR-024).

**Line 184** (Hooks). The PostToolUse hook was removed. Replace with:

> **Hooks (Kiro only).** The `install-hooks` skill writes a hook file to `.kiro/hooks/` after you say yes. Before a Compass booking, a PreToolUse hook runs the same check and blocks the call when the guardrail blocks it. A second hook blocks any write through the remote `awsevents` server. The Compass tool results say when to run `sync_passes`. Hooks are defence in depth: the server checks every booking again, and in read-only mode it changes nothing at all.

**Line 186** (Prompt injection). Add one sentence at the end:

> The test covers all five schedule tools in read-only mode too.

**Line 190.** The pass itself words the badge rule at length, and the orange labels are close to the AWS colours (an accepted deviation). Replace with:

> **The badge is the ticket.** Every pass is marked unofficial, and its back says: "This is not a ticket. Your re:Invent badge is your official ticket. Bring it to every session." Passes carry no barcode and no AWS logos. All artwork is original.

**Line 192** (what a pass shows). Replace with:

> - **What a pass shows:** the session code, the title as the flight name, the venue as the terminal, the room as the gate, the date and times, and **Boarding closes** (10 minutes before the start). The back shows the full room, the walk from the previous session and the next connection. The Google pass shows the same, except your name.

**Lines 200 to 203** (the phone hand-off). Replace the four steps with:

> 1. `send_to_phone` asks "Link or QR code?" first. A link appears in the chat; a QR code opens on a page in your browser, for your phone camera to scan.
> 2. The link opens the site's `/board` page. The hand-off id sits in the URL fragment, so it never reaches the CDN, and the page removes it from the address.
> 3. The page offers **Add to Apple Wallet** (in bundles of up to 10 passes), **Add to Google Wallet**, or the calendar file.
> 4. The link works for 15 minutes. When it expires, the QR page says so.

**Lines 213 to 216** (what stays on your machine). Add two bullets:

> - Your tech list (AWS services and other technology), in your app-data folder. Each project is stored under a one-way hash, so no folder path or repository name is kept.
> - Your GitHub tokens, if you connect GitHub, in the OS keychain (or memory only).

**Lines 220 to 222** (what leaves it). Add one bullet:

> - If you connect GitHub, the GitHub tokens go only to `github.com` and `api.github.com`. Repository archives come from `codeload.github.com` without the token and are read in memory. Nothing about your repositories goes to Compass or to AWS.

**Line 231** (Forget me). Replace with:

> **Forget me.** `forget_me` deletes your pass records, device registrations and hand-offs on the server, voids your passes, and deletes your local schedule snapshot, issued-pass record, tech list, GitHub sign-in and generated files. Apple passes already on a phone stay there until they expire (Compass tells you to delete them).

**Lines 243, 255 and 277 to 283** (Architecture diagram). Optional, to show the GitHub scan and the domain. In line 243 add the tech list to the server label (`rules, scanner, week spec,<br/>passes, sync, .ics, tech list`), in line 255 replace `cf["CloudFront + WAF"]` with `cf["CloudFront + WAF<br/>reinvent-compass.vegas"]`, and after line 278 add:

> `  server -->|"read-only GitHub App (optional)"| github["github.com, api.github.com,<br/>codeload.github.com"]`

**Line 287** (Trust boundaries). Add one sentence after the first:

> If you connect GitHub, it sends the GitHub tokens only to GitHub.

**Line 321** (site in the layout). Replace with:

> `site/                  The showcase site (Angular 22, static): story, demo, install, documentation, legal pages, board`

**Line 327** (docs in the layout). Optional:

> `docs/                  Build plan, ADRs, runbooks, hackathon rules, the story and the article draft`

## Article draft

**Line 3** (title). The title can stay, because the owner's story still uses "Plan like a spec, board like a flight" (`docs/story/creator-and-inspiration.md`). If the title should carry the tagline instead:

> # From your code to your seat, on time: building re:Invent Compass with Kiro

**Line 7** (hero screenshot note). Replace `showing "Seat released at"` with `showing "Boarding closes"`.

**After line 11** (opening). The owner's own words from the Inspiration page fit here. Add:

> Before I picked a single session, I opened the campus map and watched videos of the venues. Las Vegas is huge. The sessions are spread across several hotels on the Strip, and the walks between them are long.

**Line 15.** Align the name with the pass: replace "Seat released at 10:20" with "boarding closes at 10:20".

**Line 17.** The contest name. Replace "re:Invent Event Catalog API Hackathon" with "re:Invent Catalog API Builder Challenge". Optional, from the owner's story, after "That became my entry...":

> I had the idea before the re:Invent Catalog API Builder Challenge was announced. The challenge gave me the reason to build it properly. I am travelling to re:Invent as the founder of AWS Community South Africa, and I want to represent our community with something every attendee can use.

**Line 21** (the airline idea). Optional, from the owner's story, before "Once I saw the event through that lens":

> I am an aviation geek and an aspiring pilot, and I live and breathe anything to do with flying. As an aviation geek, I wanted my re:Invent week to run like a well-planned flight.

**Line 25** (the airline list). Match the pass: replace "The venue and room are the gate." with:

> - The venue is the terminal and the room is the gate.

**Line 32.** The tagline changed. Replace with:

> That gave me the idea in one line: plan like a spec, board like a flight. The tagline says what it does for you: from your code to your seat, on time.

**Line 36** (Plan). The scan now covers other technology, dev folders and GitHub. Replace the second sentence ("It looks at Terraform ... how deeply.") with:

> It looks at Terraform, CDK in TypeScript, the AWS SDK for JavaScript v3, boto3 and the AWS SDK for .NET, and works out which AWS services you use and how deeply. It also counts the other technology you use, such as .NET, Node.js, Python or React. Point it at a dev folder and it scans each git repository inside. If you allow it, a read-only GitHub App lets it read your GitHub repositories the same way, after you confirm the list. Then you can ask "What tech do I work on the most?" or "Find me sessions on .NET".

**Line 38** (Board). Replace "A QR code moves them from your computer to your phone." with:

> A short-lived link or QR code moves them from your computer to your phone.

**After line 66** (after "there is no background booking or seat sniping."). Add a paragraph:

> Then I signed in with my own Builder ID to test on real data, and decided Compass should not be able to change my schedule by accident at all. So it is read-only by default. It reads the live catalog and my real reservations, runs the guardrail, and the booking tools say what they would have done and that nothing changed. Every Events API write is refused in the adapter, before any request. An attendee who wants Compass to book sets one environment variable, and from then on every schedule reply starts with "Writes are on". Boarding passes still work, because they live on my own pass service.

**Line 88.** Replace the paragraph with:

> Every pass is marked unofficial, and its back says: "This is not a ticket. Your re:Invent badge is your official ticket. Bring it to every session." Passes carry no barcode and no AWS logos, and all the artwork is original. I designed the pass in Apple's Pass Designer, and it reads like a boarding pass: the session code at the top, the title as the flight name, the venue as the terminal, the room as the gate, and "Boarding closes" next to the date. The Google Wallet pass has the same rows on a blue card. Google approved my Google Wallet issuer for publishing on 21 October, so any Android user can save one.

**Line 94.** Replace "To board on your phone, Compass shows a QR code. Your camera opens a hand-off page..." with:

> To board on your phone, Compass asks "Link or QR code?". A QR code opens on a branded page in your browser. Your camera opens a hand-off page that works for 15 minutes, and the hand-off id sits in the URL fragment, so it never reaches the CDN.

**Line 98** (screenshot note). Replace `QR hand-off in the terminal` with `the QR page in the browser`. Optional, after line 99: `[SCREENSHOT: the same session as a Google Wallet pass on Android]`.

**Line 125** (check note). Update to the current state:

> [CHECK BEFORE PUBLISHING: the code is at 0.1.0. Confirm prod is live at https://reinvent-compass.vegas and the package is on npm, then update this list.]

**Line 127.** "17 tools" becomes:

> - A Kiro Power and a local MCP server with 24 tools, read-only by default on real data.

**Line 128.** Replace `<version>` with `0.1.0`.

**Line 131.** Six modules is still right. Replace with:

> - Terraform for everything, including the domain registration: six modules, dev and prod, native tests and ten runbooks.

**New bullet after line 131.** Optional:

> - Apple Wallet and Google Wallet passes checked on a real iPhone and Android phone, with Google Wallet publishing access approved.

**Line 134.** No change needed: develop has 375 commits dated 15 to 18 October, so "more than 250" is still true.

**Lines 140 to 143** (What is next). Three bullets are stale: the passes were checked on real phones (pass-service tasks 44.3 and 47.5), ADR-024 settled the hook input and the bundling question, and `add_layover` already updates and deletes layovers (as line 78 says). Replace lines 140 to 143 with:

> - The release: the production deploy at reinvent-compass.vegas, then the npm package 0.1.0, the Kiro Power listing and the showcase site. [CHECK: mark each one live or coming soon.]

**Line 148** (Repository). The address is known:

> - Repository: https://github.com/henniefrancis/aws-re_invent-compass

**Line 149** (site). Replace the placeholder with:

> - Showcase site and phone demo: https://reinvent-compass.vegas [CHECK: live after the prod deploy]

**Line 152** (closing). Optional, the owner's words from the Inspiration page, before the closing question:

> I want you to arrive on time, keep your seat and be free to enjoy re:Invent: the learning, the people and the energy.

## Hackathon rules row 3

Row 3 of `docs/hackathon-rules.md` is still Open: the README needs a plain dependencies heading before submission. Proposed section, as the first subsection of "Quick start" (it replaces line 62, "You need Node.js 24 or newer."):

> ### Requirements
>
> - Node.js 24 or later (`npx` comes with it).
> - Kiro (with "Kiro Agent: Configure MCP" enabled), or another desktop MCP client that runs stdio servers, such as Claude Desktop, VS Code or the Kiro CLI.
> - For live mode: an AWS Builder ID registered for re:Invent 2026. Simulated mode and the demo need no account.
> - For boarding passes on a phone: Apple Wallet on iPhone or Google Wallet on Android. iPad uses the calendar file.
> - Optional: a GitHub account, to scan your GitHub repositories through the read-only Compass GitHub App.
> - On Linux, the Secret Service (for example GNOME Keyring) keeps your sign-in between sessions. Without it, you sign in again each session.

Once it is in the README, row 3 of `docs/hackathon-rules.md` can be marked Met. The judging table row in the same file now says the passes show "Boarding closes" (corrected 26 October with this refresh, together with the ADR-027 item 7 mitigation text).
