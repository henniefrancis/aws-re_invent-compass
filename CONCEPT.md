# re:Invent Compass

**From your code to your seat, on time.**

A Kiro Power that turns a first-timer's re:Invent week into a Kiro spec, then issues unofficial boarding passes for every reserved seat so the right information is on their lock screen at the right moment.

Entry for the re:Invent Event Catalog API Hackathon. Submission deadline: 6 November 2026, 11:59 PM PT.

---

## 1. The problem

A first-time attendee faces 2,000+ sessions across several hotels on the Las Vegas Strip. They do not know the session types, the campus, or the rules. Most tools in this hackathon help them **choose** sessions. Very few help them **actually get into** those sessions and survive the week.

The single most expensive first-timer mistake is invisible in every catalog:

> A reserved seat is only held until **10 minutes before the session starts**. After that it is released to the walk-up line. (Official re:Invent 2026 FAQ)

So the time that matters is not "Starts 10:30". It is **"Boarding closes at 10:20"**, plus the walk from wherever you are now.

## 2. The insight: re:Invent already works like an airline

| Airline             | re:Invent                                              | What Compass does                                |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Itinerary           | Your week                                              | Generated as a Kiro spec you can read and edit   |
| Ticket              | Your physical badge                                    | Compass never pretends to be a ticket            |
| Boarding pass       | One per reserved session                               | Unofficial pass on the lock screen               |
| Gate                | Venue and room                                         | Shown on the pass                                |
| **Boarding closes** | **Start minus 10 minutes**                             | **The hero field on every pass**                 |
| Tight connection    | Walk between venues longer than the gap                | Flagged before you reserve                       |
| Rebooking           | Session full: take the repeat (`-R` in the session ID) | Safe swap: reserve the repeat first, then cancel |
| Standby list        | Favorites                                              | Backups for full sessions                        |
| Layover             | Meals, water, rest                                     | Booked as personal time                          |

Everyone at re:Invent has flown to get there. The metaphor needs no explaining.

## 3. What it is

### Act 1: Plan (inside Kiro)

- **Your repo is your agenda.** Compass scans the attendee's own workspace (Terraform, CDK, CloudFormation, SAM, AWS SDK imports) and works out which AWS services they actually use and how deeply. It maps those to the catalog's `services` taxonomy and suggests a level per topic. Everything runs locally; nothing about the code leaves the machine.
- **Your week becomes a spec.** Compass writes a real Kiro spec for the attendee's week:
  - `requirements.md`: their goals for the week, in plain EARS statements.
  - `design.md`: the itinerary, with a reason for every pick, connection times and an energy budget.
  - `tasks.md`: each task is one API action (reserve, favorite, personal time). The attendee runs them in Kiro and approves each write.
- **First-timer guardrails as hooks.** A Kiro `PreToolUse` hook checks every reservation against the rules (connection time, boarding time, clashes, no lunch) before it is sent. A `PostToolUse` hook re-reads the schedule after every write.

### Act 2: Boarding (on the phone)

- The final task issues a boarding pass for each reserved session: Apple Wallet and Google Wallet.
- Each pass shows: session code and title, venue and room, **"Boarding closes"**, walk time from the previous session, and the next connection.
- Every pass says clearly: **"Unofficial. Your badge is your ticket."** No AWS logos or branding.
- Fallback with no setup: a calendar file (`.ics`) with alarms set to "leave now" and "boarding closes".

### Act 3: Fly (during the week)

- When the schedule changes, Compass reads `GetSchedule` (the source of truth), compares it with the passes it issued, and reissues or withdraws passes.
- A full session gets a rebooking suggestion: the repeat, a favorite on standby, or a walk-up option.

## 4. Why this can win

| Judging criterion (25% each)   | How Compass scores                                                                                                                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creativity and novelty         | As of 15 October, no other entry ships as a Kiro Power with hooks that enforce the rules, turns a codebase into an agenda, or puts boarding information in the phone's wallet.                                                                                                          |
| Utility for attendees          | It targets the 10-minute rule, the most costly and least visible first-timer mistake, with information exactly where and when it is needed.                                                                                                                                             |
| Technical depth and API use    | Uses **all 12 operations** through the REST client (the official remote MCP server joins the Power once spike SP1 confirms its write tools can be disabled there), handles per-session results, throttling and pagination properly, and includes a serverless pass signer in Terraform. |
| Builder Center article quality | A natural story: "I used Kiro specs to build a tool that turns your re:Invent week into a Kiro spec." Strong visuals: the spec, the hook stopping a bad booking, the pass on a lock screen.                                                                                             |

