# Demo video script (tracker D03)

Draft for the owner to review. Not recorded yet. Every item marked **[UNCONFIRMED]** could not be confirmed from the repository and needs the owner's check before recording.

## What the rules say about the video

- The official rules copied into `docs/hackathon-rules.md` (version of 24 September 2026) **do not mention a video**. There is no length limit, format or required content for one in that copy. **[UNCONFIRMED]** Check the live contest page and the submission form for a video field or limit before recording.
- The judging criterion "Quality of the published Builder Center article" lists "the demo video" as part of the article (D02), so the video should be embedded in or linked from the article.
- The owner's own rule ("Kiro first", `docs/hackathon-rules.md`): the video must show Kiro, with **the Power in use, the spec of the week and a hook blocking a bad booking**.
- `CONCEPT.md` section 11 sets the demo story at **about 3 minutes**. This script aims for 3:00.
- The build plan (section 9) says the video is recorded **on prod** on 31 October.

## Runtime

**3:00 in total**, 13 shots. The narration is about 430 words, read at about 150 words a minute, with short pauses where the screen does the talking.

| #   | Time         | Shot                                     |
| --- | ------------ | ---------------------------------------- |
| 1   | 0:00 to 0:16 | Cold open: the problem                   |
| 2   | 0:16 to 0:32 | The airline metaphor                     |
| 3   | 0:32 to 0:42 | Install the Power in Kiro                |
| 4   | 0:42 to 1:02 | Tech scan and "Plan my re:Invent"        |
| 5   | 1:02 to 1:16 | Check the itinerary: walks and a clash   |
| 6   | 1:16 to 1:36 | Reserve with guardrails: the hook blocks |
| 7   | 1:36 to 1:44 | A layover for lunch                      |
| 8   | 1:44 to 1:56 | Issue boarding passes, send to phone     |
| 9   | 1:56 to 2:10 | The pass on iPhone and Android           |
| 10  | 2:10 to 2:22 | A cancel voids the pass                  |
| 11  | 2:22 to 2:38 | The showcase site and the click-through  |
| 12  | 2:38 to 2:50 | Safety: read-only by default             |
| 13  | 2:50 to 3:00 | Close: the key line and the URL          |

## The sessions to use

The real catalog is not in the repository (only the synthetic one is), so the real sessions cannot be picked here. **[UNCONFIRMED]** The owner picks them from the live catalog, signed in, before recording. They need:

- **A** and **B** on the same day at different venues, with a gap shorter than the walk plus the 10 minute buffer, so `check_itinerary` reports a tight or likely impossible connection with its walking minutes.
- **C**, which overlaps **A** (the clash), where **A** has a true repeat (`A-R`) that clashes with nothing else in the week. This drives the block and the safe swap.
- A day where the picks leave less than 30 free minutes between 11:30 and 14:00, so Compass warns about the meal and suggests a layover.
- **D**, a session the owner is happy to cancel on camera (the void shot).
- Sessions the owner really wants to attend, because in live mode with writes on these are **real reservations** (see open question 2).

For rehearsal in simulated mode, the synthetic catalog has the same story: `BWP213` (Tuesday 13:00, MGM Grand) held, `ARC228` clashing with it, and the repeat `BWP213-R` (Friday 11:30, The Venetian). The site demo uses that same set.

## Shot list and narration

### Shot 1. Cold open: the problem (0:00 to 0:16)

- **On screen:** the official re:Invent campus map, then a slow pan along the venues on the Strip. Text card at 0:10: "Reserved seat released 10 minutes before the start."
- **Narration:**

  > This is my first re:Invent. More than two thousand sessions, spread across hotels on the Las Vegas Strip. And one rule worried me most. A reserved seat is only held until ten minutes before the session starts. Then it goes to the walk-up line.

- **Prepare:** the campus map and venue footage. **[UNCONFIRMED]** Use of the official map in the video: check its terms, or draw an original map. The seat rule comes from the official re:Invent 2026 FAQ (README, "Who it is for").

### Shot 2. The airline metaphor (0:16 to 0:32)

- **On screen:** the "Starts 10:30" versus "Boarding closes 10:20" illustration, then the metaphor table (Itinerary, Boarding pass, Terminal and gate, Boarding closes, Tight connection, Layover, Cancelled flight) building one row at a time. End on the tagline "From your code to your seat, on time."
- **Narration:**

  > So the time that matters is not when a session starts. It is when boarding closes, plus the walk to get there. re:Invent already works like an airline. Each reserved session is a boarding pass. The venue is the terminal, the room is the gate.

