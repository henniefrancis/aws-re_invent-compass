# ADR-033 Compass GitHub App for the technology scan

Status: Accepted, 2026-10-29 (CTO final review finding 8; records the owner change of 20 October and task 47).

## Context

The owner change "your tech and your GitHub" (20 October 2026, compass-power tasks 41 to 45) lets Compass learn which technologies an attendee works with from their GitHub repositories, so `find_sessions_by_tech` and `plan_week` can suggest sessions. Requirement P2.8 says Compass reaches GitHub only through a GitHub App, so the token can never write. The owner registered the app "re:Invent Compass (unofficial)" on his personal account (task 47).

## Decision

- **A public GitHub App, with device flow.**
  - Permissions: Contents: read and Metadata: read only. No account or organisation permissions.
  - No webhook, no callback URL, no client secret and no private key. Device flow is on and expiring user tokens are on. It can be installed on any account.
  - The client ID `Iv23liKdFb0y0U0QXj6N` and the slug `re-invent-compass-unofficial` are public build constants in `packages/mcp-server/src/config/github.ts`. `COMPASS_GITHUB_CLIENT_ID` and `COMPASS_GITHUB_APP_SLUG` replace them for a self-hosted app. The hosts Compass talks to stay fixed.
- **The attendee chooses what the app can read.** They pick accounts and repositories when they install the app on GitHub. An organisation owner must approve an install there (P2.8).
- **What is read.**
  - Listing: `GET https://api.github.com/user/installations`, then the repositories of each installation. Forks are left out unless the attendee asks.
  - Content: one repository archive at a time, in a scan worker with a 60 second budget. The redirect must go to `codeload.github.com` and the token is not sent there. The archive is unpacked in memory with caps of 100 MB compressed and 500 MB unpacked, and links are skipped.
  - Before any content is read, the attendee confirms a message that names the accounts and up to 20 repositories. A client that cannot ask is refused. Listing the repository names before that confirmation is allowed and accepted (design, security review item L4).
- **What is stored.** Only a `github` source entry per repository in the local Tech_Profile (technology and service keys, levels 100 to 400, a time, and an unsalted hash as the project id). The GitHub tokens are stored as ADR-035 describes.
- **What is never stored.** Repository archives and file contents are never written to disk. Repository text never reaches the model: the profile accepts only keys of the service and technology tables, and the scan result gives counts and names only.
- **Why an App rather than a personal access token or an OAuth app.** The sources give these reasons for the App:
  - Read-only by construction. Its only permissions are Contents: read and Metadata: read, so even a stolen token cannot change code (design threat model, "Over-reach").
  - The attendee picks the repositories at install time, and no secret ships because device flow needs no client secret.
  - Tokens expire: 8 hours for access, 6 months for refresh.
  - The specs do not compare personal access tokens or OAuth apps in writing, so this ADR does not list their drawbacks.

## Consequences

- No write path to GitHub exists, so there is nothing to approve beyond reading.
- Compass cannot revoke a user token itself, because that needs the client secret, which Compass does not have. `disconnect_github` and `forget_me` delete the local tokens and tell the attendee where to remove the install (`https://github.com/settings/installations`) and the authorisation (`https://github.com/settings/apps/authorizations`).
- Anyone can point Compass at another app with `COMPASS_GITHUB_CLIENT_ID`. Compass cannot check that app is read-only, so it prints one warning line (security review item L6).
- Owner checks before launch, from the design: only Contents: read and Metadata: read, expiring tokens on, device flow on, no webhook and no callback URL. This ADR did not re-check the live app settings on GitHub.
- The GitHub hosts are listed on the site privacy page.

## Source

- `.kiro/specs/compass-power/design.md` ("GitHub, read-only (task 45)" and "Security review (20 October 2026)"), `requirements.md` P2.8 to P2.10, `tasks.md` tasks 41 to 47.
- `packages/mcp-server/src/config/github.ts`, `packages/mcp-server/src/tools/github.ts`, `packages/core/src/github`.
- GitHub documentation named in the design: "Generating a user access token for a GitHub App" and "Refreshing user access tokens" (checked 20 October 2026).
