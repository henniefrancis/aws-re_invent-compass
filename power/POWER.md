---
name: 'reinvent-compass'
displayName: 'Reinvent Compass'
description: 'Plan your AWS re:Invent week from your own code, book it safely with guardrails, and get unofficial Boarding Passes on your phone. Independent community project, not affiliated with AWS.'
keywords:
  ['reinvent', 're:Invent', 'conference', 'sessions', 'schedule', 'boarding pass', 'first-timer']
author: 'Hennie Francis'
---

# Reinvent Compass

Unofficial. Your badge is your ticket. Reinvent Compass is an independent community project and is not affiliated with AWS or Amazon.

This power is the same power that `plugin.json` describes. `plugin.json`, `mcp.json` and `skills/` are the primary files; this file is here so that Kiro can find the power whichever manifest it looks for first, and the two always agree.

## What it does

- Reads the re:Invent session catalog and searches it on your machine.
- Scans a folder of yours, or a dev folder of git repositories, read-only, to see which AWS services you use and how deeply, and which other technology you use (.NET, Node.js, Python, React and more).
- Reads your GitHub repositories the same way, through a read-only GitHub App, only after you confirm the list.
- Keeps that tech list on your machine, tells you what tech you work on the most, and finds sessions on a technology.
- Plans a week of sessions and writes the plan as a Kiro spec in your workspace, after you confirm the folder.
- Checks every booking against your real schedule before it is made, and blocks clashes.
- Swaps a booking for its repeat safely: it reserves the repeat first and cancels the original after.
- Issues unofficial Boarding Passes and hands them to your phone with a 15 minute link and QR code.

## Skills

- `plan-my-week`: the order of the tools, one approval per write, and the rules that do not bend.
- `first-timer-guide`: plain-English notes for first-time attendees, each with the official page it came from.
- `install-hooks`: an optional extra check that only Kiro runs. The Compass server checks every booking itself.

## The MCP server

The `compass` server starts with `npx --yes reinvent-compass@0.0.0`; the version is written into `mcp.json` and is the same as `plugin.json`. Kiro starts no MCP server until you allow it: in Settings, set "Kiro Agent: Configure MCP" to Enabled. A folder import of this Power names the server `power-power-compass`. Do not add the write tools of the remote `awsevents` server to your agent: they skip the guardrail. If you add that server to your workspace `.kiro/settings/mcp.json`, list the seven write tools in `disabledTools` by their full names: `AWSEventsPublicApi-Mcp-prod___ReserveSessions`, `AWSEventsPublicApi-Mcp-prod___CancelReservation`, `AWSEventsPublicApi-Mcp-prod___AssociateFavorites`, `AWSEventsPublicApi-Mcp-prod___DisassociateFavorite`, `AWSEventsPublicApi-Mcp-prod___CreatePersonalTime`, `AWSEventsPublicApi-Mcp-prod___UpdatePersonalTime` and `AWSEventsPublicApi-Mcp-prod___DeletePersonalTime`. A bare name hides nothing.

## Approvals

Only three read tools may be auto-approved: `refresh_catalog`, `find_sessions` and `check_itinerary`. `scan_repo` reads a folder of yours, so approve each scan. `show_my_tech` and `find_sessions_by_tech` read your tech list, and `connect_github`, `scan_github` and `disconnect_github` touch your GitHub account, so approve each call; `scan_github` also asks you to confirm the repositories first. `show_schedule` reads your schedule, so approve each call: it takes no input and lists your reserved sessions, standby list and layovers with the ids the write tools take. Never auto-approve a write tool: `reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby`, `add_layover`, `issue_all_boarding_passes`, `issue_boarding_pass`, `send_to_phone`, `sync_passes` or `forget_me`. `sync_passes` can void passes, so it is a write tool. `add_layover` takes an `action` of `create`, `update` or `delete` (the last two need the `personalTimeId` that `show_schedule` lists), and each one asks you to confirm.

## Read-only by default

Compass reads your real schedule and the live catalog but never changes your re:Invent schedule unless you turn writes on yourself. Until then, every booking tool answers what it would do instead of doing it, and you make the change in the re:Invent app. Passes still work. How to turn writes on is in the MCP server README, "Read-only by default".

## Passes on your phone

When the attendee asks for passes for their sessions, or all their passes, call `issue_all_boarding_passes` once: approving that one call is the only confirmation, for every reserved session. Never call it once per session. For one session, call `issue_boarding_pass` with its id or code, one approval per pass; without one, Compass asks which reserved session.

Before `send_to_phone`, ask the attendee "Link or QR code?" unless they already said, and pass their answer as `show` (`link`, `qr` or `both`). A QR code opens on a page in their browser on this computer, for their phone camera to scan; the chat then shows no link. If the browser cannot open, the QR code comes back in the chat instead. Without `show`, `send_to_phone` creates nothing and asks.

## Try it without an account

Run `npx --yes reinvent-compass@0.0.0 demo` to see the whole flow on made-up data, with no network and no sign-in.
