# Proposed wording: read-only by default

Proposals for the owner's drafts, `README.md` and `docs/article/builder-center-draft.md`. These drafts are the owner's, so nothing here has been applied. Each item names the current text and gives replacement text to paste. Line numbers are from the drafts as of 20 October.

Facts the wording rests on (all in the code since compass-power task 40):

- In live mode Compass is read-only unless `COMPASS_ALLOW_WRITES=1` is set in the environment of the Compass MCP server. Every Events API write is refused before any request.
- The five schedule tools (`reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby`, `add_layover`) still run the guardrail and reply with what they would have done, that nothing changed, and that the change can be made in the re:Invent app.
- Boarding passes still work in read-only mode: they live on the Compass pass service, not in the re:Invent schedule.
- With writes on, every schedule reply starts with "Writes are on". Simulated mode is never read-only.
- There are 18 tools: `show_schedule` was added.
- The pass front shows SESSION, TERMINAL, GATE, FLIGHT NAME, DATE and BOARDING CLOSES; the back shows the full room, the walk from the previous session, the next connection, the time zone, the notice and the about line. The front no longer says "Seat released at".
- The PostToolUse sync hook was removed (ADR-024); only the PreToolUse guardrail hook ships.

## README.md

**Line 5** (summary). Replace "book it safely" so the first claim is true by default:

> re:Invent Compass helps a first-time AWS re:Invent attendee plan their week from their own code, check every booking against the walks and clashes before it happens, and get into every reserved session on time.

**Line 7.** Replace "checks every booking before it is sent" with:

> It writes your week as a Kiro spec, reads your real re:Invent schedule without ever changing it unless you turn writes on, checks every booking against the guardrail, and issues unofficial Apple Wallet and Google Wallet boarding passes that void when a session is cancelled and expire when it ends.

**Lines 18 and 116.** "The 17 tools" becomes "The 18 tools" (both the contents link `#the-18-tools` and the heading). Add this row after `check_itinerary` in the table:

> | `show_schedule` | read | Shows your reserved sessions, standby list and layovers, with the ids the other tools take. |

**Line 112.** Replace "Run `refresh_catalog`, then plan, check and book. Every write asks for your approval." with:

> 4. Run `refresh_catalog`, then plan and check. Compass is read-only by default: it reads your real schedule, and the booking tools tell you what they would do and that you make the change in the re:Invent app. See [Read-only by default](#read-only-by-default).

**New section after step 4 of Live mode** (before "Boarding passes in live mode need..."):

> ### Read-only by default
>
> Signed in with your Builder ID, Compass reads the live catalog and your real reservations, standby list and layovers. It never changes them unless you turn writes on yourself. Until then the five schedule tools run the guardrail and reply with what they would have done, and every Events API write is refused before any request is sent, so nothing can change your schedule by accident. Boarding passes still work, because they live on the Compass pass service.
>
> To let Compass make changes, each one still approved by you first, set `COMPASS_ALLOW_WRITES=1` in the `env` of the Compass MCP server in your client's MCP settings. While writes are on, every schedule reply starts with "Writes are on". Details are in [packages/mcp-server/README.md](packages/mcp-server/README.md#read-only-by-default).

**Lines 128 to 132** (the five schedule rows). Replace "Changes your real schedule." in each with "Changes your real schedule when writes are on." Example:

> | `reserve_with_guardrails` | write | Reserves 1 to 10 sessions after the guardrail passes. Changes your real schedule when writes are on. |

**Line 138** (Approvals). Add one sentence at the start:

> **Approvals.** In live mode the schedule tools change nothing until you set `COMPASS_ALLOW_WRITES=1`.

**Line 165** (official remote MCP server). The Power still does not bundle it; add the read-only point:

> - **The official remote MCP server.** AWS publishes its own MCP server at `https://api.awsevents.com/mcp`. It is fine for reading, but its write tools skip both the Compass guardrail and the Compass read-only setting. The Kiro hook template blocks writes through it. The Power does not bundle it yet, because it is not yet confirmed that a Power's `mcp.json` honours `disabledTools`.

**Line 184** (Hooks). The PostToolUse hook was removed:

> **Hooks (Kiro only).** The `install-hooks` skill writes a hook file to `.kiro/hooks/` after you say yes. Before a Compass write, a PreToolUse hook runs the same check and blocks the call when the guardrail blocks it. Hooks are defence in depth: the server checks every booking again, and in read-only mode it changes nothing at all.

**Line 186** (Prompt injection). Add one sentence:

> A second test proves the same in read-only mode: the injected reservation is refused before any request.

**Lines 57 and 192** (what a pass shows). Replace with:

> Each pass shows the session code, the venue as the terminal, the room as the gate, the session title, the date and time, and **Boarding closes** (10 minutes before the start). The back shows the full room, the walk from the previous session and the next connection.

## Article draft

**Line 7** (hero screenshot note). Replace `showing "Seat released at"` with `showing "Boarding closes"`.

**Line 15.** The idea still stands; align the name with the pass: replace "Seat released at 10:20" with "boarding closes at 10:20".

**Line 66** (after "there is no background booking or seat sniping."). Add a paragraph:

> Then I signed in with my own Builder ID to test on real data, and decided Compass should not be able to change my schedule by accident at all. So it is read-only by default. It reads the live catalog and my real reservations, runs the guardrail, and the booking tools say what they would have done and that nothing changed. Every Events API write is refused in the adapter, before any request. An attendee who wants Compass to book sets one environment variable, and from then on every schedule reply starts with "Writes are on". Boarding passes still work, because they live on my own pass service.

**Line 88.** Replace "The main field is "Seat released at"." with:

> The pass reads like a boarding pass: the venue is the terminal, the room is the gate, the title is the flight name, and "Boarding closes" sits next to the date.

**Line 127.** "17 tools" becomes "18 tools, read-only by default on real data".

**Line 131.** Six modules is still right. "five runbooks" becomes "ten runbooks" (`docs/runbooks` has alarms, first-deploy-notes, google-class, google-wallet-setup, kill-switch, npm-release, release, rollback, secrets and teardown), and the Route 53 domain registration can be added: "Terraform for everything, including the domain registration: six modules, dev and prod, native tests and ten runbooks."

## Hackathon rules row 3

The README needs a plain dependencies heading before submission. Proposed section, after "Quick start" or as its first subsection:

> ### Requirements
>
> - Node.js 24 or later (`npx` comes with it).
> - Kiro, or another desktop MCP client that runs stdio servers.
> - For live mode: an AWS Builder ID registered for re:Invent 2026. Simulated mode and the demo need no account.
> - For boarding passes on a phone: Apple Wallet on iPhone or Google Wallet on Android.

Once it is in the README, row 3 of `docs/hackathon-rules.md` can be marked Met.
