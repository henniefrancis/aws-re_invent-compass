# re:Invent Compass

**Plan like a spec. Board like a flight.**

A Kiro Power that turns a first-timer's re:Invent week into a Kiro spec, then issues unofficial boarding passes for every reserved seat so the right information is on their lock screen at the right moment.

Entry for the re:Invent Event Catalog API Hackathon. Submission deadline: 6 November 2026, 11:59 PM PT.

---

## 1. The problem

A first-time attendee faces 2,000+ sessions across several hotels on the Las Vegas Strip. They do not know the session types, the campus, or the rules. Most tools in this hackathon help them **choose** sessions. Very few help them **actually get into** those sessions and survive the week.

The single most expensive first-timer mistake is invisible in every catalog:

> A reserved seat is only held until **10 minutes before the session starts**. After that it is released to the walk-up line. (Official re:Invent 2026 FAQ)

So the time that matters is not "Starts 10:30". It is **"Seat released at 10:20"**, plus the walk from wherever you are now.

## 2. The insight: re:Invent already works like an airline

| Airline | re:Invent | What Compass does |
|---|---|---|
| Itinerary | Your week | Generated as a Kiro spec you can read and edit |
| Ticket | Your physical badge | Compass never pretends to be a ticket |
| Boarding pass | One per reserved session | Unofficial pass on the lock screen |
| Gate | Venue and room | Shown on the pass |
| **Boarding closes** | **Start minus 10 minutes** | **The hero field on every pass** |
| Tight connection | Walk between venues longer than the gap | Flagged before you reserve |
| Rebooking | Session full: take the repeat (`-R` in the session ID) | Safe swap: reserve the repeat first, then cancel |
| Standby list | Favorites | Backups for full sessions |
| Layover | Meals, water, rest | Booked as personal time |

Everyone at re:Invent has flown to get there. The metaphor needs no explaining.

## 3. What it is

### Act 1: Plan (inside Kiro)
- **Your repo is your agenda.** Compass scans the attendee's own workspace (Terraform, CDK, CloudFormation, SAM, AWS SDK imports) and works out which AWS services they actually use and how deeply. It maps those to the catalog's `services` taxonomy and suggests a level per topic. Everything runs locally; nothing about the code leaves the machine.
- **Your week becomes a spec.** Compass writes a real Kiro spec for the attendee's week:
  - `requirements.md`: their goals for the week, in plain EARS statements.
  - `design.md`: the itinerary, with a reason for every pick, connection times and an energy budget.
  - `tasks.md`: each task is one API action (reserve, favorite, personal time). The attendee runs them in Kiro and approves each write.
- **First-timer guardrails as hooks.** A Kiro `PreToolUse` hook checks every reservation against the rules (connection time, boarding time, clashes, no lunch) before it is sent. A `PostToolUse` hook re-reads the schedule after every write.

### Act 2: Board (on the phone)
- The final task issues a boarding pass for each reserved session: Apple Wallet and Google Wallet.
- Each pass shows: session code and title, venue and room, **"Seat released at"**, walk time from the previous session, and the next connection.
- Every pass says clearly: **"Unofficial. Your badge is your ticket."** No AWS logos or branding.
- Fallback with no setup: a calendar file (`.ics`) with alarms set to "leave now" and "boarding closes".

### Act 3: Fly (during the week)
- When the schedule changes, Compass reads `GetSchedule` (the source of truth), compares it with the passes it issued, and reissues or withdraws passes.
- A full session gets a rebooking suggestion: the repeat, a favorite on standby, or a walk-up option.

## 4. Why this can win

| Judging criterion (25% each) | How Compass scores |
|---|---|
| Creativity and novelty | As of 15 October, no other entry ships as a Kiro Power with hooks that enforce the rules, turns a codebase into an agenda, or puts boarding information in the phone's wallet. |
| Utility for attendees | It targets the 10-minute rule, the most costly and least visible first-timer mistake, with information exactly where and when it is needed. |
| Technical depth and API use | Uses **all 12 operations** across **both** the REST API and the remote MCP server, handles per-session results, throttling and pagination properly, and includes a serverless pass signer in Terraform. |
| Builder Center article quality | A natural story: "I used Kiro specs to build a tool that turns your re:Invent week into a Kiro spec." Strong visuals: the spec, the hook stopping a bad booking, the pass on a lock screen. |

