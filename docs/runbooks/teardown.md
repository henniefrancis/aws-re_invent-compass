# Runbook: tear down the dev environment

Owner-run, after 1 November. Terraform only: nothing is deleted in the console or with the AWS CLI. The environment is removed by lifting the protections through code and variables, planning a destroy, and applying it.

The retained resources are protected on purpose (see `rollback.md`): `release.sh` refuses any plan that destroys them, `prevent_destroy` makes Terraform fail, the table has deletion protection, the site bucket is not force-destroyable and the secrets have a recovery window. This runbook lifts each of those for dev only. Never run it against prod.

## Preconditions

- Prod is released and healthy, and nothing you still need lives in dev.
- You know which workspace is dev. Export `TF_CLOUD_ORGANIZATION`, `TF_CLOUD_PROJECT` and `TF_WORKSPACE` from `infra/envs/dev/cloud.auto.tfbackend`, and check twice that `TF_WORKSPACE` is the dev workspace.
- The dev workspace plan and apply roles still exist (they are removed last).
- A saved copy of anything from dev you want to keep (there is no table backup: point-in-time recovery is off).

## Steps

1. Create a throwaway branch from the released commit: `git switch -c teardown/dev <tag or commit>`. It is never merged, never pushed to `main`, and is deleted at the end. Prod keeps running from the normal branch.
2. Lift the variable-driven protections in the dev workspace (HCP workspace variables, or `terraform.tfvars` for a local run):
   - `table_deletion_protection = false`
   - `site_force_destroy = true` (lets Terraform empty the versioned site bucket; the apply role has the delete rights for this)
   - `secret_recovery_window_days = 0` (the four secrets are deleted at once instead of after 30 days)

   Apply that change with `scripts/release.sh dev`. The plan shows in-place updates only: the table protection, the bucket and the four secrets. If it shows a destroy, stop.

3. Lift `prevent_destroy` with a code change on the throwaway branch. It is a lifecycle meta-argument and cannot be a variable. Delete the `lifecycle { prevent_destroy = true }` block of each of the seven retained resources:
   - `infra/modules/edge/main.tf`: `aws_cloudfront_distribution.this`
   - `infra/modules/data/main.tf`: `aws_dynamodb_table.this`
   - `infra/modules/site/main.tf`: `aws_s3_bucket.this`
   - `infra/modules/secrets/main.tf`: `apple_pass`, `google_wallet`, `app` and `origin_verify`

   Commit the change on the branch. The retained-resource tests and `release.sh` will refuse this branch for any other use, which is intended.

4. Plan the destroy yourself, in HCP, with Terraform directly (`release.sh` refuses destroys by design):

   ```
   cd infra/envs/dev
   terraform init
   terraform plan -destroy -out=tfplan
   ```

   Read the plan. It must name only dev resources: the CloudFront distribution, the WAF web ACL, the API, the two Lambdas and their roles, the table, the secrets, the site bucket, the log groups, the alarms, the SNS topic and the KMS key and alias. It must not touch the bootstrap, the roles, the boundaries, the account API Gateway role, the account budget or anything of prod.

5. Apply it: `terraform apply tfplan`. The distribution is disabled and then deleted, which takes several minutes; the WAF web ACL follows once it is detached. Delete the local `tfplan` file afterwards.
6. Confirm the workspace state is empty: `terraform state list` prints nothing. Do not use the console to check or to delete anything.
7. Discard the branch: `git switch -` and `git branch -D teardown/dev`.

## What is left, and what it costs

- The KMS key of the alarm topic is scheduled for deletion with its 7 day window; it stops costing after that.
- The account budget stays (it also covers prod).
- The dev workspace, its two roles and the dev boundary stay in the bootstrap. They cost nothing. Removing them is a later bootstrap change (drop `dev` from the environment set) and is only needed if you want the account fully clean.
- The CloudFront domain of dev stops resolving, so any pass issued from dev stops updating.

## If the destroy fails

- A bucket delete that fails on a non-empty bucket means step 2 was not applied: set `site_force_destroy = true`, apply, and plan the destroy again.
- A refusal naming `prevent_destroy` means step 3 missed a resource.
- An `AccessDenied` means a statement of the dev apply role in `infra/bootstrap` is too narrow for a delete: extend only that statement, apply the bootstrap, and re-review the diff before you retry.
