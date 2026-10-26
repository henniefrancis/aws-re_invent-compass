# ADR-027 Accepted residual risks from the stream security reviews

Status: Accepted, 2026-10-17 (owner decisions during the stream review gates). Item 7 added 2026-10-22.

## Context

On 17 October 2026 the dev team built and reviewed S1, S2, S4 and S6 in parallel. Every High finding was fixed and re-reviewed. A few residual risks cannot be closed in code without a cost the owner judged not worth paying for a hackathon project, or they need an owner action before the first deploy. This ADR records them so the release gate can check each one.

## Decision

The owner accepts these residual risks:

1. **Shared signing material across dev and prod (S6 re-review N3).** Dev and prod use the same Apple Pass Type ID certificate and the same Google Wallet service account. A compromise of a dev deploy could read them. Mitigation: only the owner can trigger plans and applies (no VCS trigger, no speculative plans, no auto-apply), and the plan and apply roles are denied `secretsmanager:GetSecretValue`.
2. **The plan role can read the API key value (S6 review M4).** A Deny on `apigateway:GET /apikeys*` would break every plan, because the Terraform API key resource reads its value on refresh. The API key and the origin-verify value are also in HCP Terraform state and in the CloudFront configuration. Mitigation: restricted state access, owner-only runs, and rotation of both values on any access change.
3. **Provider lock files are pending (S6 review M7).** Generating them needs the Terraform Registry, so the owner generates and commits them for linux_amd64, windows_amd64 and darwin_arm64 in `infra/bootstrap`, `infra/envs/dev` and `infra/envs/prod`. Until then the lock test is skipped. **This is a release gate: no first apply without committed lock files.**
4. **Simulated mode for judges and contributors (S1 re-review N2; corrected 2026-10-18).** The server defaults to live mode; simulated mode is selected by `COMPASS_MODE=simulated`, which `npx reinvent-compass demo`, the test suite and the contributor `.env.example` use. Judges and new users run the product without signing in. Mitigation: the simulated transport is marked, the composition root logs a warning, every simulated result is labelled, and simulated mode is refused when `NODE_ENV=production` unless explicitly allowed.
5. **Estimated walking times (S2 QA H1).** AWS publishes no per-pair walking times, so `data/venues.json` holds researched, sourced estimates with a 30 minute floor. An impossible connection based on an estimate warns and never blocks.
6. **Resolved (2026-10-18, ADR-031).** ~~The CloudFront default certificate allows TLS 1.0 for viewers (S6 review L3).~~ The site, `/board` and the API now use the custom domain `reinvent-compass.vegas` with an ACM certificate and `TLSv1.2_2021`. The CloudFront default domain stays reachable only for the release health check, and where a custom domain is not set (the fallback), the default certificate still applies.
7. **The product name uses the "re:Invent" trademark (pre-release TAM review H2, owner decision 2026-10-22, tracker TM1).** "AWS" and "re:Invent" are trademarks of Amazon.com, Inc. or its affiliates. The product is named "re:Invent Compass", and the name appears in the logo wordmark, the site and page titles, the Kiro Power display name, the GitHub App name (`re-invent-compass-unofficial`), the npm package (`reinvent-compass`) and the domain (`reinvent-compass.vegas`). That is use as part of a brand, not only to describe compatibility. The owner considered renaming to "Compass" with "for AWS re:Invent" as a descriptor and chose to keep the name. Reasons: the entry is for AWS's own re:Invent Catalog API Builder Challenge and only makes sense with re:Invent; the name says what the tool is for; and the mitigations below make the unofficial status plain. Mitigation: the NOTICE, README, site footer and Disclaimer page say Compass is an independent community project, not affiliated with, endorsed by or sponsored by AWS; every pass carries an UNOFFICIAL PASS note ("This is not a ticket. Your re:Invent badge is your official ticket. Bring it to every session."), and the calendar file, the QR page and the site say "Unofficial. Your badge is your ticket."; no AWS logo or AWS artwork is used in the product, and the only AWS marks on the site are on The Creator page, in the owner's own photo and community link icons, which the owner as an AWS Community Builder and founder of AWS Community South Africa may use (showcase-site tasks 34 and 35); the NOTICE grants no rights in the name and logo. Corrected 26 October 2026 (compass-power task 54): the earlier text said every pass carries the short line and that no AWS colour is used, but the pass carries the longer note, and the Apple pass labels' closeness to the AWS colours is an accepted deviation (pass-service design, "Pass Designer event ticket"). Trigger to revisit: any request from AWS or the challenge organisers, or a decision to keep Compass running after the challenge, in which case the rename to "Compass for AWS re:Invent" is the planned fallback. The logo designer briefed on 22 October draws the "re:Invent Compass" wordmark.

## Consequences

- The release gate (plan section 13) checks items 1 to 3 explicitly, and item 3 blocks the first apply.
- Any change to the deploy model (a VCS trigger, auto-apply or another operator) reopens item 1 and needs separate dev credentials.

## Source

- Stream security and QA reviews, 17 October 2026 (S1, S2, S4, S6).
- [ADR-012](ADR-012-server-side-personal-data.md), [ADR-015](ADR-015-retained-resources.md), [ADR-026](ADR-026-audit-allowlist.md).