### How it differs from the 10 existing entries

| Existing entry | Overlap | Compass difference |
|---|---|---|
| Pathfinder, AI Session Assistant, agent with 2 MCPs | AI suggests sessions | Suggestions come from your actual code, and the plan is a Kiro spec you execute |
| re:Plan, re:Invent Planner, Reinvent:Match | Optimizing the week, walking time | Compass enforces rules at the moment of booking (hooks) and carries them onto the phone |
| re:Seat, Reinvent Sniper | Booking seats | Compass deliberately does not auto-book or poll for seats. A human approves every write. |
| Riv | Plan as code | Riv is a diff tool. Compass is an agent workflow with guardrails and a phone component. |
| SessionMind | Before-session prep cards | Compass covers the moment of travel and boarding, not note-taking |

## 5. API coverage (all 12 operations)

| Operation | Used for |
|---|---|
| ListEvents, GetEvent | Find `reinvent2026`, its dates and timezone |
| ListSessions | Build the local catalog cache (all pages, until `nextToken` is absent) |
| GetSession | Refresh one session before issuing or updating its pass |
| GetSchedule | Source of truth. Read back after every write. Drives pass sync. |
| ReserveSessions | Execute reservation tasks. Each session's result is read and reported. |
| CancelReservation | Second half of a safe swap to a repeat |
| AssociateFavorites, DisassociateFavorite | Standby list of backups |
| CreatePersonalTime, UpdatePersonalTime, DeletePersonalTime | Layovers (meals, rest) and transit blocks between venues |

Both surfaces are used: the Compass local MCP server talks REST, and the official remote MCP server is bundled in the Power so the agent can explore the catalog directly.

## 6. Architecture

```
Attendee's laptop                                      AWS (us-east-1, Terraform)
+-----------------------------------------------+     +-----------------------------------+
| Kiro IDE                                      |     | API Gateway REST API (throttled)  |
|  +- Compass Power (plugin.json)               |     |   + AWS WAF rate-based rule       |
|  |   +- skills/ (first-timer guide, planning) |     |            |                      |
|  |   +- mcp.json                              |     |            v                      |
|  |       +- compass   (local stdio MCP) ------+--+  | Lambda: pass signer (stateless)   |
|  |       +- awsevents (official remote MCP)   |  |  |   reads keys from Secrets Manager |
|  +- .kiro/specs/my-reinvent-week/ (generated) |  |  +-----------------------------------+
|  +- .kiro/hooks/ (guardrails, schedule sync)  |  |               ^
+-----------------------------------------------+  |               | pass fields only
          | REST + Builder ID (PKCE, loopback)     |               | (no token, no code)
          v                                        +---------------+
   api.awsevents.com/v1                                  returns .pkpass / Google Wallet link
```

Key rule: **the attendee's access token never leaves their machine.** The signer only receives the fields printed on the pass.

## 7. Principles (non-negotiable)

1. **The badge is the ticket.** Passes are reminders and must say so.
2. **No impersonation.** No AWS logos, colours or official wording on passes.
3. **A human approves every write.** No background booking, no seat polling.
4. **Local first.** Sign-in, tokens, code scanning and the catalog cache stay on the attendee's machine.
5. **Trust `GetSchedule`, not the response.** A 200 does not mean success.
6. **Explain every pick.** A first-timer should learn why, not just what.
7. **Works without registration.** A simulated mode with recorded fixtures lets judges and non-attendees try everything.

## 8. Scope

