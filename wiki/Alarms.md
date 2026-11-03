_For operators: the five CloudWatch alarms, the logs and the budget alert, what each one means, and which switch to use._

Each environment has five CloudWatch alarms, defined in [infra/modules/observability/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/observability/main.tf). They notify the SNS topic `compass-<env>-alarms`, which emails the address in the sensitive workspace variable `alarm_email`. The account also has one cost budget that emails you directly. Confirm the SNS subscription once with the link AWS emails, or no alarm reaches you.

Everything on this page is changed through Terraform: set the variable in the HCP workspace and run `scripts/release.sh <env>` (see [Release](Release)). Nothing is edited in the console.

## The five alarms

All five are in CloudWatch in `us-east-1`. Each one looks at one five-minute period, fires when the sum reaches the threshold, and treats missing data as not breaching, so a quiet period never raises one.

| Alarm                                | Metric                                                                                    | Fires at                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------ |
| `compass-<env>-api-5xx`              | `AWS/ApiGateway` `5XXError` for the REST API `compass-<env>`, stage `live`                | 1 or more in 5 minutes   |
| `compass-<env>-throttles`            | `AWS/Lambda` `Throttles`, summed over `compass-<env>-api` and `compass-<env>-passkit`     | 1 or more in 5 minutes   |
| `compass-<env>-apns-push-failures`   | Custom metric `Compass` / `ApnsFailure`, dimension `Function=api`                         | 1 or more in 5 minutes   |
| `compass-<env>-waf-blocked-requests` | `AWS/WAFV2` `BlockedRequests` for the web ACL `compass-<env>`, all rules, region `Global` | 100 or more in 5 minutes |
| `compass-<env>-lambda-errors`        | `AWS/Lambda` `Errors`, summed over both functions                                         | 1 or more in 5 minutes   |

