# Runbook: alarms, budget alerts and the switches

Owner-run. Every alarm and the budget alert email you. The alarm topic subscription must have been confirmed once (the link AWS emails). This runbook says what to check for each one, and which switch to use.

Everything is changed through Terraform: set the variable in the HCP workspace and run `scripts/release.sh <env>` (see `release.md`). Nothing is edited in the console.

## The five alarms

All five are in the CloudWatch console of us-east-1 under `compass-<env>-...`. They treat missing data as healthy, so a silent period never raises one.

### `compass-<env>-api-5xx`

The API returned server errors in a five minute window.

1. Look at the `compass-<env>-api` and `compass-<env>-passkit` log groups for the failing route: the request log lines carry the route template, status and outcome only, never a path or an identifier.
2. An outcome of `dependency_error` points at a secret, DynamoDB or an upstream service (Apple, Google, the ID token issuer). Run `scripts/check-secrets.sh <env>` to rule out a missing secret value.
3. After a release, roll forward (see `rollback.md`).

### `compass-<env>-throttles`

A Lambda function was throttled. The reserved concurrency (api 20, passkit 10) is a deliberate cap, and a flood or a retry storm reaches it first.

1. Check whether the WAF blocked the burst (the `waf-blocked-requests` alarm).
2. If real traffic needs more, request a Lambda concurrency quota increase and raise `api_reserved_concurrency` and `passkit_reserved_concurrency`. Do not set `-1`: it removes the cap.
3. If it is abuse, use the kill switch (below).

### `compass-<env>-apns-push-failures`

Apple push notifications failed (the `Compass` / `ApnsFailure` metric, dimension `Function=api`). A failed push never fails the attendee request; passes still refresh when opened.

1. Check the Apple certificate in `compass/<env>/apple-pass` is current (the Pass Type ID certificate expires yearly). Reload it with `scripts/load-secrets.sh <env> apple` if it was renewed.
2. If the failures are Apple-side and long-lived, set `apns_enabled = false` (variable `apns_enabled`, passed to the api Lambda as `APNS_ENABLED`) and release. Updates then reach phones only when a pass is opened. Set it back to `true` when pushes recover.

### `compass-<env>-lambda-errors`

A Lambda function failed (an unhandled error or a timeout). A configuration error at start-up fails every request and raises this alarm and the 5xx alarm together.

1. Read the newest lines of the two Lambda log groups.
2. A failure naming a configuration variable (never its value) means a workspace variable is missing or wrong: fix it and release.
3. After a release, roll forward.

### `compass-<env>-waf-blocked-requests`

The WAF blocked 100 or more requests in five minutes. Normal traffic does not do this. It also fires while the kill switch is on.

1. Decide whether it is an attack, a mis-set rule or the kill switch.
2. WAF keeps no logs or samples by design, so there is nothing to inspect. Compare with the API Gateway and CloudFront request metrics.
3. For abuse, the per-IP rate rules already block the source. If the traffic keeps rising, use the kill switch.

## The custom domain

Prod is served on `reinvent-compass.vegas`, dev on `dev.reinvent-compass.vegas` (ADR-031). If a name stops resolving or the browser reports a certificate error:

1. Check the Route 53 records of the zone: each name needs an A and an AAAA alias to the distribution, and the certificate needs its validation CNAME records. Terraform owns them; fix a missing one with `scripts/release.sh <env>`, never in the console.
2. Check that the domain still delegates to the zone name servers (it is registered with Route 53 Domains in this account, so normally nothing to do).
3. The CloudFront default address of the environment keeps answering while the custom name is broken, which separates a DNS or certificate fault from an API fault.

## The budget alert

The account budget (`compass-account-monthly`, 40 USD by default) emails you at 50, 80 and 100 percent of actual spend.

1. Open Cost Explorer and group by service. The expected shape is WAF first (about USD 13 an environment), then Secrets Manager, KMS and API Gateway (see plan section 7.4).
2. A spike in Lambda, API Gateway or CloudFront means traffic: check the alarms above, then consider the kill switch.
3. WAF body inspection above 16 KB may add a small per-request charge; check this on the first bill.
4. After 1 November, dev is removed with `teardown.md`, which roughly halves the spend.

## The switches

| Switch                                 | Variable                   | Lambda environment variable | Use it when                                                                                              |
| -------------------------------------- | -------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Apple push                             | `apns_enabled`             | `APNS_ENABLED`              | APNs fails for a long time or Apple asks you to stop. Passes still update when opened.                   |
| Google Wallet                          | `google_wallet_enabled`    | `GOOGLE_WALLET_ENABLED`     | The Google Wallet API or the issuer is failing or suspended. Apple passes and the calendar keep working. |
| Hand-off calendar download             | `handoff_calendar_enabled` | `HANDOFF_CALENDAR_ENABLED`  | The calendar file route misbehaves. Pass downloads keep working.                                         |
| WAF kill switch (see `kill-switch.md`) | `kill_switch_enabled`      | none (WAF rule)             | Abuse or a cost run-up that needs everything stopped at once.                                            |

Each Lambda switch is a Terraform variable, set in the HCP workspace and applied with `scripts/release.sh <env>`; the change is a Lambda configuration update only. A disabled feature answers with a clear `not_enabled` outcome rather than an error. The kill switch is the only switch that also blocks the site.