- **Prepare:** a title card built from the README table "re:Invent already works like an airline". The site home page now says "Boarding closes at 10:20", like the pass, so the home page hero can be filmed too.

### Shot 3. Install the Power in Kiro (0:32 to 0:42)

- **On screen:** Kiro, Powers panel, **Add Custom Power**, **Import power from GitHub**, paste `https://github.com/henniefrancis/aws-re_invent-compass`. The Power appears as "Reinvent Compass" and its MCP server starts.
- **Narration:**

  > re:Invent Compass is a Kiro Power. I import it from GitHub, and Kiro starts the Compass MCP server on my own machine.

- **Prepare:** "Kiro Agent: Configure MCP" set to Enabled beforehand (off camera). `main` merged and `reinvent-compass@0.1.0` on npm, because `power/mcp.json` starts `npx --yes reinvent-compass@0.1.0`. **[UNCONFIRMED]** Which URL form Kiro accepts (root or `/tree/main/power`) is not recorded; try both before recording. Remove any earlier Compass Power or `compass` server entry first so the import is clean.

### Shot 4. Tech scan and "Plan my re:Invent" (0:42 to 1:02)

- **On screen:** a project open in Kiro. Type "Plan my re:Invent." Approve `scan_repo`; the reply lists AWS services with their depth, then other technology. Approve `plan_week`, confirm the folder. Kiro shows `.kiro/specs/my-reinvent-week/` with `requirements.md`, `design.md` and `tasks.md`. Scroll `design.md`: a reason per session and the connection times.
- **Narration:**

  > I open my own project and say: plan my re:Invent. Compass scans my code, read-only, and works out which AWS services I use, and how deeply. Then it writes my week as a Kiro spec. Requirements, design and tasks, with a reason for every session.

- **Prepare:** a workspace with no private code or names on screen. Options: a copy of `fixtures/sample-repo` (made-up, uses Terraform, CDK, the JavaScript SDK and boto3), or one of the owner's public projects. Signed in (`sign_in`) and `refresh_catalog` run before recording. Answer **No** or skip the `.gitignore` offer quickly, or accept it; either is fine on camera. Optional insert (2 seconds): `scan_github` listing repositories before it reads, if the owner wants the GitHub App shown; only public repositories on screen.

### Shot 5. Check the itinerary: walks and a clash (1:02 to 1:16)

- **On screen:** "Check my itinerary." `check_itinerary` replies with `Verdict: block.` and "Do not reserve these sessions as they are.", and reasons such as "The walk from ... to ... is 40 minutes, an estimate. ... That leaves only 3 minutes to spare." and "... and ... overlap from ... to ...". Highlight the walking minutes and the overlap.
- **Narration:**

  > Before I book anything, Compass checks the itinerary. It knows the walk between every venue. This connection is too tight, and these two sessions clash.

- **Prepare:** sessions A, B and C (above) in the plan. The exact reason text comes from the rules engine; the quoted shapes are from `packages/core/src/rules/reasons.ts`. Zoom the editor so the reasons are readable at 1080p.

### Shot 6. Reserve with guardrails: the hook blocks (1:16 to 1:36)

- **On screen:** "Reserve my week." The Kiro hook blocks the call to reserve C, with the guardrail's reason. Compass offers the repeat. The safe swap: reserve `A-R` first, confirm on the schedule, then cancel A. The confirmation "Reserve these sessions?" lists the sessions; approve. Replies start with "Writes are on" and end with "Reserved and confirmed on your schedule."
- **Narration:**

  > When I try to book the clash, a Kiro hook blocks it, with the reason in plain English. Compass offers the repeat instead. It reserves the repeat first, reads my schedule back from the AWS Events API, and only then cancels the original. I approve every write.

- **Prepare:** the `install-hooks` skill run before recording (writes `.kiro/hooks/reinvent-compass.json`). `COMPASS_ALLOW_WRITES=1` set in the server `env` **off camera**. **[UNCONFIRMED]** How Kiro shows a hook block (exit code 2, stderr to the agent, per ADR-024) and whether Kiro shows the "Reserve these sessions?" confirmation (MCP elicitation) or only its own tool approval. Rehearse both.

### Shot 7. A layover for lunch (1:36 to 1:44)

- **On screen:** the meal warning ("On ... you have ... free in the meal window. You need 30 minutes."), then "Add a lunch layover." `add_layover` with `action: create`; approve; the layover appears in `show_schedule`.
- **Narration:**

  > Lunch is a layover. Compass finds a gap that clashes with nothing, and books it as personal time.

