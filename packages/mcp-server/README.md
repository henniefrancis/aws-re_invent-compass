# reinvent-compass

Plan your AWS re:Invent week from your own code, book it safely, and get Boarding Passes on your phone.

**Unofficial. Your badge is your ticket.** Reinvent Compass is an independent community project. It is not affiliated with, endorsed by or sponsored by AWS or Amazon.

## What it does

Compass is a local MCP server and a Kiro Power. Your AI assistant uses it to:

- read the session catalog and search it on your machine,
- scan a folder of yours, or a dev folder of git repositories (read-only), to see which AWS services you use and how deeply, and which other technology you use (.NET, Node.js, Python, React, Docker and more),
- read your GitHub repositories the same way, read-only and only after you confirm the list,
- keep that tech list on your machine, answer "What tech do I work on (the most)?" and find sessions on a technology ("Find me sessions on .NET"),
- plan a week of sessions that fits your tech, and write the plan as a Kiro spec in your workspace,
- check every booking against your real schedule before it is made, and block clashes,
- swap a booking for its repeat safely (it reserves the repeat first and cancels the original after),
- issue unofficial Boarding Passes and hand them to your phone with a short-lived QR code.

The guardrail that checks bookings runs inside the Compass server. It runs in every client, with or without hooks.

## Install

You need Node.js 24 or newer. Compass starts with `npx --yes reinvent-compass@0.0.0`, which downloads the package on first use.

### Kiro (the Power)

The Power is the `power/` folder of the repository: `plugin.json` and a matching `POWER.md` (Kiro needs one of the two at the root), `mcp.json`, three skills and a hook template.

0. Kiro starts no MCP server until you allow it: in Settings, set "Kiro Agent: Configure MCP" to Enabled.
1. In Kiro, open the Powers panel and choose Add Custom Power.
2. Choose Import power from GitHub and give it the repository URL: `https://github.com/henniefrancis/aws-re_invent-compass`.
3. If Kiro does not find the Power at the repository root, give it the subfolder URL instead: `https://github.com/henniefrancis/aws-re_invent-compass/tree/main/power`.

Both forms are listed because it is not yet recorded which one Kiro accepts. You can also import `power/` from a folder after cloning the repository. A folder import registers the Power under the folder name, so its server is called `power-power-compass`, whatever `plugin.json` says; the hooks accept both `compass` and that name.

Without the Power, add the server to `.kiro/settings/mcp.json` (this workspace) or `~/.kiro/settings/mcp.json` (all workspaces). Kiro reloads the file when you save it:

```json
{
  "mcpServers": {
    "compass": {
      "command": "npx",
      "args": ["--yes", "reinvent-compass@0.0.0"],
      "autoApprove": ["refresh_catalog", "find_sessions", "check_itinerary"]
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
      "args": ["--yes", "reinvent-compass@0.0.0"]
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
      "args": ["--yes", "reinvent-compass@0.0.0"]
    }
  }
}
```

VS Code asks you to trust a server the first time it starts, and can ask you to confirm each tool call. Documentation: https://code.visualstudio.com/docs/copilot/customization/mcp-servers (checked 17 October 2026).

### Kiro CLI

The Kiro CLI uses the same `mcpServers` JSON as the IDE; use the snippet from the Kiro section. The CLI also has `kiro-cli mcp add`, `list`, `remove`, `import` and `status` commands with a `workspace` or `global` scope. Run `kiro-cli mcp --help` for the exact options of your version. Documentation: https://kiro.dev/docs/mcp/ and https://kiro.dev/docs/reference/cli-commands/ (checked 17 October 2026).

Every command here names the exact version of this package. Pinning it is deliberate: see the threat model below. Change it only to a version you have looked up on the npm page.

## The tools

