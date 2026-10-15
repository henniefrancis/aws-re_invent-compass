---
inclusion: always
---

# Product: re:Invent Compass

**Plan like a spec. Board like a flight.**

re:Invent Compass is a Kiro Power that helps a first-time AWS re:Invent attendee plan their week from their own code, book it safely, and get into every reserved session on time. It turns the week into a Kiro spec and issues unofficial boarding passes for every reserved seat.

Full concept: #[[file:CONCEPT.md]]

## Who it is for

1. **Primary: first-time re:Invent attendees.** They do not know the session types, the campus or the rules. They are overwhelmed by 2,000+ sessions.
2. **Secondary: returning attendees** who want a faster, safer way to plan and travel between venues.
3. **Hackathon judges.** They must be able to try everything without being registered (simulated mode).

## The problem we solve

A reserved seat is only held until 10 minutes before the session starts, then it is released to the walk-up line (official re:Invent 2026 FAQ). First-timers lose seats by arriving late, by underestimating walks between hotels, and by skipping meals and rest. Most tools show "Starts 10:30". Compass shows **"Seat released at 10:20"** and the walk from where you are.

## The metaphor (use it consistently in UI copy, docs and code names)

| Airline term | re:Invent meaning |
|---|---|
| Itinerary | The attendee's week (a Kiro spec) |
| Boarding pass | Unofficial pass for one reserved session |
| Gate | Venue and room |
| Boarding closes | Session start minus 10 minutes |
| Connection | Walk between two consecutive commitments |
| Tight connection | Walk time plus buffer is longer than the gap |
| Rebooking | Moving to a repeat of the same session (`-R` in the session ID) |
| Standby | Favorites kept as backups |
| Layover | Personal time for meals, water and rest |

## Core features

1. **Repo to agenda:** scan the attendee's workspace locally, infer the AWS services they use and how deeply, map to the catalog's `services` taxonomy, suggest a level per topic.
2. **Week as a spec:** generate `.kiro/specs/my-reinvent-week/` with `requirements.md`, `design.md` and `tasks.md`. Each task is one API action the attendee approves.
3. **Guardrails as hooks:** check every reservation before it is sent (connection, boarding time, clashes, layovers). Re-read the schedule after every write.
4. **Boarding passes:** Apple Wallet and Google Wallet passes for every reserved session, plus an `.ics` fallback with alarms.
5. **Keep in sync:** compare `GetSchedule` with issued passes; reissue or withdraw. Suggest rebooking when a session is full.
6. **First-timer guide:** plain-English explanations of session types, the 10-minute rule, badge pickup and venues, sourced from official pages.

## Product principles (never break these)

1. **The badge is the ticket.** Passes are reminders. Every pass says "Unofficial. Your badge is your ticket."
2. **No impersonation.** No AWS logos, AWS colours, or wording that suggests an official AWS product. The name "re:Invent" is used only descriptively.
3. **A human approves every write.** Never reserve, cancel or change anything in the background. No seat polling, no sniping, no retry loops on reservations.
4. **Local first.** Sign-in, tokens, the catalog cache and code scanning stay on the attendee's machine. The only data that leaves is the text printed on a pass, sent to the pass signer.
5. **Trust `GetSchedule`.** A 200 response does not mean success. Always read per-session results and confirm by reading the schedule back.
6. **Explain every pick.** Every suggested session carries a short, honest reason.
7. **Works without registration.** Simulated mode uses recorded fixtures so anyone can try the full flow.
8. **Honest about uncertainty.** If data is missing (for example an empty venue), say so; never invent it.

## Non-goals

- Registering people for re:Invent or linking to registration.
- Anything about other attendees (the API does not expose them, and we do not try).
- Automatic booking, seat watching, or bypassing the official reservation rules.
- A hosted web app that signs attendees in (the API does not allow it).
- Note-taking, trip reports, social features.

## Voice and copy

- Plain English, short sentences, friendly and calm. Written for someone at their first conference of this size.
- Never use the em dash or en dash in any copy, docs, comments or commit messages. Use commas, colons, parentheses or new sentences.
- Times are always shown in the event's local time (Las Vegas) with the timezone stated once per view.

## Success measures

- Judging criteria (25% each): creativity and novelty, utility for attendees, technical depth and use of the API surface, quality of the Builder Center article.
- All 12 API operations used, across both the REST API and the MCP server.
- A first-timer can go from "Plan my re:Invent" to passes on their phone in under 15 minutes.