### How it differs from the 10 existing entries

| Existing entry                                      | Overlap                           | Compass difference                                                                       |
| --------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| Pathfinder, AI Session Assistant, agent with 2 MCPs | AI suggests sessions              | Suggestions come from your actual code, and the plan is a Kiro spec you execute          |
| re:Plan, re:Invent Planner, Reinvent:Match          | Optimizing the week, walking time | Compass enforces rules at the moment of booking (hooks) and carries them onto the phone  |
| re:Seat, Reinvent Sniper                            | Booking seats                     | Compass deliberately does not auto-book or poll for seats. A human approves every write. |
| Riv                                                 | Plan as code                      | Riv is a diff tool. Compass is an agent workflow with guardrails and a phone component.  |
| SessionMind                                         | Before-session prep cards         | Compass covers the moment of travel and boarding, not note-taking                        |

## 5. API coverage (all 12 operations)

| Operation                                                  | Used for                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| ListEvents, GetEvent                                       | Find `reinvent2026`, its dates and timezone                            |
| ListSessions                                               | Build the local catalog cache (all pages, until `nextToken` is absent) |
| GetSession                                                 | Refresh one session before issuing or updating its pass                |
| GetSchedule                                                | Source of truth. Read back after every write. Drives pass sync.        |
| ReserveSessions                                            | Execute reservation tasks. Each session's result is read and reported. |
| CancelReservation                                          | Second half of a safe swap to a repeat                                 |
| AssociateFavorites, DisassociateFavorite                   | Standby list of backups                                                |
| CreatePersonalTime, UpdatePersonalTime, DeletePersonalTime | Layovers (meals, rest) and transit blocks between venues               |

The Compass local MCP server talks REST for all 12 operations. The official remote MCP server is planned for read exploration in the Power, and is added once spike SP1 confirms its write tools can be disabled there (ADR-024).

## 6. Architecture

The full design, threat model, routes and costs are in the approved [build plan](docs/architecture/build-plan.md). In short:

```
Attendee's computer                          AWS us-east-1 (Terraform, HCP)          Phone
+-------------------------------+            +-------------------------------+      +-------------------+
| Kiro (or another MCP client)  |  ID token  | CloudFront + WAF              |      | QR -> /board page |
|  Power: skills, mcp.json,     |  + pass    |  /      -> showcase site (S3) |<-----| Add to Wallet     |
|  hooks (Kiro only)            |  fields    |  /api/* -> API Gateway REST   |      | Wallet registers  |
|  Compass MCP server ----------+----------->|    Lambda api: issue, update, |      | for updates       |
|   rules, scanner, week spec,  |            |      void, hand-off, forget_me|      +---------^---------+
|   passes, sync, .ics          |            |    Lambda passkit: Apple web  |                |
|  keychain: access, refresh,   |            |      service, APNs pushes ----+----------------+
|  ID tokens                    |            |    DynamoDB (TTL), Secrets    |
+---------------+---------------+            +-------------------------------+
                | access token (never leaves the computer for anywhere else)
                v
      api.awsevents.com/v1 (12 operations) + /mcp (read-only in the Power)
```

Key rules: the **access token** goes only to the Events API. The Compass API receives the ID token (proof of sign-in, never stored) and the printable pass fields only.

## 7. Principles (non-negotiable)

1. **The badge is the ticket.** Passes are reminders, say so, and carry no barcode.
2. **No impersonation.** No AWS logos, colours or official wording.
3. **A human approves every write.** No background booking, no seat polling.
4. **Local first.** Tokens, the schedule, the catalog cache and code scanning stay on the attendee's machine.
5. **Minimal, expiring server data.** Pass fields until session end plus 24 hours; hand-offs 15 minutes; `forget_me` deletes everything.
6. **Trust `GetSchedule`, not the response.** A 200 does not mean success.
7. **Explain every pick.** A first-timer should learn why, not just what.
8. **Try it anywhere.** The showcase site demo runs on any phone with no install, on made-up sessions.

