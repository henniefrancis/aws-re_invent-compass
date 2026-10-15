# ADR-017 Remote awsevents server read-only

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

The Power bundles the official `awsevents` remote MCP server, which can also write to the attendee's schedule. If the agent books through it, the Compass guardrails are bypassed. Prompt injection through session abstracts or repo files could lead to unwanted bookings (R6).

## Decision

- The Power's `mcp.json` lists the Compass local server and the official `awsevents` remote server. The remote server is used for **read exploration only**.
- Its write tools are listed in `disabledTools`. A PreToolUse hook on `@awsevents` write tools is the backup.
- **All writes go through Compass** (`reserve_with_guardrails`, `cancel_reservation`, standby and layover tools), which run `checkReservation` inside the server.
- Write tools are never in `autoApprove`; a human approves each call. Read tools may be auto-approved.
- The Kiro PreToolUse hook calls the same check first, as defence in depth. The hook is a convenience, not the control.

## Consequences

- Spike SP1 checks whether `disabledTools` works for a Power's remote server and how hooks block a call. If hooks cannot block, they warn only.
- Catalog text is returned to the agent as labelled data; the scanner returns counts, not file text.

## Source

- re:Invent Compass build plan sections 3.1, 3.3, 4.3, 8 (S3), 8.1, 10 (SP1), 13 (R6).
- [Kiro MCP configuration](https://kiro.dev/docs/mcp/configuration/), [Kiro hook types](https://kiro.dev/docs/hooks/types/), [Kiro hooks](https://kiro.dev/docs/hooks/).
