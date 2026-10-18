# ADR-024 Kiro hook input and blocking (SP1 result)

Status: Accepted, 2026-10-18 (owner, spike SP1 on Kiro IDE 1.3.11, Windows). Checklist steps 12 to 14 (the real "Import power from GitHub") are pending: GitHub `main` has no `power/` folder until develop is merged and pushed.

## Context

The compass-power design (`.kiro/specs/compass-power/design.md`, section SP1) built the hooks on six assumptions taken from the Kiro documentation (A-SP1-1 to A-SP1-6), with the in-server guardrail as the control. SP1 checks them on the real product. The owner ran a toy Power (`sp1-probe`, tools `ProbeRead` and `ProbeWrite`, imported from a folder) and workspace command hooks that log their stdin and exit with a chosen code, plus the official `awsevents` remote server. No token or personal value was recorded.

Kiro had MCP switched off (`kiroAgent.configureMCP` set to `Disabled`); no MCP server starts until it is enabled in Settings.

## Findings

### Hook input (A-SP1-1)

Every hook receives one JSON object on stdin with `session_id`, `hook_event_name`, `cwd`, `tool_name` and `tool_input`; PostToolUse adds `tool_response`. The hook runs in the workspace root.

**A Power's tools are not called under their own names.** Kiro routes every call to any Power tool through one built-in tool, `kiro_powers`. The real tool is inside `tool_input`:

```json
{
  "hook_event_name": "PreToolUse",
  "cwd": "<workspace>",
  "session_id": "<redacted>",
  "tool_name": "kiro_powers",
  "tool_input": {
    "action": "use",
    "powerName": "power",
    "serverName": "sp1-probe",
    "toolName": "ProbeWrite",
    "arguments": { "sessionIds": ["S1", "S2"] },
    "steeringFile": null,
    "skillName": null
  }
}
```

The first call of a session is `{"action":"activate","powerName":"power","serverName":null,"toolName":null,"arguments":null,...}`. Deferred tool loading is a separate built-in tool, `tool_load`, with `{"tool_ids":["awsevents::AWSEventsPublicApi-Mcp-prod___GetEvent"]}`.

Tools of an MCP server configured in the workspace (`.kiro/settings/mcp.json`) arrive as `mcp_<server>_<tool>`, **lower-cased, with every non-alphanumeric character turned into an underscore**: `mcp_awsevents_awseventspublicapi_mcp_prod___getevent`.

### Blocking and output (A-SP1-2, A-SP1-3)

| Hook                                  | Exit | Result                                                                                                                                                                 |
| ------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PreToolUse on `ProbeWrite`            | 2    | The call did not run. The agent received the hook's stderr and reported it. The chat shows a "Run Command Hook" card for each hook.                                    |
| PreToolUse on `ProbeRead`             | 1    | **Not a block.** The call ran normally; the agent mentioned no hook output. This settles the documentation conflict in favour of the IDE 1.0 page: only exit 2 blocks. |
| PreToolUse on `GetEvent` (five hooks) | 0    | The call ran. **Neither stdout nor stderr reached the agent**; asked to quote the hook text, it found none.                                                            |
| PostToolUse on `GetEvent`             | 2    | The call had already completed and its result reached the agent; the hook's stderr did not. PostToolUse cannot block.                                                  |

### Matchers (A-SP1-4)

