---
inclusion: always
---

# Product: re:Invent Compass

**Plan like a spec. Board like a flight.**

re:Invent Compass helps a first-time AWS re:Invent attendee plan their week from their own code, book it safely, and get into every reserved session on time. It ships as a Kiro Power plus a local MCP server that any desktop MCP client can run. It writes the week as a Kiro spec, guards every booking, and issues unofficial Apple and Google Wallet boarding passes that void when a session is cancelled and expire when it ends.

- Approved build plan (the single source when anything conflicts): #[[file:docs/architecture/build-plan.md]]
- Concept and story: #[[file:CONCEPT.md]]

## Who it is for

1. **Primary: first-time re:Invent attendees.** They do not know the session types, the campus or the rules, and they are overwhelmed by 2,000+ sessions.
2. **Secondary: returning attendees** who want a faster, safer way to plan and move between venues.
3. **Hackathon judges.** They must be able to try it on any device without registering: the showcase site's browser demo and simulated mode.
4. **Contributors.** The repo is public (Apache-2.0).

## The problem we solve

A reserved seat is only held until 10 minutes before the session starts, then it goes to the walk-up line (official re:Invent 2026 FAQ). First-timers lose seats by arriving late, by underestimating walks between hotels, and by skipping meals and rest. Most tools show "Starts 10:30". Compass shows **"Seat released at 10:20"** and the walk from where you are.

## Devices (ADR-005)

- **Plan on a computer.** The Events API signs people in only through a loopback redirect on the machine that started sign-in, so planning and booking run on the attendee's computer: Kiro first, other MCP clients documented.
- **Board on any device.** Phones and tablets get Wallet passes (through a QR hand-off), an `.ics` calendar file, and a responsive offline itinerary page. iPad has no Wallet app, so it uses the calendar file and the itinerary page.
- **Try on any device.** The showcase site runs a click-through demo on made-up sessions, with no install and no sign-in.

## The metaphor (use it in UI copy, docs and code names)

| Airline term | re:Invent meaning |
|---|---|
| Itinerary | The attendee's week (a Kiro spec) |
| Boarding pass | Unofficial pass for one reserved session |
| Gate | Venue and room |
| Boarding closes | Session start minus 10 minutes |
| Connection | Walk between two consecutive commitments |
| Tight connection | Walk time plus buffer is longer than the gap |
| Rebooking | Moving to a repeat of the same session (`-R` in the session code) |
| Standby | Favorites kept as backups |
| Layover | Personal time for meals, water and rest |
| Cancelled flight | A cancelled reservation: its pass is voided |

## Core features

1. **Repo to agenda:** scan the attendee's workspace locally (Terraform, CDK TypeScript, AWS SDK for JavaScript v3, boto3), infer the AWS services they use and how deeply, map them to the catalog's `services` taxonomy, and suggest a level per topic. Only service names and depth leave the scanner; never file contents.
2. **Week as a spec:** generate `.kiro/specs/my-reinvent-week/` (`requirements.md`, `design.md`, `tasks.md`). Each task is one API action the attendee approves. Offer to git-ignore it, because a public repo would publish where the attendee will be and when.
3. **Guardrails:** every write runs `checkReservation` inside the Compass server (connection, boarding time, clash, layover) before it is sent. Kiro hooks run the same check first as defence in depth. Every write is confirmed by reading `GetSchedule` back.
4. **Boarding passes:** Apple Wallet and Google Wallet passes for every reserved session, signed by the attendee-only Compass API.
5. **Send to phone:** a QR code on the computer opens a 15-minute hand-off page on the phone: Add to Apple Wallet, Save to Google Wallet, or download the calendar file.
6. **Pass lifecycle:** a cancelled session's pass is voided (Apple through the PassKit web service and APNs, Google by setting the object `INACTIVE`) and moves to the wallet's expired passes. Every pass expires at its session end. No wallet allows a pass to be deleted remotely: never claim that it does.
7. **Keep in sync:** compare `GetSchedule` with issued passes; issue, update or void. Suggest rebooking when a session is full.
8. **First-timer guide:** plain-English explanations of session types, the 10-minute rule, badge pickup and venues, from official pages only, each with its link.

## Product principles (never break these)

1. **The badge is the ticket.** Every pass says "Unofficial. Your badge is your ticket." Passes have no barcode.
2. **No impersonation.** No AWS logos, colours or wording that suggests an official AWS product. "re:Invent" is used only descriptively.
3. **A human approves every write.** Never reserve, cancel or change anything in the background. No seat polling, sniping or retry loops on reservations. Write tools are never auto-approved.
4. **Local first.** The access and refresh tokens, the catalog cache, the schedule and the code scan stay on the attendee's machine. What leaves: the ID token (to prove sign-in to the Compass API, never stored there) and the printable pass fields.
5. **Minimal, expiring server data.** Pass fields live server-side until session end plus 24 hours (ADR-022); device push tokens are deleted on unregister or at the same time; hand-offs expire in 15 minutes. `forget_me` deletes everything for the caller.
6. **Trust `GetSchedule`.** A 200 response does not mean success. Read per-session results and confirm by reading the schedule back.
7. **Explain every pick.** Every suggested session carries a short, honest reason.
8. **Live data in the product; made-up data in public.** The product always reads the live API. Tests and the public demo use the synthetic catalog (ADR-016) until AWS confirms a real snapshot may be published.
9. **Honest about uncertainty.** If data is missing (for example an empty venue), say so; never invent it.

## Non-goals

- Registering people for re:Invent or linking to registration.
- Anything about other attendees (the API does not expose them, and we do not try).
- Automatic booking, seat watching, or bypassing the official reservation rules.
- A hosted app that signs attendees in (the API does not allow it).
- Note-taking, trip reports, social features.
- On hold: extra scanners beyond the four above, community trail import.

## Voice and copy

- Plain English, short sentences, friendly and calm. Written for someone at their first conference of this size.
- **Never use the em dash or en dash** in any copy, docs, comments, test names or commit messages. Use commas, colons, parentheses or new sentences.
- Times are shown in the event's local time (from `GetEvent`), with the timezone stated once per view.

## Success measures

- Judging criteria (25% each): creativity and novelty, utility for attendees, technical depth and use of the API surface, quality of the Builder Center article.
- All 12 Events API operations used; the official remote MCP server bundled for read exploration.
- A first-timer goes from "Plan my re:Invent" to passes on their phone in under 15 minutes.
- A judge can try the core idea on a phone in under 2 minutes on the showcase site.
