_For operators: how to undo a bad release by rolling forward, which resources are retained and why, and how to recover if one is lost._

Rollback in Compass is always a roll forward: you release the last good commit again with the normal release script. Nothing is reverted by hand in the console, and the retained resources are never destroyed. See [Release](Release) for how the script works.

## Roll forward from the last good commit

1. Find the last good release tag or commit: `git tag --list 'v*'` or `git log --oneline`.
2. Check it out in a clean working tree: `git switch --detach <tag or commit>`.
3. Run `npm ci`, then `scripts/release.sh <env>` for the affected environment. The script builds that commit's Lambda bundles and site and shows a saved plan.
4. Read the plan. It should change only the Lambda code, the API deployment and the site. Type `yes` (dev) or `prod` (prod) only if it touches no retained resource; the script refuses such a plan anyway.
5. After the health check passes, return to your branch: `git switch -`.

If the bad release changed Terraform, the roll-forward plan undoes that configuration change. The refusal checks still apply: a plan that destroys or replaces a retained resource is never offered.

For a bad release across the product, roll forward in this order: the backend first, then the site, then the npm package. The npm package calls the prod API by default, so the API must keep answering clients of the previous version while the others catch up.

## Retained resources

Seven resources in each environment carry `lifecycle { prevent_destroy = true }`, so Terraform fails any plan that would destroy them. `scripts/release.sh` also refuses any plan that deletes or replaces a resource of their types, and [infra/tests/retained.tftest.hcl](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/tests/retained.tftest.hcl) checks that the lifecycle blocks are there.

| Resource                             | Where                                                                                                                        | Why it is kept                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| CloudFront distribution              | [modules/edge/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/edge/main.tf)       | It serves the domain that every issued pass points at.     |
| DynamoDB table                       | [modules/data/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/data/main.tf)       | It holds the live passes. It also has deletion protection. |
| Secret `compass/<env>/apple-pass`    | [modules/secrets/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/secrets/main.tf) | The recovery window blocks re-creating the same name.      |
| Secret `compass/<env>/google-wallet` | same                                                                                                                         | Same.                                                      |
| Secret `compass/<env>/app`           | same                                                                                                                         | Same, and it holds the pepper behind every owner hash.     |
| Secret `compass/<env>/origin-verify` | same                                                                                                                         | Same.                                                      |
| Site bucket                          | [modules/site/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/site/main.tf)       | Stops a mistaken plan from taking the live site down.      |

The domain registration in the bootstrap ([domain.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/bootstrap/domain.tf)) carries `prevent_destroy` too, with auto-renew and the transfer lock on. That makes eight `prevent_destroy` blocks under `infra/` in all.

## If a retained resource is lost

### CloudFront distribution

Passes and the npm package use the custom domain, not the CloudFront domain. A replaced distribution therefore keeps working once the Route 53 aliases point at it, and Terraform updates them in the same apply. Never replace the distribution to fix a configuration problem; change the configuration in place. If the custom domain itself is lost, issued passes stop updating and attendees must [reissue them](#reissuing-passes).

### DynamoDB table

Deletion protection and `prevent_destroy` guard it. Point-in-time recovery is deliberately off, so that `forget_me` is a real erasure, which means there is no backup to restore. Its records expire 24 hours after each session ends. If it is lost, let Terraform create a new empty table (import nothing). If the old name `compass-<env>` is still held, set the variable `table_name` to a new name. Then have attendees reissue their passes.

### A secret

The Secrets Manager recovery window (30 days by default) blocks re-creating a deleted secret under the same name. Inside the window, restore it with `aws secretsmanager restore-secret --secret-id compass/<env>/<name> --region us-east-1` and bring it back under Terraform with an import. After the window, reload the values with `scripts/load-secrets.sh` (see [Secrets](Secrets)).

Two of the four need extra care when the value itself is gone:

- **`app` (the pepper).** Prefer the restore path. A new pepper changes every owner hash (`subHash`), so every existing pass loses its owner match and every attendee must reissue. To replace it, run `scripts/load-secrets.sh <env> app --rotate-pepper --pepper-id pN` with the next id, then release.
- **`origin-verify`.** Generate a new value (`scripts/load-secrets.sh <env> edge-values ...`), write it with `scripts/load-secrets.sh <env> origin-verify --origin-verify-file <file> --rotate`, set the HCP variable from the same file with `scripts/set-workspace-secrets.sh <env> --origin-verify-file <file>`, and release. The pepper is untouched, so passes are unaffected. The API refuses traffic until the edge and the secret agree again.

### Site bucket

The site is reproducible. If the bucket is lost, let Terraform create a new one and run `scripts/release.sh <env>` to sync the site again.

## Reissuing passes

There is no bulk reissue command. After a lost custom domain, table or pepper, each attendee reissues their own [boarding passes](Glossary#boarding-pass) with two MCP tools, in this order:

1. **`forget_me`.** It asks the attendee to confirm. It [voids](Glossary#void) their passes on the Compass service (`DELETE /api/v1/me`) and, only if that succeeds, removes their local Compass data: the pass record, the schedule snapshot, the tech profile, the GitHub tokens and any QR page. Passes already in a wallet stay on the phone until the attendee removes them, but they are voided and expire.
2. **`issue_all_boarding_passes`.** It reads the attendee's schedule again and issues a new pass for every reserved session.

`forget_me` clears much more than passes, so tell attendees what it removes. For one wrong pass, use `issue_boarding_pass` or `sync_passes` instead. See [MCP tools](MCP-Tools).

## Never

- Never run `terraform destroy` or `terraform state rm` against an environment. The only exception is the dev [Teardown](Teardown).
- Never remove `prevent_destroy` to get a plan through.
- Never fix a resource in the console.

## Related pages

- [Release](Release)
- [Secrets](Secrets)
- [Teardown](Teardown)
- [Data and privacy](Data-and-Privacy)
- [Infrastructure decisions](Decisions-Infrastructure)
