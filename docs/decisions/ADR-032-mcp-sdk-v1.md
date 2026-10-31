# ADR-032 MCP TypeScript SDK stays on the v1 line for 0.1.0

Status: Accepted, 2026-10-29 (CTO final review finding 7). Amended 2026-10-30: the owner approved the 1.32.2 patch, and the pin is now 1.32.2 (compass-power task 59).

## Context

`packages/mcp-server/package.json` pins `@modelcontextprotocol/sdk` at exactly 1.32.1. The pin came with the workspace scaffold and is listed in the dependency table of `.kiro/specs/foundation-contracts/design.md` (ADR-006 toolchain). The design notes in `.kiro/specs/compass-power/design.md` ("Research notes informing the design") record what was checked in the installed 1.32.1 package: `McpServer.registerTool` takes a zod object schema, `Server.elicitInput()` and `getClientCapabilities()` exist, `InMemoryTransport` exists, and the SDK accepts `zod` `^3.25 || ^4.0`, which matches the workspace pin of zod 4.6.7.

The specs do not say why v1 was chosen over v2. This ADR records the decision and the facts checked on 29 October 2026. It does not claim the original reason.

Facts from the official sources, checked 29 October 2026:

- The SDK repository README says `main` is v2, "the stable release line", and that v1.x lives on the `v1.x` branch. It says v1.x "continues to receive bug fixes and security updates for at least six months after the v2 release (2026-07-27)". That is until at least 27 January 2027. Source: [typescript-sdk README](https://github.com/modelcontextprotocol/typescript-sdk).
- Releases page: v2 is at 2.4.0 (23 October 2026) and 2.3.1 (5 October). v1 is at 1.32.2 (23 October) and 1.32.1 (5 October). Source: [releases](https://github.com/modelcontextprotocol/typescript-sdk/releases).
- npm: `@modelcontextprotocol/sdk` has the single dist-tag `latest` at 1.32.2, published 2026-10-23. v2 ships under other package names (`@modelcontextprotocol/server` is at 2.4.0). Source: `npm view` on 29 October 2026.
- The code imports six subpaths of the one v1 package: `server/mcp.js`, `server/stdio.js`, `client/index.js`, `shared/transport.js`, `inMemory.js` and `types.js` (`packages/mcp-server/src`).

## Decision

- **Stay on the v1 line for 0.1.0.** The server is built, tested at 100 percent coverage and live-tested against v1. Moving to v2 means new package names and import paths, a migration of `packages/mcp-server/src`, and a new full gate, a few days before the 1 November submission (ADR-003). Nothing in 0.1.0 needs a v2 feature.
- **Keep the exact pin.** The pin stays exact so the bundled package is reproducible. Any change to it goes through the full gate.
- **Move to v2 after 0.1.0**, and before the v1 support window ends (at least 27 January 2027, from the README). Plan it as its own Kiro spec, using the migration guide linked from the SDK repository.
- **On 1.32.2: taken.** The owner approved the bump on 30 October 2026, and the pin moved from 1.32.1 to 1.32.2 through the full gate (compass-power task 59).
  - It was published on 23 October 2026, so it is days old. It follows 1.32.1 (5 October).
  - The releases page lists two fixes: optional `Transport` properties gain an explicit `| undefined` (a backport of #1766, in #2814), and registering after `connect()` is allowed when the capability was declared (#2958).
  - The dependency list of 1.32.2 is the same as 1.32.1.
  - Effect on Compass: `packages/mcp-server/src/server/create-server.ts` registers tools before `server.connect()`, so the second fix does not change today's behaviour. The first fix is a typing change. This ADR did not check whether it affects the project's TypeScript settings.
  - Why recommend it anyway: it is the latest 1.x patch, it is on the maintained line, and it adds no new dependencies. The cost is one pin change plus the full gate.
  - If the owner takes it: change the pin in `packages/mcp-server/package.json`, refresh the lock file, run the full gate, and do it before the `v0.1.0` tag.

## Consequences

- 0.1.0 ships with the v1 SDK, the line the specs and tests were written against.
- A v2 migration is planned work after the release, with a date set by the v1 support window.
- The README gives a minimum of six months after 27 July 2026, not a fixed end date. Re-check the README before planning the move.
- Not confirmed: the full release notes of 1.32.2. The release page by tag could not be read, so the two fixes above come from the releases listing.

## Source

- [typescript-sdk README](https://github.com/modelcontextprotocol/typescript-sdk) and [releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), checked 29 October 2026.
- `packages/mcp-server/package.json`, `packages/mcp-server/src/server/create-server.ts`.
- `.kiro/specs/compass-power/design.md` (research notes), `.kiro/specs/foundation-contracts/design.md` (dependency table).
- ADR-003, ADR-006.
