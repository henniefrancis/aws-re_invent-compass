# reinvent-compass

Plan your AWS re:Invent week from your own code, book it safely, and get boarding passes on your phone.

**Unofficial. Your badge is your ticket.** Reinvent Compass is an independent community project. It is not affiliated with, endorsed by or sponsored by AWS or Amazon.

## What it does

Compass is a local MCP server and a Kiro Power. Your AI assistant uses it to:

- read the session catalog and search it on your machine,
- scan a folder of yours (read-only) to see which AWS services you use and how deeply,
- plan a week of sessions that fits that, and write the plan as a Kiro spec in your workspace,
- check every booking against your real schedule before it is made, and block clashes,
- swap a booking for its repeat safely (it reserves the repeat first and cancels the original after),
- issue unofficial boarding passes and hand them to your phone with a short-lived QR code.

The guardrail that checks bookings runs inside the Compass server. It runs in every client, with or without hooks.

## Install

You need Node.js 24 or newer. Compass starts with `npx --yes reinvent-compass@<version>`, which downloads the package on first use.

### Kiro (the Power)

The Power is the `power/` folder of the repository: `plugin.json`, `mcp.json`, three skills and a hook template.

1. In Kiro, open the Powers panel and choose Add Custom Power.
2. Choose Import power from GitHub and give it the repository URL: `https://github.com/henniefrancis/aws-re_invent-compass`.
3. If Kiro does not find the Power at the repository root, give it the subfolder URL instead: `https://github.com/henniefrancis/aws-re_invent-compass/tree/main/power`.

Both forms are listed because it is not yet recorded which one Kiro accepts. You can also import `power/` from a folder after cloning the repository.

Without the Power, add the server to `.kiro/settings/mcp.json` (this workspace) or `~/.kiro/settings/mcp.json` (all workspaces). Kiro reloads the file when you save it:

```json
{
  "mcpServers": {
    "compass": {
      "command": "npx",
      "args": ["--yes", "reinvent-compass@<version>"],
      "autoApprove": ["refresh_catalog", "find_sessions", "scan_repo", "check_itinerary"]
    }
  }
}
```

Kiro documentation: https://kiro.dev/docs/mcp/configuration/ (checked 17 October 2026).

### Claude Desktop