| Tool                      | Class        | What it does                                                                                 |
| ------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `sign_in`                 | local action | Signs you in with your AWS Builder ID. Opens your browser.                                   |
| `sign_out`                | local action | Revokes your sign-in and clears the stored tokens.                                           |
| `refresh_catalog`         | read         | Loads the session catalog into a private local cache.                                        |
| `find_sessions`           | read         | Searches and filters the cached catalog.                                                     |
| `scan_repo`               | read         | Scans a folder (or a dev folder of repos) read-only for AWS services and tech.               |
| `show_my_tech`            | read         | Lists your tech list on this machine: AWS services first, then other technology.             |
| `find_sessions_by_tech`   | read         | Finds catalog sessions on a technology, or on the tech you use the most.                     |
| `connect_github`          | local action | Connects the read-only Compass GitHub App. Shows a code to enter on GitHub.                  |
| `scan_github`             | read         | Reads your GitHub repositories, read-only, after you confirm the list.                       |
| `disconnect_github`       | local action | Deletes the GitHub sign-in on this machine.                                                  |
| `check_itinerary`         | read         | Runs the guardrail over proposed sessions. Writes nothing.                                   |
| `show_schedule`           | read         | Lists your reservations, standby list and layovers with their ids. Writes nothing.           |
| `plan_week`               | local action | Plans a week and writes it as a Kiro spec in the workspace, after you confirm.               |
| `export_calendar`         | local action | Writes an `.ics` calendar file of your schedule.                                             |
| `reserve_with_guardrails` | write        | Reserves 1 to 10 sessions after the guardrail passes. Changes your real schedule.            |
| `cancel_reservation`      | write        | Cancels a reservation, with the safe swap rule. Changes your real schedule.                  |
| `add_standby`             | write        | Favourites sessions as backups. Changes your real schedule.                                  |
| `remove_standby`          | write        | Removes a favourite. Changes your real schedule.                                             |
| `add_layover`             | write        | Creates, changes or deletes personal time. Changes your real schedule.                       |
| `issue_boarding_passes`   | write        | Creates unofficial Boarding Passes for sessions you hold.                                    |
| `send_to_phone`           | write        | Makes a 15-minute link for your passes: shown as a link, a QR code in your browser, or both. |
| `sync_passes`             | write        | Makes the passes match your schedule. It can void passes.                                    |
| `forget_me`               | write        | Deletes your pass data on the server and on this machine.                                    |

## Approvals

Only three read tools may be auto-approved: `refresh_catalog`, `find_sessions` and `check_itinerary`. They change nothing and read nothing of yours. `scan_repo` is read-only too, but it reads a folder on your machine, so approve each scan yourself. It scans freely only inside the folder Compass was started in; for any other folder it asks you to confirm first, and a client that cannot ask cannot scan one. A scan never changes where the plan is written: that is always the folder Compass was started in. `show_schedule` is read-only as well, but it reads your schedule, so approve each call yourself. It takes no input and lists your reserved sessions, standby list and layovers with the ids that `cancel_reservation`, `remove_standby` and `add_layover` take. `show_my_tech` and `find_sessions_by_tech` read your tech list on this machine, so approve them per call too. `connect_github`, `scan_github` and `disconnect_github` touch your GitHub account: approve each call yourself. `scan_github` also asks you to confirm the repositories before it reads any, and a client that cannot ask cannot run it.

**Write tools must never be auto-approved.** That means every tool marked write above, including `sync_passes`, which can void passes. Approve each call yourself. Where your client supports it, Compass also asks you to confirm in the client before it changes your schedule, listing the session ids, codes, titles and any warnings. Declining writes nothing.

The Power does not ship an `autoApprove` list. If you add one in your own configuration, list only those three read tools.

## Hooks (Kiro only)

Hooks are an extra check that only Kiro runs. The Power includes a hook template, and the `install-hooks` skill writes it to `.kiro/hooks/reinvent-compass.json` after you say yes.

