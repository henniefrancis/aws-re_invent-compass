# ADR-004 Architect interview answers

Status: Accepted, 2026-10-15 (owner answers to the solutions-architect's first-pass questions). All items closed the same day.

| # | Topic | Owner decision |
|---|---|---|
| 1 | Phones and tablets | **Plan on a computer, board on any device.** Planning runs in Kiro (or another MCP client) on the attendee's computer; phones and tablets get Wallet passes, an `.ics` calendar file, a responsive itinerary page and the website demo. |
| 2 | Scope and streams | Multiple engineers (Kiro sessions) work on different specs at the same time, so the plan runs parallel streams. Apple Pass Type ID certificate and Google Wallet issuer do not exist yet: set them up now (owner). |
| 3 | Showcase website | **Accepted:** the story, a click-through demo on made-up sessions that works on any device with no install (guardrail blocking a clash, a sample pass, a sample `.ics`), install steps, a "what leaves your machine" privacy page, links to repo, post and video. No sign-in, no cookies, no analytics. |
| 4 | Signer access | **Option A, attendee-only signer:** Compass sends the attendee's Builder ID ID token (it cannot call the Events API); the signer verifies signature, audience and expiry, and rate-limits per user. The token is never logged or stored. The access token never leaves the attendee's machine. Day-1 spike: confirm the ID token can be verified against a public key set. |
| 5 | Getting passes to the phone | **Cloud hand-off** (temporary storage, smoother experience). This overrides the kickoff answer that nothing is stored server-side: short-lived pass content is accepted. |
| 6 | Data | **Real, live data in the product.** Tests and the public website demo use **made-up sessions** with the real data shape until AWS confirms a real catalog snapshot may be published (owner to ask on the hackathon Discussion tab). Real recordings stay private and local. Owner is registered for re:Invent with the Builder ID used for development. |
| 7 | Toolchain | Accepted: npm workspaces, ESLint plus Prettier, TypeScript 6, vitest 4, Playwright for the site only, Node 24, Angular 22 for the site. |
| 8 | Terraform | Accepted, with a **personal HCP Terraform organisation** (not the community organisation). HCP dynamic provider credentials, owner-run release script, one CloudFront distribution. |
| 9 | Branching | Accepted: `develop` integration branch, `feature/*`, `release/x.y.z`, `hotfix/*`; submit as v1.0.0; npm package `reinvent-compass` if free. |
| 10 | Tests | Accepted. Owner has a Mac and an Android phone for the release-gate runs. |

## Pass lifecycle (owner, 2026-10-15)

The owner moved **Apple's pass update web service into scope**: when a reservation is cancelled, its pass must go away, and every pass must expire.

Platform limits recorded for the plan:
- Neither Apple Wallet nor Google Wallet lets an issuer delete a pass from someone's phone. The closest is: Apple, update the pass to `voided` (and past its `expirationDate`), which moves it out of the main Wallet view into expired passes; Google, set the pass object's state to expired or inactive, which does the same.
- The Apple update service needs server-side storage of device registrations (a device library ID and a push token, which count as personal data under POPIA) and the latest pass versions, plus APNs pushes. Google needs no device service: updating the pass object through the Google Wallet API is enough.
- Every pass carries an expiration at its session end on both platforms.