Open the Claude menu, then Settings, then Developer, then Edit Config. The file is `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Add:

```json
{
  "mcpServers": {
    "compass": {
      "command": "npx",
      "args": ["--yes", "reinvent-compass@<version>"]
    }
  }
}
```

Quit Claude Desktop completely and start it again. Documentation: https://modelcontextprotocol.io/docs/develop/connect-local-servers (checked 17 October 2026).

### VS Code

Create `.vscode/mcp.json` in the workspace, or run MCP: Open User Configuration for your profile. VS Code uses a `servers` object:

```json
{
  "servers": {
    "compass": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "reinvent-compass@<version>"]
    }
  }
}
```

VS Code asks you to trust a server the first time it starts, and can ask you to confirm each tool call. Documentation: https://code.visualstudio.com/docs/copilot/customization/mcp-servers (checked 17 October 2026).

### Kiro CLI

The Kiro CLI uses the same `mcpServers` JSON as the IDE; use the snippet from the Kiro section. The CLI also has `kiro-cli mcp add`, `list`, `remove`, `import` and `status` commands with a `workspace` or `global` scope. Run `kiro-cli mcp --help` for the exact options of your version. Documentation: https://kiro.dev/docs/mcp/ and https://kiro.dev/docs/reference/cli-commands/ (checked 17 October 2026).

Replace `<version>` with the version you want, for example the one on the npm page. Pinning it is deliberate: see the threat model below.

## The tools

| Tool                      | Class        | What it does                                                                      |
| ------------------------- | ------------ | --------------------------------------------------------------------------------- |
| `sign_in`                 | local action | Signs you in with your AWS Builder ID. Opens your browser.                        |
| `sign_out`                | local action | Revokes your sign-in and clears the stored tokens.                                |
| `refresh_catalog`         | read         | Loads the session catalog into a private local cache.                             |
| `find_sessions`           | read         | Searches and filters the cached catalog.                                          |
| `scan_repo`               | read         | Scans a folder read-only and reports AWS services and depth.                      |
| `check_itinerary`         | read         | Runs the guardrail over proposed sessions. Writes nothing.                        |
| `plan_week`               | local action | Plans a week and writes it as a Kiro spec in the workspace, after you confirm.    |
| `export_calendar`         | local action | Writes an `.ics` calendar file of your schedule.                                  |
| `reserve_with_guardrails` | write        | Reserves 1 to 10 sessions after the guardrail passes. Changes your real schedule. |
| `cancel_reservation`      | write        | Cancels a reservation, with the safe swap rule. Changes your real schedule.       |
| `add_standby`             | write        | Favourites sessions as backups. Changes your real schedule.                       |
| `remove_standby`          | write        | Removes a favourite. Changes your real schedule.                                  |
| `add_layover`             | write        | Adds personal time. Changes your real schedule.                                   |
| `issue_boarding_passes`   | write        | Creates unofficial boarding passes for sessions you hold.                         |
| `send_to_phone`           | write        | Makes a 15-minute link and QR code for your passes.                               |
| `sync_passes`             | write        | Makes the passes match your schedule. It can void passes.                         |
| `forget_me`               | write        | Deletes your pass data on the server and on this machine.                         |

## Approvals

Only the four read tools may be auto-approved: `refresh_catalog`, `find_sessions`, `scan_repo` and `check_itinerary`. They change nothing.

**Write tools must never be auto-approved.** That means every tool marked write above, including `sync_passes`, which can void passes. Approve each call yourself. Where your client supports it, Compass also asks you to confirm in the client before it changes your schedule, listing the session ids, codes, titles and any warnings. Declining writes nothing.

The Power does not ship an `autoApprove` list. If you add one in your own configuration, list only the four read tools.

## Hooks (Kiro only)

Hooks are an extra check that only Kiro runs. The Power includes a hook template, and the `install-hooks` skill writes it to `.kiro/hooks/reinvent-compass.json` after you say yes.

- Before a Compass write tool, `pre-write-guardrail` runs the same check as the server against your last read schedule and the cached catalog, and blocks the call when the guardrail blocks it. It also blocks any write through the remote `awsevents` server, so bookings go through Compass.
- After a schedule change, `post-write-sync` reminds the agent to run `sync_passes`.

The server checks every booking again, so nothing is unsafe in a client without hooks. A hook reads its input from stdin only, makes no network call and starts no other program. If it cannot judge a call, it says so and lets the call through. `npx reinvent-compass hook <name>` accepts only the names `pre-write-guardrail` and `post-write-sync`, and exits with code 0 or 2.

## The official AWS Events server (read only)

AWS publishes its own MCP server at `https://api.awsevents.com/mcp` (https://docs.aws.amazon.com/events/latest/devguide/mcp-server.html). It is fine for reading events and sessions. Do not use its write tools (ReserveSessions, CancelReservation, AssociateFavorites, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime, DeletePersonalTime): they skip the Compass guardrail. If you add it yourself, list those seven in `disabledTools` in your Kiro configuration. The Power does not bundle it yet, because it is not confirmed that a Power's `mcp.json` honours `disabledTools`.

## Simulated mode and the demo

Set `COMPASS_MODE=simulated` to run the whole server on made-up data: a synthetic catalog, a signed-in attendee, a pinned clock, and an in-process pass service. No browser opens, no sign-in happens and nothing is sent anywhere. Every result starts with `SIMULATED MODE: no real data.` Simulated files live in a `simulated` folder, apart from real data. Simulated mode is refused when `NODE_ENV=production` unless `COMPASS_ALLOW_SIMULATED=1` is set.

Try the whole flow in one command:

```
npx --yes reinvent-compass@<version> demo
```

