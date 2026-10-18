# First deploy of dev: notes (18 October 2026)

Owner-run, guided step by step. Dev is live and healthy. Prod is not deployed yet.

No secret, token, account identifier, HCP organisation or workspace name is recorded here. The values below are the public outputs of the dev environment.

## Result

| Check                                                  | Result                                                |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `https://dev.reinvent-compass.vegas/`                  | HTTP 200, valid ACM certificate                       |
| `GET https://dev.reinvent-compass.vegas/api/v1/health` | HTTP 200, `{"status":"ok","version":"3ab902a-dirty"}` |
| API Gateway `execute-api` URL without the API key      | HTTP 403                                              |
| `scripts/check-secrets.sh dev`                         | all seven present (3 HCP variables, 4 secrets)        |
| Alarm topic subscription                               | confirmed                                             |
| Bootstrap applied a second time                        | No changes                                            |
| `scripts/release.sh dev` again (zero-diff)             | the saved plan had no changes                         |

Public outputs of dev:

- Domain: `dev.reinvent-compass.vegas`
- CloudFront domain: `d1esk37itij686.cloudfront.net`
- Distribution id: `E14JXIB6NETBMD`
- Site bucket: `compass-dev-site-aed4c82c77c659816e3e6f198d`

The version reads `-dirty` only because an uncommitted README draft was in the tree when the Lambda was built.

## What was done, in order

1. Preconditions. Terraform 1.16.6 locally (the HCP workspaces pin 1.15.x for remote runs; local CLI 1.16 worked for the local-execution bootstrap and for the remote plans). jq 1.8.2 installed with winget. Everything ran in Git Bash in Windows Terminal; `bash` from PowerShell opens WSL, which has none of the tools. Lambda concurrency limit 1000.
2. Domain. `reinvent-compass.vegas` was not registered and no hosted zone existed. The owner chose to register it through the bootstrap (`register_domain = true`, USD 58 a year, auto-renew, transfer lock, WHOIS privacy). Registration and the domain lock both succeeded and Route 53 created the zone; public DNS returned its four name servers within the hour.
3. Bootstrap. HCP project `reinvent-compass` and the bootstrap workspace (Local execution) created by hand, the documented seed step. Applied in several passes (fixes below), then a second run showed no changes. It created the plan and apply roles, the boundaries, the account API Gateway logging role, the USD 40 budget, the domain, and the dev and prod workspaces with their variables (`domain_name`, the event window and time zone from GetEvent, `id_token_issuer` and `id_token_verifier = cognito` from SP2).
4. Edge values. `load-secrets.sh dev edge-values` wrote the origin-verify value and the API key outside the repository; `set-workspace-secrets.sh dev` set `origin_verify_value`, `api_key_value` and `alarm_email` as sensitive workspace variables.
5. First release. Two AccessDenied errors and one validation error, each fixed (below). The apply then completed and, as designed, the health check returned 500 until the secrets existed.
6. Secrets, in order: `origin-verify` (from the same file as the HCP variable), `app` (pepperId `p1`), `apple` (the Keychain `.p12`, converted by the script itself), `google` (the `compass-wallet` service account key). `check-secrets.sh dev` reported all present, and the health check turned 200 a few minutes later.
7. Verification as in the table above.

## Fixes made during the deploy, and why

| Commit    | Change                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0a07439` | (main session) The bootstrap can register the domain with Route 53 Domains (`register_domain`, `domain_contact`). Docs in `2ae753e` and `9083572`.                                                                                                                                                                                                                                 |
| `a609aff` | Scripts under Git Bash on Windows: the Windows AWS CLI and jq.exe end lines with a carriage return, so every secret check failed closed and the HCP workspace id was corrupted; and Git Bash does not convert a path inside `file://`, so `put-secret-value` got the Windows path through `cygpath`.                                                                               |
| `6780afe` | The account already had an `app.terraform.io` OIDC provider, managed by the owner's henniefrancis-tech Terraform. AWS allows one per URL, so a create fails and an import would give it two owners. `create_oidc_provider = false` reads it and checks the `aws.workload.identity` audience.                                                                                       |
| `80aa58c` | `aws_api_gateway_account` failed twice with "The role ARN does not have required permissions configured": the logging role trust had an `aws:SourceArn` of `/restapis/*`, which the account setting check cannot match. The trust keeps `aws:SourceAccount` only. The bootstrap tests now pin their own variables, because `terraform test` also reads a local `terraform.tfvars`. |
| `ca368a7` | The plan refused the event window: the rule did not allow the milliseconds GetEvent returns (`2026-11-30T05:30:00.000-08:00`). It now matches the pass-service pattern exactly.                                                                                                                                                                                                    |
| `0c54e67` | AccessDenied on `wafv2:CreateWebACL` for `global/managedruleset/*/*`: WAF also authorizes the AWS managed rule groups, which carry no tags, so the tag condition never matched. They now have their own statement (CreateWebACL and UpdateWebACL only); the web ACL statements keep the environment tags. The policy size test counts a real 12-digit account id.                  |
| `3ab902a` | AccessDenied on `cloudfront:CreateDistribution`: the `CreateDistributionWithTags` API is authorized as `cloudfront:CreateDistribution` plus `cloudfront:TagResource`. The statement now names those, still with both request tags, scoped to distribution ARNs instead of `*`.                                                                                                     |
| `8a238bd` | The zero-diff release stopped on "Saved plan has no changes": HCP refuses to apply an empty saved plan. An empty plan now skips the apply and still asks, syncs, invalidates and checks health.                                                                                                                                                                                    |

No statement was widened to a wildcard action, and no IAM write statement names anything but the two Lambda roles.

## Things learned

- After each new commit the api Lambda shows one in-place update: `service_version` comes from `git describe`. The zero-diff check needs no commit in between.
- The owner's shell had a stale `TF_TOKEN_app_terraform_io` from another project, which made `terraform init` fail with "unauthorized". Loading the new token with `read -rs` in the same tab fixed it.
- Route 53 refuses a `state` for a South African contact, and wants the phone as `+27.<number>`.
- The `hash_key` and `range_key` deprecation warnings on `aws_dynamodb_table` are harmless (provider 6.69.1).

## Owner follow-ups

- Confirm the Route 53 registrant verification email for `reinvent-compass.vegas` by 2 November 2026, or the registry suspends the domain.
- Shred any leftover copies in `~/compass-secrets/dev` and `~/.compass-secrets` (the edge value files, the `.p12` copy, and the Google key once prod is loaded or replaced with a fresh key).
- Decide what to do with the stale `TF_TOKEN_app_terraform_io` (it may belong to henniefrancis-tech).
- The henniefrancis-tech Terraform owns the OIDC provider Compass trusts: do not remove it while Compass runs.

## Next

1. SP3 on the iPhone against dev: issue an Apple pass, add it to Wallet, update it and see the push.
2. SP4 on Android against dev: save a Google pass, void it, see it move to Expired (publishing access is still in review; Demo Mode works for the owner's account).
3. Prod: `cloud.auto.tfbackend` for prod, edge values and sensitive variables, `release.sh prod`, the four secrets, the prod Google class, then the same checks. The apply role fixes above already cover prod.
