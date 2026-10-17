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

## Roll-forward notes for the six retained resources

Each carries `prevent_destroy` in Terraform, and `scripts/release.sh` refuses any plan that destroys or replaces it.

### CloudFront distribution

Its domain is baked into every issued pass (`webServiceURL`) and into the npm package default API URL. If the distribution is lost, issued passes stop updating and attendees reissue them with `sync_passes --reissue-all`. Do not replace it to fix a configuration problem: change the configuration in place.

### DynamoDB table

Deletion protection and `prevent_destroy` guard the table. Point-in-time recovery is deliberately off (owner decision) so that `forget_me` is a real erasure, so there is no restore from backup. The table holds records only until session end plus 24 hours. If it is lost, create a new empty table through Terraform (import nothing), switch the `table_name` variable if the old name is still held, and have attendees reissue passes.

### Secret `compass/<env>/apple-pass`

The Secrets Manager recovery window blocks re-creating the same name. If it was deleted, restore it inside the window with `aws secretsmanager restore-secret --secret-id compass/<env>/apple-pass`, then `terraform import` the container in HCP (owner-run). If the window has passed, create it under a new name and reload the values with `scripts/load-secrets.sh`.

### Secret `compass/<env>/google-wallet`

Same as the Apple secret: restore inside the recovery window with `restore-secret`, then `terraform import`. After the window, reload the values with `scripts/load-secrets.sh <env> google`.

### Secret `compass/<env>/app`

Same restore path. If the values are lost, run `scripts/load-secrets.sh <env> edge-values` and `scripts/load-secrets.sh <env> app --rotate`, set the HCP variables `origin_verify_value` and `api_key_value` from the new files, and release again. Existing passes are unaffected, but `subHash` values derived from the old pepper no longer match, so attendees reissue passes.

### Site bucket

Reproducible: the site is rebuilt and synced by the release script. `prevent_destroy` only stops a mistaken plan from taking the live site down. If the bucket is lost, re-create it through Terraform and run `scripts/release.sh <env>` to sync the site again.

## Never

- Do not run `terraform destroy` or `terraform state rm` against an environment.
- Do not disable `prevent_destroy` to get a plan through.
