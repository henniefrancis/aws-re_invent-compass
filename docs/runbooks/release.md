# Runbook: release an environment

Owner-run. The agent never runs a deploy. Deploy `dev` first and `prod` second (ADR-020).

## Command

```
scripts/release.sh dev
scripts/release.sh prod
```

The script builds the two Lambda bundles and the site, saves a Terraform plan in HCP Terraform, refuses any plan that destroys or replaces a retained resource or touches an unexpected resource type, asks you to type `yes`, applies the saved plan, syncs the site, invalidates the CloudFront cache and checks `GET /api/v1/health`.

## Preconditions

1. The bootstrap has been applied once (see "First-time setup" below) and a second apply of `infra/bootstrap` shows no changes.
2. `infra/envs/<env>/cloud.auto.tfbackend` exists (copy the `.example`, fill in the HCP organisation, project and workspace names). It is git-ignored.
3. The HCP workspace for the environment exists and is CLI-driven. The bootstrap creates it with the `tfe` provider, with `TFC_AWS_PROVIDER_AUTH`, `TFC_AWS_PLAN_ROLE_ARN` and `TFC_AWS_APPLY_ROLE_ARN` and the non-sensitive Terraform variables you put in `workspace_variables`: `event_timezone`, `event_window_start`, `event_window_end` (from the Events API `GetEvent`) and `id_token_issuer` (spike SP2), with `id_token_jwks_uri`, `id_token_verifier`, `apns_push_type` and the two switches when the spikes need them. The sensitive variables `alarm_email`, `origin_verify_value` and `api_key_value` are set by `scripts/set-workspace-secrets.sh` (see `secrets.md`).
4. You are signed in to AWS with your own SSO session (`aws sso login`) for the site sync and the cache invalidation. Terraform itself uses the HCP dynamic credentials.
5. `terraform`, `jq`, `npm`, `aws` and `curl` are installed, and `npm ci` has been run.
6. The pass-service Lambda build exists (`npm run build:lambda --workspace @compass/pass-service`, writing `packages/pass-service/dist/lambda/api.zip` and `passkit.zip`) and the site build works. Override either with `COMPASS_LAMBDA_BUILD_CMD` or `COMPASS_SITE_BUILD_CMD`, and the site folder with `COMPASS_SITE_DIR`.
7. The provider lock files of the three roots are committed. Until they are, generate them once, with network access, in each of `infra/bootstrap`, `infra/envs/dev` and `infra/envs/prod`: `terraform providers lock -platform=linux_amd64 -platform=windows_amd64 -platform=darwin_arm64`, and commit the three `.terraform.lock.hcl` files. A lock made by a plain `terraform init` on one machine fails on the HCP runners.
8. Workspace hygiene that IAM cannot enforce: speculative plans from forks and VCS auto-apply stay disabled (the bootstrap sets `speculative_enabled = false` and `auto_apply = false`, with no VCS connection), and access to the workspace state is limited to you. API key values can be read by the plan role through `apigateway:GET`, because the key resource refresh needs it, so state access is what protects them.
9. Reserved concurrency (api 20, passkit 10) is a deliberate cap. A new AWS account can have a Lambda concurrency quota too low to reserve any; if the first apply fails on reserved concurrency, request a Lambda concurrency quota increase in the Service Quotas console and keep the defaults, rather than setting `api_reserved_concurrency` and `passkit_reserved_concurrency` to `-1`. A value of `-1` removes the cap entirely, so a flood could run up Lambda cost with nothing but the WAF rate rules and the budget alarm in the way.
10. The upload to HCP: the Terraform CLI is run from `infra/envs/<env>` and, because the workspace working directory is `envs/<env>`, uploads the tree one level up, the `infra/` directory (so `modules/` travels with it). The ignore file at `infra/.terraformignore` is therefore the upload root file, and the same file is kept in `infra/envs/dev` and `infra/envs/prod`. It excludes real tfvars, auto tfvars, `.env*`, `*.pem`, `*.p12`, state and plan files at every depth; `infra/build/` is deliberately uploaded because the remote run needs the Lambda zips. A static test applies these rules to every file under `infra/`.
11. The bootstrap writes the two role ARN workspace variables with write-only attributes, so they stay out of state. Terraform therefore pushes a changed ARN only when `value_wo_version` is raised: if a plan or apply role ARN ever changes (for example the role is recreated), bump `value_wo_version` on `tfe_variable.plan_role_arn` and `tfe_variable.apply_role_arn` in `infra/bootstrap/workspaces.tf` and apply the bootstrap again, or the workspace keeps assuming the old role. The workspaces also set `global_remote_state = false`, so no other workspace can read their state.

