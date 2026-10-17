---
name: 'reinvent-compass'
displayName: 'Reinvent Compass'
description: 'Plan your AWS re:Invent week from your own code, book it safely with guardrails, and get unofficial boarding passes on your phone. Independent community project, not affiliated with AWS.'
keywords:
  ['reinvent', 're:Invent', 'conference', 'sessions', 'schedule', 'boarding pass', 'first-timer']
author: 'Hennie Francis'
---

# Reinvent Compass

Unofficial. Your badge is your ticket. Reinvent Compass is an independent community project and is not affiliated with AWS or Amazon.

This power is the same power that `plugin.json` describes. `plugin.json`, `mcp.json` and `skills/` are the primary files; this file is here so that Kiro can find the power whichever manifest it looks for first, and the two always agree.

## What it does

- Reads the re:Invent session catalog and searches it on your machine.
- Scans a folder of yours, read-only, to see which AWS services you use and how deeply.
- Plans a week of sessions and writes the plan as a Kiro spec in your workspace, after you confirm the folder.
- Checks every booking against your real schedule before it is made, and blocks clashes.
- Swaps a booking for its repeat safely: it reserves the repeat first and cancels the original after.
- Issues unofficial boarding passes and hands them to your phone with a 15 minute link and QR code.

## Skills

- `plan-my-week`: the order of the tools, one approval per write, and the rules that do not bend.
- `first-timer-guide`: plain-English notes for first-time attendees, each with the official page it came from.
- `install-hooks`: an optional extra check that only Kiro runs. The Compass server checks every booking itself.

## The MCP server

The `compass` server starts with `npx --yes reinvent-compass@<version>`; the version is written into `mcp.json` and is the same as `plugin.json`. Do not add the write tools of the remote `awsevents` server to your agent: they skip the guardrail.

## Approvals

Only the four read tools may be auto-approved: `refresh_catalog`, `find_sessions`, `scan_repo` and `check_itinerary`. Never auto-approve a write tool: `reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby`, `add_layover`, `issue_boarding_passes`, `send_to_phone`, `sync_passes` or `forget_me`. `sync_passes` can void passes, so it is a write tool.

## Try it without an account

Run `npx --yes reinvent-compass@<version> demo` to see the whole flow on made-up data, with no network and no sign-in.