It forces simulated mode and runs ten steps through the real tools on a copy of a sample repo: sign in and load the catalog, scan the repo, plan the week, a clash that is blocked, a safe swap, reserve the session that clashed, issue passes, hand them to a phone with a QR code, cancel a session, and void its pass. It prints which step failed and exits 1 if one does. `demo --repo <folder>` scans a folder of yours instead (a copy is used, so your folder is not changed).

## What leaves your machine

- **Your sign-in tokens** stay in your operating system keychain (or in memory only, if there is no keychain). The access token goes only to `api.awsevents.com`, the refresh token only to `oauth.awsevents.com`, and the ID token only to the Compass pass service.
- **Your repository** is read on your machine. Only service names and a depth per service are used; no file name, path or content leaves the scanner, and the scan result stays in memory.
- **Your schedule** is read from the AWS Events service. A copy is kept in your app-data folder (mode 0600) and removed by `forget_me`.
- **Session text** from the catalog is shown to your assistant as labelled data, never as instructions. Session abstracts are never passed on.
- **Boarding passes**: when you issue passes, the pass fields (session code, title, times, room and an optional name you type yourself) go to the Compass pass service. Apple or Google receive them if you add a pass to a wallet. The ID token is checked and never stored.
- **Nothing is logged** that holds a token, an email address, a link or a file path. Logs go to stderr, never to stdout.
- **The week spec** is written into your workspace folder, after you confirm the folder. If the folder is a public repository the plan would show where you will be and when, so Compass offers to add it to `.gitignore`.

## How depth is worked out

The scanner counts evidence per AWS service from Terraform, CDK (TypeScript), AWS SDK for JavaScript v3, and package manifests.

- `none`: no evidence.
- `exploring`: only imports, or packages listed as dependencies.
- `building`: any real resource, construct, client or command.
- `production`: building, with both infrastructure and code usage, and either a score of 12 or more or a production marker in the repository.

The score is 2 for each resource, construct or client, plus 1 for each command, import or dependency. A depth maps to a suggested session level: exploring is level 100 (200 with more evidence), building is 300 and production is 400. Python files are not analysed yet.

## Threat model

| Risk                                                                                     | What Compass does                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A session title or a file in your repo tries to talk to the assistant (prompt injection) | Catalog text comes back as labelled JSON data. Write tools are never auto-approved. The guardrail runs in the server.                                                                                                             |
| Another program on your machine steals tokens                                            | Tokens live in the OS keychain. The sign-in server binds to 127.0.0.1, takes one request and closes.                                                                                                                              |
| A token or email ends up in a log                                                        | A redacting logger on stderr, and tests that prove no token or email reaches a log or an error.                                                                                                                                   |
| Someone books through the remote `awsevents` server and skips the guardrail              | Do not use its write tools. The hook template blocks them in Kiro.                                                                                                                                                                |
| The wrong program runs when you start Compass with `npx` (the local copy risk)           | `npx` can prefer a copy of a package from the folder you are in. Pin the version (`reinvent-compass@<version>`), do not start Compass from inside a repository you do not trust, and prefer a global install of a pinned version. |
| A workspace edits the hook to skip the check                                             | The hook is a convenience. The server runs the same check.                                                                                                                                                                        |
| Supply chain                                                                             | Exact version pins in the Power and in the hook template.                                                                                                                                                                         |

## Troubleshooting

- **"No OS keychain is available" (tokens held in memory only)**: on Linux, tokens need the Secret Service (for example GNOME Keyring). Without it, Compass holds them in memory and you sign in again each session.
- **Sign-in does not open a browser**: Compass prints the sign-in address on stderr. Open it by hand. Sign-in uses a local port from 8484 to 8489, so make sure one of them is free.
- **"Run refresh_catalog first"**: the catalog cache is empty. Run `refresh_catalog`.
- **A hook says Compass could not check a call**: nothing is wrong. The server checks it.
- **A write says it is unconfirmed**: the request went out, but the schedule could not be read back. Check your schedule before trying again. Compass does not send it twice.
