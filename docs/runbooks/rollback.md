# Runbook: roll forward and retained resources

Owner-run. Rollback in this project is always a roll forward: the previous commit's bundle is released again. Retained resources are never destroyed.

## Roll forward from the previous commit's bundle

1. Find the last good release tag or commit: `git tag --list 'v*'` or `git log --oneline`.
2. Check out that commit in a clean working tree: `git switch --detach <tag or commit>`.
3. Run `npm ci`, then `scripts/release.sh <env>` for the affected environment. The script builds that commit's Lambda bundles and site and shows a saved plan.
4. Read the plan. It should change only the Lambda code, the API deployment and the site. Type `yes` only if no retained resource is touched (the script refuses otherwise).
5. After the health check passes, return to your branch: `git switch -`.
6. If the bad release changed Terraform, the plan may need to undo a configuration change. The refusal checks still apply: a destroy or replace of a retained resource is never offered.

Order for a bad release across the product: backend first, then the site, then npm. The npm client points only at prod and the API is additive, so a backend-new, client-old window is compatible.

## Roll-forward notes for the seven retained resources

Each of the seven carries `prevent_destroy` in Terraform, and `scripts/release.sh` refuses any plan that destroys or replaces it.

### CloudFront distribution

Passes and the npm package use the custom domain (ADR-031), not the CloudFront domain, so a replaced distribution keeps working once the Route 53 alias points at it; Terraform updates the alias in the same apply. If the custom domain itself is lost, issued passes stop updating and attendees reissue them with `sync_passes --reissue-all`. Do not replace it to fix a configuration problem: change the configuration in place.

### DynamoDB table

Deletion protection and `prevent_destroy` guard the table. Point-in-time recovery is deliberately off (owner decision) so that `forget_me` is a real erasure, so there is no restore from backup. The table holds records only until session end plus 24 hours. If it is lost, create a new empty table through Terraform (import nothing), switch the `table_name` variable if the old name is still held, and have attendees reissue passes.

### Secret `compass/<env>/apple-pass`

The Secrets Manager recovery window blocks re-creating the same name. If it was deleted, restore it inside the window with `aws secretsmanager restore-secret --secret-id compass/<env>/apple-pass`, then `terraform import` the container in HCP (owner-run). If the window has passed, create it under a new name and reload the values with `scripts/load-secrets.sh`.

### Secret `compass/<env>/google-wallet`

Same as the Apple secret: restore inside the recovery window with `restore-secret`, then `terraform import`. After the window, reload the values with `scripts/load-secrets.sh <env> google`.

### Secret `compass/<env>/app`

Holds the pepper. Same restore path. If the value is lost, run `scripts/load-secrets.sh <env> app --rotate-pepper` and release again. Replacing the pepper changes every `subHash`, so existing passes lose their owner match and attendees reissue them. Prefer the restore path.

### Secret `compass/<env>/origin-verify`

Same restore path. If the value is lost, run `scripts/load-secrets.sh <env> edge-values` and `scripts/load-secrets.sh <env> origin-verify --rotate` with the new file, set the HCP variable `origin_verify_value` from the same file with `scripts/set-workspace-secrets.sh`, and release again. The pepper is untouched, so passes are unaffected; the API refuses traffic until the edge and the secret agree again.

### Site bucket

Reproducible: the site is rebuilt and synced by the release script. `prevent_destroy` only stops a mistaken plan from taking the live site down. If the bucket is lost, re-create it through Terraform and run `scripts/release.sh <env>` to sync the site again.

## Never

- Do not run `terraform destroy` or `terraform state rm` against an environment.
- Do not disable `prevent_destroy` to get a plan through.
