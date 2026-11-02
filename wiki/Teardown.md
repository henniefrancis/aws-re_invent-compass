# Teardown

_For operators: how to remove the dev environment completely through Terraform, what stays behind, and what to do if the destroy fails._

This runbook removes `dev` once it is no longer needed. It is owner-run and Terraform only: nothing is deleted in the console or with the AWS CLI. You lift each protection through code and variables, plan a destroy, read it, and apply it. **Never run it against prod.**

## Why it takes several steps

The [retained resources](Rollback#retained-resources) are protected on purpose, in several separate ways, and each must be lifted for dev only:

| Protection                                                 | Lifted by                                    |
| ---------------------------------------------------------- | -------------------------------------------- |
| `scripts/release.sh` refuses any plan that destroys them   | Planning the destroy with Terraform directly |
| `prevent_destroy` on seven resources                       | A code change on a throwaway branch          |
| Deletion protection on the DynamoDB table                  | `table_deletion_protection = false`          |
| The site bucket is not force-destroyable (it is versioned) | `site_force_destroy = true`                  |
| The secrets have a 30-day recovery window                  | `secret_recovery_window_days = 0`            |

## Preconditions

- Prod is released and healthy, and nothing you still need lives in dev.
- You have saved anything from dev you want to keep. There is no table backup: point-in-time recovery is off.
- You know which workspace is dev. Export `TF_CLOUD_ORGANIZATION`, `TF_CLOUD_PROJECT` and `TF_WORKSPACE` from `infra/envs/dev/cloud.auto.tfbackend`, and check twice that `TF_WORKSPACE` is the dev workspace.
- The dev plan and apply roles still exist. They are removed last, if at all.

## Steps

1. **Make a throwaway branch** from the released commit: `git switch -c teardown/dev <tag or commit>`. It is never merged and never pushed to `main`, and you delete it at the end. Prod keeps running from the normal branches.
2. **Lift the variable-driven protections** in the dev HCP workspace:

   ```
   table_deletion_protection   = false
   site_force_destroy          = true
   secret_recovery_window_days = 0
   ```

   Apply them with `scripts/release.sh dev`. The plan shows in-place updates only: the table, the bucket and the four secrets. If it shows a destroy, stop.

3. **Lift `prevent_destroy`** with a code change on the branch. It is a lifecycle meta-argument, so it cannot be a variable. Delete the `lifecycle { prevent_destroy = true }` block of each of the seven retained resources:
   - [infra/modules/edge/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/edge/main.tf): `aws_cloudfront_distribution.this`
   - [infra/modules/data/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/data/main.tf): `aws_dynamodb_table.this`
   - [infra/modules/site/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/site/main.tf): `aws_s3_bucket.this`
   - [infra/modules/secrets/main.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/modules/secrets/main.tf): `apple_pass`, `google_wallet`, `app` and `origin_verify`

   Leave the domain registration in the bootstrap alone. Commit the change on the branch. The retained-resource tests now fail on this branch, which is intended: it is good for nothing else.

4. **Plan the destroy yourself**, in HCP Terraform, with Terraform directly (`release.sh` refuses destroys by design):

   ```
   cd infra/envs/dev
   terraform init
   terraform plan -destroy -out=tfplan
   ```

   Read the whole plan. It must name only dev resources: the CloudFront distribution, the dev certificate and its `dev.reinvent-compass.vegas` records in the zone, the WAF web ACL, the API and its key and usage plan, the two Lambdas and their roles, the table, the four secrets, the site bucket, the three log groups, the five alarms, the SNS topic, and the KMS key and alias. It must not touch the bootstrap, the plan and apply roles, the boundaries, the account API Gateway role, the budget, the domain, or anything of prod.

5. **Apply it**: `terraform apply tfplan`. CloudFront disables and then deletes the distribution, which takes several minutes; the WAF web ACL follows once it is detached. Delete the local `tfplan` file afterwards.
6. **Confirm the state is empty**: `terraform state list` prints nothing. Do not use the console to check or to delete anything.
7. **Discard the branch**: `git switch -` and `git branch -D teardown/dev`.
8. **Delete the dev Google key.** In the Google Cloud console, delete the service account key that was loaded into `compass/dev/google-wallet`.

## What stays, and what it costs

- The KMS key of the dev alarm topic is scheduled for deletion with its 7-day window and stops costing after that.
- The account budget stays; it covers prod too.
- The dev HCP workspace, its two roles and the dev boundary stay in the bootstrap. They cost nothing. Removing them is a later bootstrap change (drop `dev` from the environment set in [infra/bootstrap/locals.tf](https://github.com/henniefrancis/aws-re_invent-compass/blob/develop/infra/bootstrap/locals.tf) and from `hcp_workspaces`), needed only if you want the account fully clean.
- The domain and its hosted zone stay: prod uses them.
- `dev.reinvent-compass.vegas` and the dev CloudFront domain stop resolving, so any pass issued from dev stops updating.
- WAF is the largest running cost per environment, so removing dev takes away roughly half of the monthly spend (see [Alarms](Alarms#the-budget)).

## If the destroy fails

- **The bucket delete fails because the bucket is not empty**: step 2 was not applied. Set `site_force_destroy = true`, release dev, and plan the destroy again.
- **A refusal names `prevent_destroy`**: step 3 missed a resource.
- **`AccessDenied`**: a statement of the dev apply role in [infra/bootstrap](https://github.com/henniefrancis/aws-re_invent-compass/tree/develop/infra/bootstrap) is too narrow for a delete. Extend only that statement, apply the bootstrap, and review the diff before you retry.

## Related pages

- [Rollback](Rollback)
- [Operations](Operations)
- [Release](Release)
- [Infrastructure decisions](Decisions-Infrastructure)