- Kiro sends every Power tool call as one built-in tool, `kiro_powers`. The first hook matches it, and `pre-write-guardrail` picks out the Compass booking calls inside it, runs the same check as the server against your last read schedule and the cached catalog, and blocks the call when the guardrail blocks it.
- The second hook blocks any write through the remote `awsevents` server, so bookings go through Compass. Its matcher is lower case, because Kiro matches regular expressions against the lower-cased tool name.
- A hook can only block, with exit code 2. Anything a hook prints when it lets a call through never reaches the agent, so there is no sync reminder hook: the Compass tool results say when to run `sync_passes`.

The server checks every booking again, so nothing is unsafe in a client without hooks. A hook reads its input from stdin only, makes no network call and starts no other program. If it cannot judge a call, it says so and lets the call through. `npx --yes reinvent-compass@0.0.0 hook <name>` accepts only the names `pre-write-guardrail` and `post-write-sync` (the template uses only the first), and exits with code 0 or 2.

## The official AWS Events server (read only)

AWS publishes its own MCP server at `https://api.awsevents.com/mcp` (https://docs.aws.amazon.com/events/latest/devguide/mcp-server.html). It is fine for reading events and sessions. Do not use its write tools (ReserveSessions, CancelReservation, AssociateFavorites, DisassociateFavorite, CreatePersonalTime, UpdatePersonalTime, DeletePersonalTime): they skip the Compass guardrail. If you add it yourself, add it to the workspace `.kiro/settings/mcp.json` (not to a Power) and list those seven in `disabledTools` by their full names: `AWSEventsPublicApi-Mcp-prod___ReserveSessions`, `AWSEventsPublicApi-Mcp-prod___CancelReservation`, `AWSEventsPublicApi-Mcp-prod___AssociateFavorites`, `AWSEventsPublicApi-Mcp-prod___DisassociateFavorite`, `AWSEventsPublicApi-Mcp-prod___CreatePersonalTime`, `AWSEventsPublicApi-Mcp-prod___UpdatePersonalTime` and `AWSEventsPublicApi-Mcp-prod___DeletePersonalTime`. A bare name such as `ReserveSessions` hides nothing. The Power does not bundle the server, because Kiro does not honour `disabledTools` inside a Power (ADR-024), and the hook template blocks the seven write tools as a second layer.

## Read-only by default

Compass never changes your re:Invent schedule unless you ask it to in its settings. Signed in with your Builder ID, it reads the live catalog and your real reservations, standby list and layovers, and runs the booking guardrail as usual. By default the schedule write tools (`reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby` and `add_layover`) ask nothing and reply with what they would have done, that nothing changed, and that you can make the change in the re:Invent app. Underneath, every Events API write is refused before any request, so no path can change your schedule by accident. Boarding Passes still work, because they live on the Compass pass service, not in your re:Invent schedule.

To let Compass make changes, each one still confirmed by you first, set `COMPASS_ALLOW_WRITES=1` in the environment of the Compass MCP server. In Kiro that is the `env` of the server in your MCP settings: the `compass` entry for a manual install, or the Compass server the Power added (shown as `power-power-compass` when imported from a folder). While writes are on, every schedule reply in the chat starts with "Writes are on", and the server also logs one line. Only you should change this setting; the Power tells the agent never to.

```json
"env": { "COMPASS_ALLOW_WRITES": "1" }
```

Simulated mode never calls the Events API, so its made-up bookings work without the setting.

## Passes on your phone

`send_to_phone` takes `show`: `link` gives a 15-minute link in the chat, `qr` opens a page with a QR code in your browser for your phone camera to scan (the chat then shows no link), and `both` does both. Without `show` it creates nothing and asks, and the Power tells your assistant to ask "Link or QR code?" first. The QR page is a static file in a new private folder in your temp folder (file mode 0600 on macOS and Linux; on Windows your own `%TEMP%` folder protects it), with no script and nothing loaded from outside. Compass deletes it when the link expires, when it shows a newer one, when `forget_me` runs and when the server stops, and clears out any page a crashed server left behind. If the browser cannot be opened, the QR code comes back in the chat instead. If no page appears, ask for a link.

## Simulated mode and the demo

Set `COMPASS_MODE=simulated` to run the whole server on made-up data: a synthetic catalog, a signed-in attendee, a pinned clock, and an in-process pass service. No browser opens, no sign-in happens and nothing is sent anywhere. Every result starts with `SIMULATED MODE: no real data.` Simulated files live in a `simulated` folder, apart from real data. Simulated mode is refused when `NODE_ENV=production` unless `COMPASS_ALLOW_SIMULATED=1` is set.

Try the whole flow in one command:

```
npx --yes reinvent-compass@0.0.0 demo
```

It forces simulated mode and runs ten steps through the real tools on a copy of a sample repo: sign in and load the catalog, scan the repo, plan the week, a clash that is blocked, a safe swap, reserve the session that clashed, issue passes, hand them to a phone with a QR code, cancel a session, and void its pass. It prints which step failed and exits 1 if one does. `demo --repo <folder>` scans a folder of yours instead (a copy is used, so your folder is not changed).

## Your tech list and GitHub

Every scan adds to one tech list on your machine: the AWS services you use (with depth) and the other technology you use, such as .NET, C#, Node.js, TypeScript, Python, Java, Go, React, Angular, Docker, Kubernetes and Terraform. Ask "What tech do I work on?" or "What do I use the most?" (`show_my_tech`), and "Find me sessions on .NET" (`find_sessions_by_tech`, which also knows "dotnet" and "C#"). `plan_week` ranks sessions by the whole list.

- **A dev folder.** Point `scan_repo` at a folder of projects. Each git repository one or two levels down is scanned on its own, up to 50, and the reply says how many it scanned and skipped.
- **The AWS SDK for .NET** counts as AWS evidence: `AWSSDK.*` package references in `.csproj` files and `new Amazon<Name>Client(` in C#.
- **GitHub, read-only.** `connect_github` signs you in to the Compass GitHub App with a code you enter on github.com. The app has only Contents: read and Metadata: read, so it can never change your code. When you install it on GitHub you choose which accounts, organisations and repositories it may read; an organisation's owner must approve it there. `scan_github` lists the repositories it is about to read and reads nothing until you confirm. Forks are left out unless you ask (`includeForks`). Each repository is downloaded as an archive into memory, scanned under a time and size limit and dropped; nothing is written to disk.
- **Disconnect.** `disconnect_github` (or `forget_me`) deletes the GitHub sign-in on this machine. To remove the app on GitHub as well, uninstall it at https://github.com/settings/installations and revoke it at https://github.com/settings/apps/authorizations.

## What leaves your machine

- **Your sign-in tokens** stay in your operating system keychain (or in memory only, if there is no keychain). The access token goes only to `api.awsevents.com`, the refresh token only to `oauth.awsevents.com`, and the ID token only to the Compass pass service.
- **Your repository** is read on your machine. Only service and technology names, a depth per service and counts are used; no file name, path or content leaves the scanner.
- **Your tech list** is kept in your app-data folder (mode 0600) and removed by `forget_me`. Each project is stored under a one-way hash, so no folder path or repository name is kept. It is never sent anywhere.
- **GitHub**: the GitHub tokens stay in your operating system keychain (or in memory only) and go only to `github.com` and `api.github.com`. Repository archives come from `codeload.github.com` without the token, are read in memory and are never saved. Nothing about your repositories goes to Compass or to AWS.
- **Your schedule** is read from the AWS Events service. A copy is kept in your app-data folder (mode 0600) and removed by `forget_me`.
- **Session text** from the catalog is shown to your assistant as labelled data, never as instructions. Session abstracts are never passed on.
- **Boarding Passes**: when you issue passes, the pass fields (session code, title, times, room and an optional name you type yourself) go to the Compass pass service. Apple or Google receive them if you add a pass to a wallet. The ID token is checked and never stored.
- **Nothing is logged** that holds a token, an email address, a link or a file path. Logs go to stderr, never to stdout.
- **The week spec** is written into your workspace folder, after you confirm the folder. If the folder is a public repository the plan would show where you will be and when, so Compass offers to add it to `.gitignore`.

## How depth is worked out

Other technology gets a score instead of a depth: 1 for each file of its language, plus 5 for each manifest or package that declares it. `show_my_tech` ranks it by the number of projects that use it, then by score.

The scanner counts evidence per AWS service from Terraform, CDK (TypeScript), AWS SDK for JavaScript v3, boto3 (Python), the AWS SDK for .NET (`.csproj` and C#) and package manifests.

- `none`: no evidence.
- `exploring`: only imports, or packages listed as dependencies.
- `building`: any real resource, construct, client or command.
- `production`: building, with both infrastructure and code usage, and either a score of 12 or more or a production marker in the repository.

The score is 2 for each resource, construct or client, plus 1 for each command, import or dependency. A depth maps to a suggested session level: exploring is level 100 (200 with more evidence), building is 300 and production is 400. A boto3 client or resource call counts like an SDK client.

## Threat model

| Risk                                                                                            | What Compass does                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A session title or a file in your repo tries to talk to the assistant (prompt injection)        | Catalog text comes back as labelled JSON data. Write tools are never auto-approved. The guardrail runs in the server.                                                                                                                                                                  |
| Another program on your machine steals tokens                                                   | Tokens live in the OS keychain. The sign-in server binds to 127.0.0.1, takes one request and closes.                                                                                                                                                                                   |
| A token or email ends up in a log                                                               | A redacting logger on stderr, and tests that prove no token or email reaches a log or an error.                                                                                                                                                                                        |
| Someone books through the remote `awsevents` server and skips the guardrail                     | Do not use its write tools. The hook template blocks them in Kiro.                                                                                                                                                                                                                     |
| The wrong program runs when you start Compass with `npx` (the local copy risk)                  | `npx` can prefer a copy of a package from the folder you are in. Pin the version (`reinvent-compass@0.0.0`), do not start Compass from inside a repository you do not trust, and prefer a global install of a pinned version.                                                          |
| Someone else publishes a package under the same npm name before the owner does (name squatting) | The owner must claim the npm package name `reinvent-compass` (and any scope used) before the first publish, and publish from the owner's account with provenance. Until the name is claimed, install only from the repository. This is an owner action, not something the code can do. |
| A hostile repository (a slow pattern, a huge archive, a deep or `..` path, links)               | Every scan runs in a worker with a hard time budget. Archives stop at 100 MB compressed or 500 MB unpacked, files over 1 MB and binary files are skipped, links and `..` paths are never followed, and nothing is written to disk.                                                     |
| A GitHub token is stolen or misused                                                             | The Compass GitHub App can only read code. Tokens live in the OS keychain, are redacted from every log and error, go only to `github.com` and `api.github.com`, and are never sent on the archive redirect. `disconnect_github` deletes them.                                          |
| A workspace edits the hook to skip the check                                                    | The hook is a convenience. The server runs the same check.                                                                                                                                                                                                                             |
| Supply chain                                                                                    | Exact version pins in the Power and in the hook template.                                                                                                                                                                                                                              |

## Troubleshooting

- **"No OS keychain is available" (tokens held in memory only)**: on Linux, tokens need the Secret Service (for example GNOME Keyring). Without it, Compass holds them in memory and you sign in again each session.
- **Sign-in does not open a browser**: Compass prints the sign-in address on stderr. Open it by hand. Sign-in uses a local port from 8484 to 8489, so make sure one of them is free.
- **"Run refresh_catalog first"**: the catalog cache is empty. Run `refresh_catalog`.
- **A hook says Compass could not check a call**: nothing is wrong. The server checks it.
- **A write says it is unconfirmed**: the request went out, but the schedule could not be read back. Check your schedule before trying again. Compass does not send it twice.