**MVP (must ship by 5 November):**
- Builder ID sign-in, typed REST client for all 12 operations, catalog cache, simulated mode
- Rules engine: boarding time, connections, clashes, layovers, repeat detection
- Compass local MCP server and Kiro Power
- Repo scanner (Terraform, CDK TypeScript, AWS SDK for JavaScript v3, boto3)
- Week spec generator and two hooks (pre-reservation guardrail, post-write sync)
- Apple Wallet and Google Wallet passes via the signer, `.ics` fallback
- Terraform for the signer (personal AWS account, `us-east-1`)

**Deliverables (planned separately, later):**
- README (hackathon requirement: setup, dependencies, how to run)
- Builder Center project post (hackathon requirement, 25% of the score)
- Showcase website for the project
- Demo video

**Stretch:**
- Live pass updates through Apple's pass web service (needs device registration storage)
- More scanners (CloudFormation, SAM, Pulumi, Python CDK)
- Trail import (community-curated weeks)

## 9. Timeline (22 days)

| Dates | Work | Kiro spec |
|---|---|---|
| 15 to 18 Oct | Sign-in, REST client, catalog cache, fixtures, simulated mode | Spec 1: events-client |
| 19 to 22 Oct | Rules engine | Spec 2: itinerary-rules |
| 23 to 28 Oct | Local MCP server, repo scanner, week spec generator, hooks, Power packaging | Spec 3: compass-power |
| 29 Oct to 2 Nov | Boarding passes, signer Lambda, Terraform, `.ics` | Specs 4 and 5 |
| 1 to 4 Nov | Showcase website (alongside the specs above) | Spec 6: showcase-site |
| 3 to 4 Nov | QA and security reviews, fixes, README | |
| 5 Nov | Builder Center post, demo video, **submit** (one day of buffer) | |

After each spec: run the QA and security review agents before starting the next. Before submitting: TAM go/no-go and CTO sign-off.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Wallet signing keys cannot ship in a public repo | Hosted stateless signer. `.ics` fallback needs no keys. |
| The public signer could be abused to sign arbitrary passes | Fixed server-side template, strict field validation and lengths, fixed disclaimer, no client images, throttling and WAF |
| A pass could be mistaken for an official ticket | "Unofficial. Your badge is your ticket." on the front, no AWS branding |
| Venue field is often empty | Recover the venue from the room text, plus a curated venue table |
| Judges may not be registered | Simulated mode with recorded fixtures |
| Google Wallet issuers start in demo mode, where only listed test users can save passes | Request publishing access in the Google Pay and Wallet Console early. Apple Wallet and `.ics` cover everyone meanwhile. |
| A secret or private value lands in the public repo | Public/private split in tech.md, `.gitignore`, secret scanning with push protection, gitleaks in CI |
| Time | MVP cut is defined. Stretch items are optional. |

## 11. Demo story (for the article and video, about 3 minutes)

1. A first-timer opens their own project in Kiro and says: "Plan my re:Invent."
2. The Power activates. Compass scans the repo: "You run Lambda, DynamoDB and Step Functions at production depth. You have never touched Bedrock."
3. Kiro writes `.kiro/specs/my-reinvent-week/`. We scroll the design: reasons, connection times, a lunch layover.
4. They run the tasks. One reservation is blocked by the hook: "Tight connection: Mandalay Bay to Wynn is 35 minutes; you have 20. Try the repeat on Thursday." They accept the swap.
5. The final task issues boarding passes. Cut to an iPhone lock screen at the Venetian: "DAT302, Seat released at 10:20, 6 min walk."
6. They cancel a session. The pass disappears. `GetSchedule` confirms it.

## 12. Decisions (15 October 2026)

| Topic | Decision |
|---|---|
| Product name | **re:Invent Compass** |
| Repository | [henniefrancis/aws-re_invent-compass](https://github.com/henniefrancis/aws-re_invent-compass) (public) |
| Licence | **Apache-2.0**, with a `NOTICE` file crediting Hennie Francis and a README line reserving the product name |
| Wallets | Apple Developer Program already in place, and Google Wallet. Both in the MVP. |
| AWS | Hennie's personal account, region **`us-east-1`** |
| Open source | Everything public except security-sensitive material (see "Public and private" in tech.md) |
