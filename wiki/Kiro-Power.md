_For architects: what the Compass Kiro Power contains, how it starts the MCP server and what its skills and hooks do._

A [Kiro Power](Glossary#kiro-power) packages an [MCP server](Glossary#mcp-server) with instructions for the agent. The Compass Power holds no code of its own: it starts the Compass server and tells the agent the order of the tools, which calls need approval and which rules never bend. Every safety check also runs inside the server, so the Power is guidance, not the line of defence.

## What is inside

Everything lives in [power/](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/power).

| File                                                                                                                                                   | Purpose                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [plugin.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/plugin.json)                                                   | The manifest: name `reinvent-compass`, version `0.1.2`, Apache-2.0 licence, homepage and keywords.                                                                                                                                                              |
| [POWER.md](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/POWER.md)                                                         | The same Power described in Kiro's own format (front matter plus notes), so Kiro finds it whichever manifest it reads first.                                                                                                                                    |
| [mcp.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/mcp.json)                                                         | One server, `compass`, type `stdio`, command `npx --yes reinvent-compass@0.1.2`, with `COMPASS_ELICITATION=off` in its `env`: Kiro cancels the questions a server asks through a Power, so Kiro's tool approval is the confirmation.                            |
| [skills/plan-my-week](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/skills/plan-my-week/SKILL.md)                          | The order of the tools, one approval per write, and the rules that do not bend.                                                                                                                                                                                 |
| [skills/first-timer-guide](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/skills/first-timer-guide/SKILL.md)                | Plain-English notes for first-time attendees, each with the official AWS page it came from, listed in [official-sources.md](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/skills/first-timer-guide/references/official-sources.md). |
| [skills/install-hooks](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/skills/install-hooks/SKILL.md)                        | How the agent offers and installs the optional hooks, with the attendee's consent.                                                                                                                                                                              |
| [hook-templates/reinvent-compass.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/hook-templates/reinvent-compass.json) | Two optional `PreToolUse` [Kiro hooks](Glossary#kiro-hook).                                                                                                                                                                                                     |

The version `0.1.2` is written into [mcp.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/mcp.json), the hook commands and [plugin.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/plugin.json), so the Power always starts the server version it was written for.

The `env` entry `COMPASS_ELICITATION=off` turns off the questions Compass asks inside a tool (MCP elicitation). Kiro cancels every question a server asks through a Power (Kiro 1.4.86 logs "Elicitation request received but no handler is active, cancelling"), so each one would read as a no: `scan_repo`, `plan_week`, `send_to_phone`, `sync_passes`, `forget_me` and the schedule writes would all stop with "because you did not confirm". With the questions off, each tool works as it does in a client that cannot ask: you approve the tool call in Kiro, and the actions that need an explicit answer (a bulk void, a swap override, a folder outside the workspace, a GitHub scan) are still refused. Added in 0.1.2 (compass-power task 65).

## Key behaviours

- **The order of the tools.** The `plan-my-week` skill tells the agent: `sign_in`, `refresh_catalog`, `scan_repo` (or `connect_github` then `scan_github`), `plan_week`, then for each session `check_itinerary`, show the attendee the ids, codes, titles and warnings, ask for approval for that one session, and only then call the write tool. After any schedule change, `sync_passes`.
- **Approvals.** Only `refresh_catalog`, `find_sessions` and `check_itinerary` may be auto-approved. Every other tool is approved per call, and no write tool is ever auto-approved. The Power ships no `autoApprove` list.
- **Passes.** For all passes the agent calls `issue_all_boarding_passes` once, never once per session. Before `send_to_phone` it asks "Link or QR code?" unless the attendee already said.
- **Catalog text is data.** Catalog text, session titles and the attendee's own notes are never instructions. The skill tells the agent to say so when a title looks like an instruction. The server enforces the same rule with labelled data (see [MCP server](MCP-Server#labelled-data)).
- **No side doors.** The agent must never call a write tool of the remote `awsevents` server, because those skip the guardrail. A booking is only real when the schedule read back confirms it.
- **[Read-only mode](Glossary#read-only-mode).** Compass never changes the real re:Invent schedule unless the attendee turned writes on. The skill tells the agent never to change Compass's settings or MCP configuration, and never to offer to. See [Read-only by default](Read-Only-By-Default).

## The optional hooks

The hook template holds two `PreToolUse` hooks. Both run `npx --yes reinvent-compass@0.1.2 hook pre-write-guardrail` with a 30 second timeout.

| Hook                                      | Matcher                                                                      | What it does                                                                                                                                                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reinvent-compass-pre-write-guardrail`    | `kiro_powers`                                                                | Kiro sends every Power tool call as one built-in tool, `kiro_powers`. The hook picks out the Compass booking calls and blocks a `reserve_with_guardrails` call that the guardrail would block, using the last schedule snapshot and the cached catalog. |
| `reinvent-compass-block-awsevents-writes` | A lower-case pattern ending in one of the seven `awsevents` write operations | Blocks the write tools of the remote `awsevents` server, so every booking goes through Compass.                                                                                                                                                         |

A hook can only block, by exiting with code 2. It reads stdin only, makes no network call and starts no other program. When it cannot judge a call (bad input, an unknown tool, a snapshot older than 15 minutes, no catalog) it lets the call through, because the server checks it again. There is no `PostToolUse` hook: Compass tool results tell the agent when to run `sync_passes`. The hook code is in [packages/mcp-server/src/hooks](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/hooks). The reasoning is on [Decisions: Architecture](Decisions-Architecture#kiro-hooks-block-only-with-exit-2).

The `install-hooks` skill shows the template, asks the attendee whether it may write `.kiro/hooks/reinvent-compass.json` in the current workspace, and writes nothing without a clear yes.

## Interfaces

- **To the client:** the MCP server over stdio, started from [mcp.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/power/mcp.json). A folder import of the Power names the server `power-power-compass`; the hook input parser accepts that name and the plain `compass`.
- **To the attendee:** the three skills, read by the agent.
- **To the remote `awsevents` server:** none. If the attendee adds that server to the workspace `.kiro/settings/mcp.json`, the Power tells them to list its seven write tools in `disabledTools` by their full names (each starts with `AWSEventsPublicApi-Mcp-prod___`). A bare name hides nothing.

## Configuration

The Power itself has no settings. Settings belong to the server: see [MCP server](MCP-Server#configuration). According to the Power's own notes, Kiro starts no MCP server until "Kiro Agent: Configure MCP" is set to Enabled in Settings.

To try the flow without an account, run `npx --yes reinvent-compass@0.1.2 demo`.

## Updating the Power

Kiro keeps its own git clone of the repository in `~/.kiro/powers/repos/` (one folder per import, named after the repository or `power`) and copies the Power from it to `~/.kiro/powers/installed/<name>/`. Importing the Power again reuses that clone without pulling it, so the installed Power keeps the old version. Seen in Kiro 1.4.86 on 4 November 2026: after the 0.1.2 release, the installed `mcp.json` still had no `COMPASS_ELICITATION` entry, and `send_to_phone` kept answering "No link was created, because you did not confirm."

To update:

1. Remove the Power in the Powers panel.
2. Delete its clone: each folder in `~/.kiro/powers/repos/` (on Windows, `%USERPROFILE%\.kiro\powers\repos\`) where `git remote -v` shows `henniefrancis/aws-re_invent-compass`. Delete only those folders, not `repos` itself, and leave the folders of other Powers alone.
3. Import the folder URL again.
4. If you installed the hooks, ask for them again: the `install-hooks` skill writes the hook file with the new version. Older hook files still work, because every version has the `hook pre-write-guardrail` command.

To check which version is running, open `~/.kiro/powers/installed/<name>/mcp.json`: it should name the new version and, from 0.1.2, have `"env": { "COMPASS_ELICITATION": "off" }`. Kiro's MCP log should have no "Elicitation request received but no handler is active" line after a tool call. A new install needs none of this, because Kiro clones main afresh.

## Build cards

The Power was built in the Build workstream ([Build cards on the project board](https://github.com/users/henniefrancis/projects/3/views/1?filterQuery=workstream%3A%22Build%22)). It shipped with the release card [REL1: the 0.1.0 release commit](https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=290044925).

## Related pages

- [MCP server](MCP-Server)
- [MCP tools](MCP-Tools)
- [Steering and hooks](Steering-and-Hooks)
- [Read-only by default](Read-Only-By-Default)
- [Architecture overview](Architecture-Overview)