- **Prepare:** the meal day (above). Delete the layover after recording if it is not wanted (`add_layover` with `action: delete`).

### Shot 8. Issue boarding passes, send to phone (1:44 to 1:56)

- **On screen:** "Issue my boarding passes." `issue_all_boarding_passes`, one approval. Then "Send them to my phone." Kiro asks "Link or QR code?"; answer "QR code". A browser page opens with the QR code and "Scan the QR code in your browser with your phone camera". The iPhone camera scans it.
- **Narration:**

  > Now the boarding passes. One approval issues a pass for every reserved session. Link or QR code? I pick the QR code, and scan it with my phone.

- **Prepare:** prod Compass API live. Do not type a name for the pass (the optional name would show on the Apple pass). The link lasts 15 minutes: issue and scan in one take. Blur the QR code in the final cut. It will have expired by then, but Compass warns never to share it.

### Shot 9. The pass on iPhone and Android (1:56 to 2:10)

- **On screen:** the iPhone opens `/board` and taps **Add to Apple Wallet**. The pass: SESSION, FLIGHT NAME, TERMINAL, the arrow, GATE, DATE and **BOARDING CLOSES**, black with orange labels. Cut to Android: **Add to Google Wallet**, the blue pass with TERMINAL and GATE on row 1, DATE and **BOARDING CLOSES** on row 2. Close-up on BOARDING CLOSES. Flip the Apple pass to the back for one second: "This is not a ticket. Your re:Invent badge is your official ticket."
- **Narration:**

  > Here it is in Apple Wallet, and on Android in Google Wallet. Session code, flight name, terminal and gate. And the time that matters most: boarding closes.

- **Prepare:** an iPhone and an Android phone with the owner's own Wallet accounts. Both screen-recorded natively (iOS Control Centre screen recording, Android screen recorder). The Android hand-off needs a second scan or the link; do it in the same 15 minutes. The Google class must already be set up on prod (`scripts/google-wallet-class.mjs`, once per environment after the images are live, per the pass-service design).

### Shot 10. A cancel voids the pass (2:10 to 2:22)

- **On screen:** "Cancel D." `cancel_reservation`, approve. The reply says to run `sync_passes`; approve it: "Passes synced: 0 issued, 0 updated, 1 voided." (the counts depend on the week). Cut to the iPhone: the pass leaves the main Wallet view and shows in expired passes. Optional: the Google pass marked expired.
- **Narration:**

  > Plans change. I cancel a session, Compass syncs my passes, and that pass is voided. It leaves my Wallet and moves to expired passes.

- **Prepare:** session D held and its pass on both phones. The Apple update arrives by push, usually within a minute; record the phone continuously and cut the wait. **[UNCONFIRMED]** How fast Google Wallet shows the `INACTIVE` object as expired. Note: no wallet lets anyone delete a pass, so never say "deleted".

### Shot 11. The showcase site and the click-through (2:22 to 2:38)

- **On screen:** a phone browser on `https://reinvent-compass.vegas`, then `/demo`. Tap **Start with a sample week**, add `ARC228`; the guardrail blocks it with its reasons. Tap **Try this repeat**: the three swap steps tick off. Tap **Show sample pass**. End on "These sessions are made up. Nothing in this demo touches a real schedule."
- **Narration:**

  > Judges and attendees can try it with no install and no sign-in. The showcase site runs a click-through demo on made-up sessions, with the same rules engine. Add a session that clashes, and watch the guardrail stop it.

- **Prepare:** prod site live. A phone screen recording, or a desktop browser at phone width. Start from a fresh load (the site keeps no state, so a reload resets it).

### Shot 12. Safety: read-only by default (2:38 to 2:50)

- **On screen:** a pickup clip recorded with writes off: a reserve request answered "Compass is read-only, so nothing in your re:Invent schedule changed. Make this change yourself in the re:Invent app." Then a close-up of the README line `"env": { "COMPASS_ALLOW_WRITES": "1" }` (not the live Kiro settings). End on "Unofficial. Your badge is your ticket."
- **Narration:**

  > Compass is read-only by default. It reads your real schedule, but changes nothing until you turn writes on yourself. Even then, every booking is checked, and you approve each one. And the passes are unofficial. Your badge is your ticket.

- **Prepare:** record this clip first, before turning writes on. Show the README snippet, not the MCP settings file, so no other `env` value is on screen.