| Matcher                                                      | Fired for a Power tool (`kiro_powers`) | Fired for the workspace `awsevents` tool                                             |
| ------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `kiro_powers`                                                | yes (also on `activate`)               | no                                                                                   |
| `@powers`                                                    | yes (also on `activate`)               | no                                                                                   |
| `@power` (the power's name)                                  | no                                     | no                                                                                   |
| `@sp1-probe/ProbeWrite`, `@power-power-sp1-probe/ProbeWrite` | no                                     | no                                                                                   |
| `.*ProbeWrite$`                                              | no                                     | no                                                                                   |
| `@mcp`                                                       | no                                     | yes                                                                                  |
| `@awsevents`                                                 | no                                     | yes                                                                                  |
| `@awsevents/AWSEventsPublicApi-Mcp-prod___GetEvent`          | no                                     | yes                                                                                  |
| `.*getevent$`                                                | no                                     | yes                                                                                  |
| `.*GetEvent$`                                                | no                                     | **no** (regular expressions are matched case-sensitively against the lower-cased id) |

### Power packaging (A-SP1-5, A-SP1-6) and the server

- **A Power cannot ship hooks.** A PostToolUse hook in the power's `hooks/sp1.json` never ran, also after the re-import copied `hooks/` into the installed power.
- **The power is registered under its folder name.** Importing the folder `power/` registered the power as `power` and its servers as `power-power-sp1-probe` and `power-power-awsevents`, whatever `plugin.json` and `POWER.md` say. The first import copied `POWER.md`, `mcp.json` and an empty `steering/` and showed the `POWER.md` display name; a re-import also copied `plugin.json` and `hooks/`, and activation then reported the name and description from `plugin.json`.
- **`awsevents` inside a Power:** the first import kept the entry with `oauth` and `disabledTools`, connected, and listed all 12 tools. The re-import skipped it: "the MCP server configuration is not valid, so this server was skipped" (the Agent Plugins remote variant allows only `type`, `url` and `headers`).
- **The official server's tool names carry a prefix:** `AWSEventsPublicApi-Mcp-prod___<Operation>`, for example `AWSEventsPublicApi-Mcp-prod___ReserveSessions`. In the workspace `.kiro/settings/mcp.json`, `disabledTools` hid `AWSEventsPublicApi-Mcp-prod___ReserveSessions` but **not** the bare `CancelReservation`. A bare name in the Power also hid nothing.
- **The Power's stdio server never starts in the workspace.** Its working directory was the Kiro install folder (`%LOCALAPPDATA%\Programs\Kiro`) after the first import and the installed power folder (`~/.kiro/powers/installed/<name>`) after the re-import. `npx reinvent-compass@X` therefore cannot pick up a package copy inside the attendee's project (CTO review L3).

## Decision

1. **Hooks block with exit 2 only.** `hooks/exit-policy.ts` stays as it is: a block exits 2, everything else exits 0. The in-server guardrail stays the control.
2. **The PreToolUse guardrail unwraps `kiro_powers`.** When `tool_name` is `kiro_powers`, the hook acts only on `action: "use"` with `serverName` `compass`, takes the tool from `tool_input.toolName` and the arguments from `tool_input.arguments`, and exits 0 for anything else (activation, other powers, reads). It never relies on `powerName`, which is the import folder's name.
3. **Template matchers use the forms that fire.** The Compass guardrail hook matches `kiro_powers`. The `awsevents` write block matches the lower-case suffix regex `.*(reservesessions|cancelreservation|associatefavorites|disassociatefavorite|createpersonaltime|updatepersonaltime|deletepersonaltime)$`, which works whatever name the attendee gives the server.
4. **Hooks do not carry warnings or reminders.** Text from a hook that exits 0 never reaches the agent, so the PostToolUse `post-write-sync` hook is removed from the template, and warn or note decisions are not relied on. The sync reminder comes from the Compass tool results (as `cancel_reservation` already does).
5. **The Power ships no hooks;** the `install-hooks` skill keeps copying the template into the workspace `.kiro/hooks/` with the human's approval.
6. **`awsevents` stays out of the Power's `mcp.json`.** In a Power, `disabledTools` is not honoured: a bare name hid nothing, and an entry with `oauth` and `disabledTools` can be skipped as invalid. The README and `install-hooks` document adding it to the workspace `.kiro/settings/mcp.json` with `disabledTools` listing the seven write tools by their **full** names (`AWSEventsPublicApi-Mcp-prod___ReserveSessions` and the six others). The PreToolUse block on its write tools stays as defence in depth.
7. **The README tells Kiro users to enable MCP** (Settings, "Kiro Agent: Configure MCP", Enabled) before importing the Power.

## Consequences

- Without decision 2 the shipped hook would see only `kiro_powers`, identify no tool and let every Compass write through unchecked by the hook (the server would still check it). The integrator applies decisions 2 to 4 in compass-power task 29: `packages/mcp-server/src/hooks/hook-input.ts` and `tool-names.ts` (unwrap `kiro_powers`), `pre-write-guardrail.ts` (arguments from `tool_input.arguments`), `power/hook-templates/reinvent-compass.json` (matchers, no PostToolUse hook), and a payload fixture built from the samples above, replayed through the hook.
- `identifyTool` already resolves the lower-cased workspace ids (case-insensitive suffix match at a non-alphanumeric boundary); the tests gain those exact strings.
- Documentation to correct: `.kiro/steering/tech.md` (the `awsevents` entry and the full tool names), `README.md` (the official remote server paragraph), `power/skills/install-hooks/SKILL.md` and `power/skills/plan-my-week/SKILL.md` (full tool names), and the compass-power design's expected server name `power-reinvent-compass-compass` (a folder import gives `power-power-compass`).
- The repository's folder `power/` registers the power as `power` on a folder import. A clearer folder name (for example `reinvent-compass/`) is an option once steps 12 to 14 show how a GitHub import names it.
- Pending (steps 12 to 14, after the push): whether "Import power from GitHub" accepts the repository URL and the `tree/main/power` subfolder URL, the name it registers, and which manifest it reads.

## Source

- SP1 run by the owner on 18 October 2026 in Kiro IDE 1.3.11; hook stdin logged by a probe script outside the repository; Kiro logs `kiro.log` and `mcp.log` (policy rules `power/sp1-probe/ProbeWrite`, hooks reload counts, MCP connect results).
- [Hooks](https://kiro.dev/docs/hooks/), [Hook types](https://kiro.dev/docs/hooks/types/), [Hook actions](https://kiro.dev/docs/hooks/actions/), [Create powers](https://kiro.dev/docs/powers/create/), [Kiro MCP configuration](https://kiro.dev/docs/mcp/configuration/), [Agent Plugins mcp schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json).
