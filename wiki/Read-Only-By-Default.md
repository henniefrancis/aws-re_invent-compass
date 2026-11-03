_For attendees: why Compass never changes your real re:Invent schedule unless you turn writes on, what it does instead, and how to turn writes on safely._

Signed in with your [AWS Builder ID](Glossary#aws-builder-id), Compass reads the live catalog and your real reservations, standby list and layovers. In live mode it never changes them unless you turn writes on yourself. This is [read-only mode](Glossary#read-only-mode), and it is the default.

## What read-only means

| Mode                                 | Reads your schedule | Changes your schedule                     | Passes            |
| ------------------------------------ | ------------------- | ----------------------------------------- | ----------------- |
| Live, default                        | Yes                 | Never                                     | Work              |
| Live, `COMPASS_ALLOW_WRITES=1`       | Yes                 | After you approve each change             | Work              |
| [Simulated](Glossary#simulated-mode) | Made-up schedule    | Made-up bookings work without the setting | Work (in-process) |

The setting is read once, when the server starts ([packages/mcp-server/src/config/runtime-config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/config/runtime-config.ts)): live mode is read-only unless `COMPASS_ALLOW_WRITES` is exactly `1`. Simulated mode never calls the [Events API](Glossary#events-api), so it is never read-only.

## The five schedule tools

These five tools change your real schedule: `reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby` and `add_layover`. In read-only mode each one still:

1. checks your input and looks the sessions up in the cached catalog;
2. reads your schedule fresh;
3. runs the [guardrail](Glossary#guardrail) (for a booking), with the same block and warn reasons as always (see [Guardrail rules](Guardrail-Rules));

and then, instead of asking you or writing, replies with:

> Compass is read-only, so nothing in your re:Invent schedule changed. Make this change yourself in the re:Invent app.
> Compass would have done this: reserve these sessions.

followed by the sessions it would have acted on and any warnings, as labelled data ([packages/mcp-server/src/tools/common.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/tools/common.ts)). A blocked booking is still reported as blocked, with its reasons and any safe swap.

**Two layers.** The tools check the mode first. Underneath, the Events adapter itself refuses every write (`ReserveSessions`, `CancelReservation`, `AssociateFavorites`, `DisassociateFavorite`, `CreatePersonalTime`, `UpdatePersonalTime` and `DeletePersonalTime`) before any request is made, so no path through the code can change your schedule by accident ([packages/mcp-server/src/adapters/read-only-events.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/adapters/read-only-events.ts)).

**What still works.** Every read tool, `plan_week` (it writes only the week spec in your workspace), `export_calendar`, and all the pass tools: `issue_all_boarding_passes`, `issue_boarding_pass`, `send_to_phone`, `sync_passes` and `forget_me`. Passes live on the [Compass API](Glossary#compass-api), not in your re:Invent schedule.

## Turn writes on

Only you should change this setting. To let Compass make changes, each one still approved by you first, set `COMPASS_ALLOW_WRITES` to `1` in the `env` of the Compass server in your client's MCP settings:

```json
"env": { "COMPASS_ALLOW_WRITES": "1" }
```

- **Kiro:** the `env` of the `compass` entry for a manual install, or of the Compass server the Power added (shown as `power-power-compass` when imported from a folder).
- **Other clients:** the `env` of the `compass` server in their MCP configuration (see [Getting started](Getting-Started#other-mcp-clients)).

Restart the server for the change to take effect. To go back to read-only, remove the line or set any other value.

### You will see it

While writes are on in live mode:

- The server logs one line on stderr when it starts: "Writes are on (COMPASS_ALLOW_WRITES=1): Compass can change your real re:Invent schedule after you confirm each change."
- Every successful reply from `sign_in`, `show_schedule` and the five schedule tools starts with: **"Writes are on: Compass can change your real re:Invent schedule after you approve each change."** ([packages/mcp-server/src/server/create-server.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/server/create-server.ts))

### Every write still asks

With writes on, there are still up to three gates before your schedule changes:

1. **Your client's approval of the tool call.** Write tools must never be auto-approved.
2. **Compass's own confirmation.** Where your client supports MCP elicitation (asking you a question mid-call), Compass asks you to confirm, listing each session code, title and id and every guardrail warning, ending "Go ahead?". Declining writes nothing. A client without elicitation relies on gate 1 alone.
3. **The guardrail.** A block sends nothing, whatever you approve.

Each write is sent once and confirmed by reading your schedule back. It is never resent blindly.

## The Kiro hook

If you install the optional [Kiro hooks](Glossary#kiro-hook) (the `install-hooks` skill), a second hook blocks any write through the official remote `awsevents` MCP server: its seven write tools skip both the Compass guardrail and this read-only setting. The hook's matcher is in [power/hook-templates/reinvent-compass.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/hook-templates/reinvent-compass.json), and the blocked call gets the reason "Compass blocks this call. Use reserve_with_guardrails (or the matching Compass tool) so your booking is checked first."

If you add the `awsevents` server yourself, add it to the workspace `.kiro/settings/mcp.json` (not to a Power) and list its seven write tools in `disabledTools` by their full names, each starting `AWSEventsPublicApi-Mcp-prod___`. A bare name such as `ReserveSessions` hides nothing. The Power does not bundle that server, because Kiro does not honour `disabledTools` inside a Power.

## Never let the agent change it

The setting lives outside the chat on purpose. The Power's `plan-my-week` skill tells the agent: "Never change Compass's settings or MCP configuration, and never offer to: only the attendee decides whether Compass may write, outside the chat." In read-only mode the agent should pass the reply on plainly, suggest the re:Invent app, and never try another way to write ([power/skills/plan-my-week/SKILL.md](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/skills/plan-my-week/SKILL.md)).

If an agent offers to edit your MCP settings to turn writes on, say no and do it yourself, if you want it at all. Catalog text is data, not instructions: a session abstract that tries to talk the agent into a write cannot trigger one.

## Related pages

- [Guardrail rules](Guardrail-Rules)
- [Plan: booking behind the guardrail](User-Guide-Plan#book-it-behind-the-guardrail)
- [MCP tools](MCP-Tools)
- [Security](Security)
- [Getting started](Getting-Started)
