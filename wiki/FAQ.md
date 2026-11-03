_For attendees and judges: short answers to the questions people ask first, with links to the full pages._

## Is this an official AWS product?

No. re:Invent Compass is an independent community project, built as an entry in the re:Invent Catalog API Builder Challenge. It is not affiliated with, endorsed by or sponsored by Amazon Web Services. See the [Disclaimer](Disclaimer).

## Is a Compass boarding pass a ticket?

No. Every pass is unofficial, carries no barcode, and says on its back: "This is not a ticket. Your re:Invent badge is your official ticket. Bring it to every session." Your badge is your ticket. The pass is a reminder of where to be and when [boarding closes](Glossary#boarding-closes). See [Board](User-Guide-Board#what-a-pass-shows).

## Does Compass book sessions for me?

Not unless you turn writes on. In live mode Compass is [read-only by default](Read-Only-By-Default): the booking tools run every check and tell you what they would have done, and you make the change in the re:Invent app. With `COMPASS_ALLOW_WRITES=1`, Compass can book, but each change still needs your approval. There is no background booking, no seat polling and no retry loop.

## What does it cost?

Nothing. Compass is free and open source under the Apache License 2.0. There is no Compass account to create. You need your own [AWS Builder ID](Glossary#aws-builder-id) registered for re:Invent 2026 to use your real schedule; the demos need nothing.

## Can I try it without signing in or installing anything?

Yes, two ways. Open [reinvent-compass.vegas/demo](https://reinvent-compass.vegas/demo) on any phone: no install, no sign-in, nothing touches a real schedule. Or, with Node.js 24, run `npx --yes reinvent-compass@0.1.0 demo` for the full ten-step flow on made-up data. See [Getting started](Getting-Started).

## What if I do not use Kiro?

Compass is a standard [MCP server](Glossary#mcp-server). Claude Desktop, VS Code, the Kiro CLI and other desktop [MCP clients](Glossary#mcp-client) that run stdio servers can start it with `npx --yes reinvent-compass@0.1.0`. The setup for each is on [Getting started](Getting-Started#other-mcp-clients). The [guardrail](Glossary#guardrail) runs inside the server, so every client gets it; only the optional hooks are Kiro-only.

## Which phones work?

- **iPhone:** Apple Wallet.
- **Android phone:** Google Wallet.
- **iPad, or anything else:** the calendar file from the same `/board` page, with an alarm when boarding closes. iPad has no Wallet app.

See [Board](User-Guide-Board#the-buttons).

## Can I delete a pass?

You can remove a pass from your Wallet yourself at any time. Compass cannot: no wallet lets anyone delete a pass remotely. When you cancel a session, `sync_passes` [voids](Glossary#void) its pass, so Wallet moves it to expired passes (Apple) or marks it inactive (Google). Every pass also expires when its session ends. See [Fly](User-Guide-Fly#void-on-cancel).

## What data leaves my machine?

Very little. Your access token goes only to the AWS Events API. When you issue passes, the printable pass fields (session code, title, venue, room, times and the walks before and after) and your ID token go to the Compass API; the token is checked and never stored. Your code, your tech list and your schedule snapshot stay on your computer. The server keeps pass records until the session ends plus 24 hours, and hand-offs for 15 minutes. See [Privacy](Privacy).

## Does Compass read my code? Is that safe?

It scans a folder you name, on your machine, read-only. Only AWS service and technology names, a depth per service and counts leave the scanner: never a file name, path or content. Your GitHub repositories are read only if you connect the Compass [GitHub App](Glossary#github-app), which has read-only permissions, and only after you confirm the list. See [Plan](User-Guide-Plan#scan-your-code).

## Why does Compass keep a local copy of the catalog?

The AWS Events API has no search: listing sessions takes only an event, a locale, whether to include abstracts, and a page token. So `refresh_catalog` reads every page once into a private cache on your machine, and searching, planning and the guardrail all filter that copy. That keeps searches fast and well inside the API's per-attendee quotas. See [Events API coverage](Events-API-Coverage).

## Why "boarding closes" 10 minutes before the start?

Because a reserved seat is held only until 10 minutes before a session starts. After that it can go to the [walk-up](Glossary#walk-up) line. So the time that matters is not "Starts 10:30" but "Boarding closes 10:20", plus the walk from wherever you are. Compass puts that time on every pass and checks every connection against it. See [Guardrail rules](Guardrail-Rules#boarding-closes).

## How accurate are the walking times?

They are estimates, and Compass says so. AWS publishes no walking times between venues, so each one is the OpenStreetMap foot route at 66.7 metres a minute, plus 15 minutes to leave and enter buildings, rounded up to 5, with a 30 minute floor. Because they are estimates, a walk that looks impossible only warns ("likely impossible") unless you would be late even at half the estimate. See the [full table](Guardrail-Rules#walking-estimates).

## What if a session I want is full?

Compass looks for other ways in: a [repeat](Glossary#repeat) of the same session (the code with `-R`), a backup on your [standby](Glossary#standby) list, or the walk-up line. If the session clashes with one you hold that has a repeat, it offers a [safe swap](Glossary#safe-swap): reserve the repeat first, confirm it, and only then cancel the original. See [Guardrail rules](Guardrail-Rules#the-safe-swap).

## What happens when a session moves or I cancel?

Run `sync_passes`. It reads your real schedule and makes your passes match: a new time or room updates the pass on your phone, a cancelled session voids its pass, and a new reservation gets a pass. See [Fly](User-Guide-Fly).

## Which parts of the AWS Events API does Compass use?

All 12 operations: 5 reads (events, one event, sessions, one session, your schedule) and 7 writes (reservations, favourites and personal time). The writes are reached only through the five Compass schedule tools, each with your approval, and only when writes are on. See [Events API coverage](Events-API-Coverage) and [MCP tools](MCP-Tools).

## How do I erase everything?

Run `forget_me`. It voids your passes and deletes your pass data on the server, then deletes your local Compass data. Then run `sign_out` to revoke your sign-in, and remove any passes from your Wallet. See [Privacy](Privacy#forget-me).

## How was it built?

Spec first, with Kiro, in public, with every task on the [project board](https://github.com/users/henniefrancis/projects/3). See [How it was built](How-It-Was-Built) and the [Architecture overview](Architecture-Overview).

## Related pages

- [Getting started](Getting-Started)
- [Privacy](Privacy)
- [Guardrail rules](Guardrail-Rules)
- [Disclaimer](Disclaimer)
- [Glossary](Glossary)