The `ApnsFailure` metric is written by the api Lambda in CloudWatch embedded metric format each time an [APNs](Glossary#apns) push fails.

## Where to look: the logs

Three log groups per environment, each kept for 14 days ([infra/modules/api/locals.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/api/locals.tf)):

| Log group                                   | What it holds                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `/aws/lambda/compass-<env>-api`             | One JSON line per request to the attendee API                            |
| `/aws/lambda/compass-<env>-passkit`         | One JSON line per request to the [PassKit](Glossary#passkit) web service |
| `/aws/apigateway/compass-<env>-live-access` | API Gateway access log                                                   |

A Lambda request line carries only the request id, the route template, the status, the latency, the outcome and the function name. The access log carries the request id, the route template, the method, the status, the latencies and the error type. Neither ever holds a full path, a source address or an identifier. The `outcome` field is the quickest guide: `dependency_error` points at a secret, DynamoDB or an upstream service (Apple, Google, the ID token issuer), `internal_error` at the code, and `not_enabled` at a switched-off feature.

WAF keeps no logs and no request samples, by design.

## What to do for each alarm

Each heading is the end of the alarm name, after `compass-<env>-`.

### api-5xx

The API returned server errors.

1. Search both Lambda log groups for the failing route and its `outcome`.
2. For `dependency_error`, run `scripts/check-secrets.sh <env>` to rule out a missing secret value (see [Secrets](Secrets)).
3. If it started with a release, roll forward (see [Rollback](Rollback)).

### throttles

A Lambda function hit its reserved concurrency: 20 for the api function, 10 for the passkit function. The cap is deliberate, and a flood or a retry storm reaches it first. API Gateway publishes no throttle count, so its own 429 answers show only in the access log `status` field.

1. Check whether the WAF blocked the burst (the `waf-blocked-requests` alarm).
2. If real traffic needs more, request a Lambda concurrency quota increase and raise `api_reserved_concurrency` and `passkit_reserved_concurrency`. Do not set `-1`: it removes the cap.
3. If it is abuse, use the [kill switch](Kill-Switch).

### apns-push-failures

Apple push notifications failed. A failed push never fails the attendee's request, and a pass still refreshes when it is opened.

1. Check that the Pass Type ID certificate in `compass/<env>/apple-pass` is still valid; it expires yearly. If you renewed it, reload it with `scripts/load-secrets.sh <env> apple` (see [Secrets](Secrets#renewing-the-apple-certificate)).
2. If the failures are on Apple's side and last, set `apns_enabled = false` and release. Updates then reach phones only when a pass is opened. Set it back to `true` when pushes recover.

### lambda-errors

A Lambda function failed with an unhandled error or a timeout (15 seconds for api, 5 seconds for passkit). A configuration error at start-up fails every request and raises this alarm and the 5xx alarm together.

1. Read the newest lines of both Lambda log groups.
2. A failure that names a configuration variable (never its value) means a workspace variable is missing or wrong. Fix it and release.
3. If it started with a release, roll forward.

### waf-blocked-requests

The WAF blocked 100 or more requests in five minutes. Normal traffic does not do this. It also fires while the kill switch is on.

1. Decide whether it is an attack, a mis-set rule or the kill switch.
2. WAF keeps nothing to inspect. Compare with the per-rule WAF metrics (each rule publishes its own, named `compass-<env>-<rule>`) and the API Gateway and CloudFront request metrics.
3. For abuse, the per-IP rate rules already block the source (see [Kill switch](Kill-Switch#the-waf-rules)). If the traffic keeps rising, turn the kill switch on.

## The switches

Three feature switches are Terraform variables that reach the api Lambda as environment variables ([infra/modules/api/locals.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/api/locals.tf), read in [config.ts](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/packages/pass-service/src/config/config.ts)). Each defaults to `true`, and turning one off is a Lambda configuration update only. The fourth is the WAF kill switch.

| Switch                     | Terraform variable         | Lambda variable            | Off means                                                                                                                 |
| -------------------------- | -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Apple push                 | `apns_enabled`             | `APNS_ENABLED`             | No APNs pushes. Passes still update when opened.                                                                          |
| Google Wallet              | `google_wallet_enabled`    | `GOOGLE_WALLET_ENABLED`    | No Google Wallet objects or links; the Google secret is not needed. Apple passes and the calendar keep working.           |
| Hand-off calendar download | `handoff_calendar_enabled` | `HANDOFF_CALENDAR_ENABLED` | The [hand-off](Glossary#hand-off) calendar route answers 404 with the outcome `not_enabled`. Pass downloads keep working. |
| Kill switch                | `kill_switch_enabled`      | none (a WAF rule)          | Every request to the site and the API is blocked at the edge. Defaults to `false`. See [Kill switch](Kill-Switch).        |

Use the Apple push switch when APNs fails for a long time, the Google Wallet switch when the Google Wallet API or the issuer is failing or suspended, and the calendar switch when the calendar route misbehaves. A disabled feature fails no request. The kill switch is the only one that also blocks the site.

## The custom domain

Prod is served on `reinvent-compass.vegas` and dev on `dev.reinvent-compass.vegas`. If a name stops resolving or the browser reports a certificate error:

1. Check the Route 53 records: each name needs an A and an AAAA alias to the distribution, and the certificate needs its validation records. Terraform owns them, so fix a missing one with `scripts/release.sh <env>`, never in the console.
2. Check that the domain still delegates to the zone's name servers, for example with `dig NS reinvent-compass.vegas +short`.
3. The CloudFront default domain of the environment keeps answering while the custom name is broken. That separates a DNS or certificate fault from an API fault.

## The budget

One cost budget covers the whole account, defined in [infra/bootstrap/budget.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/bootstrap/budget.tf). It is named `compass-account-monthly`, its limit is the bootstrap variable `monthly_budget_usd` (default USD 60 a month), and it emails the bootstrap's `alarm_email` when actual spend passes 50, 80 and 100 percent.

The variable's own description estimates dev and prod together at about USD 38 to 40 a month, with WAF the largest part (USD 16 to 17 per environment), and the domain renewal adding USD 58 in the month it renews.

When the budget alert fires:

1. Open Cost Explorer and group by service.
2. A rise in Lambda, API Gateway or CloudFront means traffic. Check the alarms above, then consider the kill switch.
3. Removing dev with the [Teardown](Teardown) runbook takes away roughly half of the running cost.

## Related pages

- [Operations](Operations)
- [Kill switch](Kill-Switch)
- [Rollback](Rollback)
- [AWS architecture](AWS-Architecture)
- [Security](Security)