## 8. Scope

Eight Kiro specs (S0 to S7) in the build plan, section 8. **Never cut:** the 12-operation client, guardrails in the server, the Power with hooks, Apple passes that void on cancel and expire at session end, the QR hand-off, the site story and clash demo, README, post and video. The ranked cut list is in plan section 12.

**Deliverables:** README, Builder Center post (25% of the score), showcase website, demo video.

**On hold:** extra scanners beyond Terraform, CDK TypeScript, SDK JS v3 and boto3; community trail import.

## 9. Timeline (submit 1 November)

| Date         | Milestone                                                               |
| ------------ | ----------------------------------------------------------------------- |
| 16 Oct       | Contracts locked (S0); day-1 spikes                                     |
| 17 to 26 Oct | Six Kiro engineers build S1 to S6 in parallel, each in its own worktree |
| 21 Oct       | First dev deploy                                                        |
| 25 Oct       | Real iPhone and Android checks                                          |
| 28 Oct       | Feature freeze                                                          |
| 29 Oct       | Site freeze, TAM and CTO reviews (0.1.0)                                |
| 30 Oct       | Release gate and production release (owner runs it)                     |
| 31 Oct       | Demo video, README and post final                                       |
| **1 Nov**    | **Submit** (hackathon deadline 6 Nov stays as buffer)                   |

Details: [KIRO-SPEC-PROMPTS.md](KIRO-SPEC-PROMPTS.md) and build plan section 9.

## 10. Risks

The full register (16 risks with owner, likelihood and mitigation) is in build plan section 13. The biggest: the schedule (parallel streams and a cut list), the owner's time for approvals and deploys, the Apple certificate and pushes working by 25 October, Google publishing access, and judges never installing anything (the browser demo answers that).

## 11. Demo story (for the post and video, about 3 minutes)

1. A first-timer opens their own project in Kiro and says: "Plan my re:Invent."
2. The Power activates. Compass scans the repo: "You run Lambda, DynamoDB and Step Functions at production depth. You have never touched Bedrock."
3. Kiro writes `.kiro/specs/my-reinvent-week/`. We scroll the design: reasons, connection times, a lunch layover.
4. They run the tasks. One reservation is blocked: "Likely impossible connection: the walk from The Venetian to Wynn is 40 minutes, an estimate, and you have 30. Try the repeat on Friday." They accept the safe swap.
5. The final task issues boarding passes. They scan the QR code with an iPhone and add them to Wallet. Cut to the lock screen at the Venetian: "DAT302, Boarding closes at 10:20, 6 min walk."
6. They cancel a session. Compass voids the pass: it leaves the main Wallet view and moves to expired passes. `GetSchedule` confirms the cancellation. (No wallet lets anyone delete a pass remotely; voiding is the closest, and every pass also expires at its session end.)
7. On the showcase site, on a phone, anyone can try the clash demo with no install.

## 12. Decisions

All decisions are ADRs in [docs/decisions](docs/decisions/). The headline ones (15 October 2026):

| Topic        | Decision                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Product name | **re:Invent Compass**                                                                                                   |
| Repository   | [henniefrancis/aws-re_invent-compass](https://github.com/henniefrancis/aws-re_invent-compass) (public)                  |
| Licence      | **Apache-2.0**, with a `NOTICE` file crediting Hennie Francis and reserving the product name                            |
| Devices      | Plan on a computer, board on any device (ADR-005)                                                                       |
| Wallets      | Apple (with the PassKit update service) and Google, both in scope (ADR-010)                                             |
| Compass API  | Attendee-only, authenticated by the Builder ID ID token (ADR-009)                                                       |
| AWS          | Owner's personal account, `us-east-1`, Terraform in HCP Terraform (ADR-001, ADR-014)                                    |
| Branching    | `main` production, `develop` integration, `feature/*`, `release/*`, `hotfix/*`; one worktree per Kiro session (ADR-002) |
| Toolchain    | npm workspaces, ESLint and Prettier, TypeScript 6, vitest 4, Node 24, Angular 22 (ADR-006)                              |
| Submission   | 1 November 2026 (ADR-003)                                                                                               |
| Open source  | Everything public except security-sensitive and account-specific material (tech.md, "Public and private")               |
