_For architects: how the Compass MCP server is built, what its 24 tools are, how it keeps writes safe and how it is configured._

The Compass server is a local [MCP server](Glossary#mcp-server) published to npm as `reinvent-compass` (version 0.1.2, Node 24 or newer). An [MCP client](Glossary#mcp-client) such as Kiro starts it on stdio with `npx --yes reinvent-compass@0.1.2`. It scans the code you work on (a project, a dev folder of git repositories or, through the read-only [GitHub App](Glossary#github-app), your GitHub repositories) to learn your AWS services, how deeply you use each one and the rest of your stack, then reads the [AWS Events API](Glossary#events-api) catalog to find the sessions that match, with a reason for each. It plans a week, runs the [guardrail](Glossary#guardrail) before every booking and drives the [Compass API](Glossary#compass-api) for passes.

## What is inside

| Folder                                                                                                                 | Role                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [packages/mcp-server/src](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src) | The server: tool handlers, guardrail wiring, hooks, command line and runtime composition.                                                                                                                                                                  |
| [packages/core/src](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/core/src)             | `@compass/core`, the shared library the server and the site use.                                                                                                                                                                                           |
| [packages/contracts/src](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/contracts/src)   | `@compass/contracts`: the zod schemas of every tool input and output (`mcpTools` in [mcp-tools.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/contracts/src/mcp-tools.ts)), the pass fields and the generated API types. |

Inside the server package:

| Folder                                                                                                                                                                                                                          | Role                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [server](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/server)                                                                                                                    | `createCompassServer`, the tool registry, the write mutex, elicitation, result shaping and error messages. |
| [tools](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/tools)                                                                                                                      | One handler per tool.                                                                                      |
| [guardrail](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/guardrail)                                                                                                              | Batch checks, rebooking suggestions and the in-memory ledger of pending [safe swaps](Glossary#safe-swap).  |
| [adapters](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/adapters) and [ports](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/ports) | The seams to the Events API, the rules engine, the pass client, GitHub, the file system and the QR page.   |
| [runtime](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/runtime)                                                                                                                  | Builds the live or the simulated composition once, at start-up.                                            |
| [safety](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/safety)                                                                                                                    | Labelled data, identifier checks and path checks.                                                          |
| [state](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/state)                                                                                                                      | The schedule snapshot, the [tech list](Glossary#tech-list) and the per-session state.                      |
| [hooks](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/hooks)                                                                                                                      | What the optional [Kiro hooks](Glossary#kiro-hook) run.                                                    |
| [cli](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/cli) and [demo](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/demo)             | The command line and the offline demo.                                                                     |
| [simulated](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/packages/mcp-server/src/simulated)                                                                                                              | The in-process pass service and pinned clock of [simulated mode](Glossary#simulated-mode).                 |

### The `@compass/core` subpaths

The library exports ten subpaths, listed in [packages/core/package.json](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/core/package.json).

| Subpath                   | What it holds                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@compass/core/auth`      | Builder ID sign-in with [PKCE](Glossary#pkce) on a loopback port (8484 to 8489), the keychain token store, single-flight refresh and the one-audience-per-token check.                                      |
| `@compass/core/api`       | The 12 Events API operations, one file each, with the HTTP transport, the retry policy, the per-operation quota tracker and the confirmed write that reads the schedule back.                               |
| `@compass/core/catalog`   | Catalog refresh by paged `ListSessions`, normalisation, the event window and the private catalog cache.                                                                                                     |
| `@compass/core/simulated` | The [synthetic catalog](Glossary#synthetic-catalog) fixtures and the simulated transport.                                                                                                                   |
| `@compass/core/rules`     | The rules engine: clashes, [connections](Glossary#connection), [boarding closes](Glossary#boarding-closes), [energy budget](Glossary#energy-budget), [layovers](Glossary#layover), rebooking and safe swap. |
| `@compass/core/scanner`   | The read-only repository scanner, run in a worker thread with a 20 second budget.                                                                                                                           |
| `@compass/core/spec`      | The week planner and the [Kiro spec](Glossary#kiro-spec) renderer and writer.                                                                                                                               |
| `@compass/core/passes`    | Pass fields, the Compass API client, pass sync, hand-off, calendar and itinerary export, forget-me and the local pass record.                                                                               |
| `@compass/core/github`    | The [GitHub App](Glossary#github-app) device flow, the GitHub client, its token store and the archive scan worker.                                                                                          |
| `@compass/core/redact`    | Redaction of tokens and other secrets from any log line.                                                                                                                                                    |

## The 24 tools

`createCompassServer` in [create-server.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/server/create-server.ts) registers every key of `mcpTools`, passing each contract input and output schema through. Each tool has a class in [tool-registry.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/server/tool-registry.ts), which sets its MCP annotations: `readOnlyHint` for `read`, `destructiveHint` for `write`.

| Class                                 | Count | Tools                                                                                                                                       |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| read                                  | 8     | `refresh_catalog`, `find_sessions`, `scan_repo`, `check_itinerary`, `show_schedule`, `show_my_tech`, `find_sessions_by_tech`, `scan_github` |
| write, changes the re:Invent schedule | 5     | `reserve_with_guardrails`, `cancel_reservation`, `add_standby`, `remove_standby`, `add_layover`                                             |
| write, passes or data                 | 5     | `issue_all_boarding_passes`, `issue_boarding_pass`, `send_to_phone`, `sync_passes`, `forget_me`                                             |
| local action                          | 6     | `sign_in`, `sign_out`, `plan_week`, `export_calendar`, `connect_github`, `disconnect_github`                                                |

`sync_passes` is a write tool because it can void passes. The server exposes tools only: no MCP resources and no prompts. Every tool, with its inputs and outputs, is on [MCP tools](MCP-Tools).

## Key behaviours

- **Reads nothing at start.** `createCompassServer` touches no catalog, network or keychain, so a cold start stays fast.
- **Fixed error messages.** Every handler call is wrapped. A thrown error becomes a fixed plain-English message, and only its code is logged.
- **Codes for ids.** A [session code](Glossary#session-code) such as `BWP213` is accepted wherever a session id is.
- **Writes run one at a time.** Write tools run behind a mutex in [mutex.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/server/mutex.ts). Two writes that arrive together would each read the same schedule and each pass the guardrail; queued, each re-reads the schedule when its turn comes.
- **Fresh schedule, confirmed write.** Every schedule write reads `GetSchedule` fresh, runs the guardrail, sends the write once, then reads the schedule back. A session counts as reserved only when the read-back lists it. If the read-back fails, the result says "unconfirmed" and the write is never resent.
- **Safe swap.** A blocked booking returns rebooking options and, when one exists, a safe swap: reserve the [repeat](Glossary#repeat) first, cancel the original after. `cancel_reservation` on a session in a pending swap re-checks the swap on a fresh schedule and cancels only when it is safe.
- **[Read-only mode](Glossary#read-only-mode).** In live mode, unless `COMPASS_ALLOW_WRITES=1`, the Events adapter is wrapped so every write is refused before any request. The schedule tools answer what they would have done. Passes still work.
- **Logs go to stderr.** stdout carries MCP protocol messages only. Every log line passes through redaction.

### Elicitation

Where the client declares the MCP elicitation capability, a tool asks the human directly before it changes anything: a ticked box for yes or no, or a single choice from a list. The server waits up to five minutes; a timeout changes nothing. Any answer that is not a ticked box is a no. Where the client cannot ask, the client's own approval of the tool call is the confirmation, and a few actions are refused outright (a bulk void, a swap override, scanning a folder outside the workspace, scanning GitHub). With `COMPASS_ELICITATION=off` the server asks nothing, even when the client declares the capability, and behaves as it does for a client that cannot ask. The [Kiro Power](Kiro-Power) sets it, because Kiro cancels every question a server asks through a Power (Kiro 1.4.86 logs "Elicitation request received but no handler is active, cancelling"), so each one would read as a no (compass-power task 65). See [elicitation.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/server/elicitation.ts).

### Labelled data

Catalog text and the attendee's own text reach the agent only inside a labelled block: a fixed preamble that says the content is data, not instructions, followed by the data encoded as JSON. JSON encoding means a title can never close the block or pose as server text. Abstracts never leave the server. See [labelled-data.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/safety/labelled-data.ts) and the prompt-injection test described on [Security](Security#prompt-injection).

## Interfaces

- **MCP over stdio** to the client, built on `@modelcontextprotocol/sdk` 1.32.2 (see [why the v1 SDK](Decisions-Delivery-and-Tooling#mcp-typescript-sdk-stays-on-v1)).
- **HTTPS** to `oauth.awsevents.com` (sign-in, refresh, revoke) and `api.awsevents.com` (the 12 operations; see [Events API coverage](Events-API-Coverage)).
- **HTTPS** to the Compass API at `https://reinvent-compass.vegas` with the ID token (see [Pass API](Pass-API)).
- **HTTPS** to `github.com`, `api.github.com` and `codeload.github.com`, only after `connect_github`.
- **Files** in the OS app-data folder and the workspace (see [Data and privacy](Data-and-Privacy)).

### Command line

[run-cli.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/cli/run-cli.ts) handles:

```sh
reinvent-compass                     # start the server on stdio
reinvent-compass demo [--repo <dir>] # run the simulated demo, no network
reinvent-compass hook <name>         # pre-write-guardrail or post-write-sync, exits 0 or 2
reinvent-compass --version           # or -v
reinvent-compass --help              # or -h
```

A `hook` command reads stdin only, starts no subprocess and exits only with 0 or 2. The demo forces simulated mode and runs on a temporary copy of the folder it scans.

## Configuration

Settings are environment variables of the server process, read in [runtime-config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/config/runtime-config.ts) and [github.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/mcp-server/src/config/github.ts).

| Variable                     | Effect                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPASS_MODE`               | `simulated` runs on the synthetic catalog with a pinned clock and an in-process pass service. Anything else is live.                                                                   |
| `COMPASS_ALLOW_WRITES`       | `1` lets the schedule tools change the real re:Invent schedule, each change still confirmed. Unset means read-only.                                                                    |
| `COMPASS_API_URL`            | An `https` Compass API base URL, used only together with `COMPASS_ALLOW_API_OVERRIDE=1`. The server then prints a warning naming the host.                                             |
| `COMPASS_ALLOW_API_OVERRIDE` | `1` allows `COMPASS_API_URL`. This is how the dev environment is tested.                                                                                                               |
| `COMPASS_GITHUB_CLIENT_ID`   | Another GitHub App's client id, for a self-hosted app. An empty value turns GitHub scanning off. The server warns that it cannot check the app is read-only.                           |
| `COMPASS_GITHUB_APP_SLUG`    | The slug of that app, for its install page.                                                                                                                                            |
| `COMPASS_ELICITATION`        | `off` makes the server ignore the client's elicitation capability, so the client's own tool approval is the confirmation. The Kiro Power sets it. Any other value keeps the questions. |
| `COMPASS_ALLOW_SIMULATED`    | `1` allows simulated mode when `NODE_ENV` is `production`.                                                                                                                             |

The app-data folder follows the platform: `%LOCALAPPDATA%` (or `%APPDATA%`) on Windows, `~/Library/Application Support` on macOS, `$XDG_DATA_HOME` or `~/.local/share` elsewhere, each with a `reinvent-compass` folder.

## Build cards

The MCP server was built in the Build workstream ([Build cards on the project board](https://github.com/users/henniefrancis/projects/3/views/1?filterQuery=workstream%3A%22Build%22)). The cards for it:

- [REL1: the 0.1.0 release commit](https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=290044925): version, private flag off, production API address
- [BUG1: layover showed 8 hours late](https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=290045381)
- [BUG2: layover refused on 29 November](https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=290045485) (badge pickup day)
- [CTO1: package metadata and licences](https://github.com/users/henniefrancis/projects/3/views/1?pane=issue&itemId=290044316)

## Related pages

- [MCP tools](MCP-Tools)
- [Kiro Power](Kiro-Power)
- [Flows](Flows)
- [Guardrail rules](Guardrail-Rules)
- [Security](Security)
