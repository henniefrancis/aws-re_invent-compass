---
name: install-hooks
description: Install the optional Kiro hooks for Reinvent Compass, an extra check before bookings and a block on the remote awsevents write tools. Use when the attendee asks for the hooks or wants the extra safety check.
---

# Install the Compass hooks

Hooks are an extra check that only Kiro runs. The Compass server checks every booking itself, in every client, so nothing is unsafe without the hooks. The hooks add an early check.

## What the hooks do

- Kiro sends every Power tool call as one built-in tool, `kiro_powers`. The first hook matches it, and `pre-write-guardrail` picks out the Compass booking calls inside it. It checks a booking against the schedule Compass last read and the cached catalog, and blocks the call when the guardrail blocks it.
- The second hook blocks the write tools of the remote `awsevents` server (a lower-case pattern, because Kiro matches it against the lower-cased tool name), because bookings must go through Compass.
- A hook can only block (it exits with code 2). Whatever a hook prints when it lets a call through never reaches the agent, so the hooks carry no reminders or warnings. Compass tool results tell the agent when to run `sync_passes`.
- Both hooks read their input from stdin only. They make no network call and start no other program. If a hook cannot judge a call, it says so and lets the call through, because the server checks it again.

## The remote awsevents server

If the attendee also uses the official `awsevents` server, tell them to add it to the workspace `.kiro/settings/mcp.json` (a Power cannot hide its tools) with the seven write tools in `disabledTools` by their full names, each starting `AWSEventsPublicApi-Mcp-prod___`: ReserveSessions, CancelReservation, AssociateFavorites, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime and DeletePersonalTime. A bare name hides nothing. The second hook is a backup. Kiro also needs "Kiro Agent: Configure MCP" set to Enabled in Settings before any MCP server starts.

## How to install

1. Tell the attendee what the two hooks do, in the words above.
2. Show the template at `hook-templates/reinvent-compass.json` in this Power.
3. Ask the attendee clearly whether you may write it to `.kiro/hooks/reinvent-compass.json` in the current workspace. Write nothing until they say yes.
4. After a yes, write that one file. Never edit any other hook file, and never overwrite an existing `reinvent-compass.json` without showing the attendee the difference first.
5. Tell the attendee to reload the window, and that they can delete the file at any time to remove the hooks.

## Notes

- The commands in the template run `npx --yes reinvent-compass@0.0.0 hook <name>`. The version is written into the template, and it matches the server in this Power.
- A hook has a 30 second limit. A blocked call gives its reason to the agent, which should pass it on to the attendee in plain words.
- If a hook cannot judge a call, it lets it through, and the server still checks it.