### Shot 13. Close: the key line and the URL (2:50 to 3:00)

- **On screen:** the owner on camera, or the Apple pass on a phone over the Compass logo. End card: "re:Invent Compass. From your code to your seat, on time. reinvent-compass.vegas", the repository URL, and the small line "Independent community project. Not affiliated with AWS."
- **Narration:**

  > As an aviation geek, I wanted my re:Invent week to run like a well-planned flight. re:Invent Compass. From your code to your seat, on time. reinvent-compass dot vegas.

- **Prepare:** the end card. The not-affiliated line matches the README and the site footer.

## Before recording

- **Prod, not dev.** Record after the 0.1.0 release: the Power, `npx`, passes and the site all on prod. Dev (`https://dev.reinvent-compass.vegas`) is for rehearsal only: it needs a local build with `COMPASS_API_URL` and `COMPASS_ALLOW_API_OVERRIDE=1`, and its URL would show on the phone.
- **Account.** The owner's own Builder ID, registered for re:Invent 2026. **[UNCONFIRMED]** No separate test Builder ID is recorded in the repository. Simulated mode cannot be used for the phone shots: it never reaches a Compass API, so no real pass is made.
- **Writes.** Record shot 12 first with writes off. Then set `COMPASS_ALLOW_WRITES=1` off camera. Turn it off again after recording.
- **Sessions.** Sessions A, B, C, `A-R` and D picked and written down (above). Start from a clean schedule for those sessions. Run `forget_me` on the old dev passes if any linger, and delete old Compass passes from both phones.
- **Rehearse once end to end** in simulated mode (`COMPASS_MODE=simulated`) for the Kiro flow, then once live on prod.
- **Phones.** Do Not Disturb or Focus on, notifications off, battery charged, Wi-Fi on, a neutral wallpaper. Wallet and Google Wallet show payment cards: film only the pass, or crop the card stack out.
- **Computer.** Notifications off (Windows Focus), other apps closed, a clean desktop, browser bookmarks and profile picture hidden, no email or chat windows.
- **Kiro.** Large font and zoom for 1080p. No recent-workspace list, terminal history or chat history with private content on screen. **Never open the MCP settings with secrets visible**: any `env` value, token or key stays off camera. The Kiro account name or email in the corner hidden or cropped.
- **No personal data on screen.** No other attendees, no email address, no name on the pass, no private repository names, no AWS account id or console.
- **Hooks and Power.** `install-hooks` run and "Kiro Agent: Configure MCP" enabled before the shots that need them.
- **Timing.** Each hand-off link lasts 15 minutes: issue, scan and add in one sitting.

## What can only be filmed after the prod release

- Shot 3: installing the Power from GitHub (needs `develop` merged into `main` and `reinvent-compass@0.1.0` on npm).
- Shots 4 to 10 live: they run the published package against the prod Compass API at `https://reinvent-compass.vegas`.
- Shots 8 to 10 on the phones: prod-signed passes, the prod `/board` page and the prod Google Wallet class and images.
- Shot 11: the showcase site on the prod domain.
- Shot 13: the end card URL, once it answers.

Shots 1 and 2 (map, metaphor cards) and the simulated rehearsal can be done before the release.

## Open questions for the owner

1. **Video rules.** The rules copy has no video rule. Is there a video field, length limit or hosting rule on the live contest page or the submission form? Where will the video be hosted (for example YouTube, unlisted or public)?
2. **Real reservations.** With writes on, shots 6, 7 and 10 make real reservations, a real swap, a layover and a real cancel on your re:Invent schedule. Are you happy to do that with sessions you really want, or should those shots show the read-only replies and you make the changes in the re:Invent app?
3. **Hook on camera.** The owner rule asks for a hook blocking a bad booking. Is the in-Kiro hook block enough, or do you also want the server guardrail block shown?
4. **Tech scan source.** The sample repo, one of your public projects, or `scan_github` through the GitHub App?
5. **Wording on the site.** Decided 31 October 2026: the site now says "Boarding closes" everywhere, like the passes and this script.
6. **Folder.** `.kiro/steering/structure.md` names `docs/demo/` for the video script; this draft is in `docs/video/` as asked. Keep it here (and update the steering file later), or move it?
7. **Campus map.** May the official campus map and venue footage be shown, or should the cold open use original artwork?
8. **On camera.** Do you want to appear in shot 13, or end on the pass and the end card?
9. **Voice.** Recorded live while filming, or a separate voice-over laid over the cut?
