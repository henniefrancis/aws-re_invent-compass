_For operators: how to stop every request at the edge at once, how to turn it off again, and what the WAF does the rest of the time._

The kill switch blocks every request to an environment's [CloudFront](Glossary#cloudfront) distribution: the site and the API alike. Use it when abuse or a cost run-up needs all traffic stopped at once. It is a rule in the [WAF](Glossary#waf) web ACL, defined in [infra/modules/edge/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/edge/main.tf), driven by one Terraform variable.

## How it works

The web ACL `compass-<env>` always contains a rule named `kill-switch` at priority 5. Its statement matches every request (a URI path length of zero or more). Only its action changes:

| `kill_switch_enabled` | Rule action | Effect                                    |
| --------------------- | ----------- | ----------------------------------------- |
| `false` (default)     | `count`     | Requests are counted and allowed.         |
| `true`                | `block`     | Every request gets HTTP 403 from the WAF. |

Nothing is created or destroyed when you flip it, so the plan is always one in-place change to the web ACL.

## Turn it on

1. Set the Terraform variable `kill_switch_enabled` to `true` in the HCP workspace of the environment.
2. Run `scripts/release.sh <env>` (see [Release](Release)). The plan must show one in-place change to `aws_wafv2_web_acl` and nothing else. Type `yes` for dev or `prod` for prod.
3. The change reaches the edge within a few minutes. Every request then gets HTTP 403, so the release script's health check fails after the apply and the script exits non-zero. That is expected while the switch is on.

## Turn it off

1. Set `kill_switch_enabled` back to `false`, or remove the variable.
2. Run `scripts/release.sh <env>`. The plan shows one in-place change to the web ACL.
3. Once the change has propagated, `GET /api/v1/health` through CloudFront returns HTTP 200 and the health check passes.

## What keeps working

- Apple passes already in a wallet stay on the phone and open offline. They stop updating while the switch is on.
- The `waf-blocked-requests` alarm fires while the switch is on, because every block counts (see [Alarms](Alarms)).
- WAF keeps no request samples and no logs by design, so there is no record of the blocked requests to review afterwards.

## Why the switch also covers direct calls

The API Gateway `execute-api` address cannot be called around CloudFront. Every API method requires the `x-api-key` header, and only CloudFront adds it, as a custom origin header. A direct call is refused by API Gateway before any [Lambda](Glossary#lambda) runs. CloudFront also adds an `x-origin-verify` header that the Lambdas check before anything else, as a second layer. Blocking at the edge therefore stops all traffic.

## The WAF rules

The kill switch is one of eight rules. The others stay active whatever the switch says. Rate rules count requests per source IP over a five-minute window, in memory only.

| Priority | Rule                           | What it does                                                             |
| -------- | ------------------------------ | ------------------------------------------------------------------------ |
| 1        | `per-ip-rate-limit`            | Blocks an IP above 600 requests on `/api/*`.                             |
| 2        | `aws-managed-common`           | AWS managed common rule set (its body size rule only counts; see below). |
| 3        | `aws-managed-known-bad-inputs` | AWS managed known bad inputs rule set.                                   |
| 4        | `aws-managed-ip-reputation`    | AWS managed IP reputation list.                                          |
| 5        | `kill-switch`                  | Counts every request, or blocks every request when the switch is on.     |
| 6        | `passkit-rate-limit`           | Blocks an IP above 300 requests on `/api/passkit/*`.                     |
| 7        | `api-body-size-limit`          | Blocks any request body above 64 KB on `/api/*`.                         |
| 8        | `site-per-ip-rate-limit`       | Blocks an IP above 3,000 requests on every path outside `/api/`.         |

The web ACL inspects request bodies up to 64 KB, and a larger body counts as oversize, which rule 7 blocks. Pass bodies can exceed the 8 KB body limit of the AWS common rule set, so that one rule (`SizeRestrictions_BODY`) is set to count; the API Gateway request validator and the Lambda schema checks bound the body instead. The rate limits are in [infra/modules/edge/locals.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/edge/locals.tf).

Behind the WAF, API Gateway applies its own throttle: 50 requests a second with a burst of 100 across the stage, and tighter limits on the routes that write or cost more (for example 5 a second, burst 10, on `POST /api/v1/passes`, and 2 a second, burst 4, on `DELETE /api/v1/me`). These are the `throttle_rate`, `throttle_burst` and `route_throttles` variables in [infra/envs/prod/variables.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/envs/prod/variables.tf).

## Lighter switches

If only one feature is misbehaving, switch that feature off instead: Apple push, Google Wallet or the hand-off calendar download. They fail no request and leave the site up. See [Alarms](Alarms#the-switches).

## Related pages

- [Alarms](Alarms)
- [Operations](Operations)
- [Security](Security)
- [AWS architecture](AWS-Architecture)