## First-time setup of an environment

Run these once per environment, in order. They are the owner-only checks that no agent can do.

1. Create the bootstrap workspace by hand in HCP (the one documented seed exception to the golden rule: it must exist before Terraform can manage anything). Set it to Local execution. Export `TFE_TOKEN`, `TF_CLOUD_ORGANIZATION` and `TF_WORKSPACE` in your shell and copy `infra/bootstrap/terraform.tfvars.example` to `terraform.tfvars`. Run `scripts/bootstrap.sh` in CloudShell or a shell with your own credentials. It creates the OIDC provider, the roles, the boundaries, the API Gateway account role, and the dev and prod workspaces with their variables. Run it a second time: Terraform must report no changes.
2. Generate the edge values locally and set the sensitive HCP variables from them (see `secrets.md`, steps 1 and 2).
3. Run `scripts/release.sh <env>`. The first run creates the infrastructure with empty secret containers.
4. Load the secrets (see `secrets.md`): `origin-verify`, `app`, `apple`, `google`. Then run `scripts/check-secrets.sh <env>`.
5. Create the Google class (see `google-class.md`).
6. Set the variable `public_base_url` to `https://` plus the value of the `cloudfront_domain_name` output (no trailing slash) and run `scripts/release.sh <env>` again. The distribution depends on the Lambdas, so the Lambdas cannot know their own public address until the first apply is done; this second apply only updates the two Lambda configurations.
7. Confirm that an immediately following plan shows no changes (the dev zero-diff check), and that the release ended with an HTTP 200 health check.

## What the script does

1. Checks that the argument is `dev` or `prod`; anything else prints the usage and stops before any Terraform runs.
2. Reads `infra/envs/<env>/cloud.auto.tfbackend` and exports `TF_CLOUD_ORGANIZATION`, `TF_CLOUD_PROJECT` and `TF_WORKSPACE`. A missing key stops the script and is named.
3. Builds the Lambda zips into `infra/build/` and the site.
4. Runs `terraform init` and `terraform plan -out` in `infra/envs/<env>`.
5. Refuses the plan, prints the affected addresses or types and exits non-zero if it would destroy or replace a retained resource, or touches a resource type outside the allow list.
6. Prints the plan counts and waits for you to type `yes` (dev) or `prod` (prod). Anything else exits without applying. The saved plan is held in memory and never written to disk.
7. Applies the saved plan, syncs the site to the site bucket, and invalidates the CloudFront cache. A failure in any of these exits non-zero.
8. Calls `GET /api/v1/health` through CloudFront, retrying while the distribution settles. Only HTTP 200 is success.

## Expected success outcome

The script ends with `health check passed (HTTP 200)` and exit status 0. A second plan in HCP shows no changes.

## If something goes wrong

- A plan refusal names the resource or type. Fix the cause; never edit the script to get past it.
- An `AccessDenied` from the apply phase means a statement in the apply role policy in `infra/bootstrap` is too narrow. Extend only that one statement, apply the bootstrap again, and re-review the diff before you run the release again. Never widen a statement to a wildcard to get past it, and never let an IAM write statement name anything but the two Lambda roles. Expect this on the first dev apply: the policy has not been exercised against AWS.
- The alarm topic subscription must be confirmed once with the link AWS emails to the alarm address.
- A customer managed KMS key for the alarm topic costs about USD 1 a month, which counts against the USD 20 budget.
- To roll back, see `rollback.md`.
