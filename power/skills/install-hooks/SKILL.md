---
name: install-hooks
description: Install the optional Kiro hooks for Reinvent Compass, an extra check before bookings and a reminder to sync boarding passes. Use when the attendee asks for the hooks or wants the extra safety check.
---

# Install the Compass hooks

Hooks are an extra check that only Kiro runs. The Compass server checks every booking itself, in every client, so nothing is unsafe without the hooks. The hooks add an early warning and a reminder.

## What the hooks do

- Before a Compass write tool runs, `pre-write-guardrail` checks a booking against the schedule Compass last read and the cached catalog. It blocks the call when the guardrail blocks it. It also blocks any write through the remote `awsevents` server, because bookings must go through Compass.
- After a schedule change, `post-write-sync` reminds the agent to run `sync_passes`.
- Both hooks read their input from stdin only. They make no network call and start no other program. If a hook cannot judge a call, it says so and lets the call through, because the server checks it again.

## How to install

1. Tell the attendee what the two hooks do, in the words above.
2. Show the template at `hook-templates/reinvent-compass.json` in this Power.
3. Ask the attendee clearly whether you may write it to `.kiro/hooks/reinvent-compass.json` in the current workspace. Write nothing until they say yes.
4. After a yes, write that one file. Never edit any other hook file, and never overwrite an existing `reinvent-compass.json` without showing the attendee the difference first.
5. Tell the attendee to reload the window, and that they can delete the file at any time to remove the hooks.

## Notes

- The commands in the template run `npx --yes reinvent-compass@<version> hook <name>`. The version is written into the template, and it matches the server in this Power.
- A hook has a 30 second limit. A blocked call prints its reason, and the agent should pass that reason on to the attendee in plain words.
- If the attendee sees a hook note saying Compass could not check a call, nothing is wrong. The server still checks it.
