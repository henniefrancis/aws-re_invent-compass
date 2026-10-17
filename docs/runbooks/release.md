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
3. The HCP workspace for the environment is CLI-driven and has these variables:
   - environment variables `TFC_AWS_PROVIDER_AUTH` = `true`, `TFC_AWS_PLAN_ROLE_ARN` and `TFC_AWS_APPLY_ROLE_ARN` (from `terraform output -json plan_role_arns` and `apply_role_arns` of the bootstrap);
   - Terraform variables `alarm_email`, `origin_verify_value` and `api_key_value` (sensitive), plus `event_timezone`, `event_window_start`, `event_window_end` (from the Events API `GetEvent`) and `id_token_issuer` (spike SP2), with `id_token_jwks_uri`, `id_token_verifier`, `apns_push_type` and the two switches when the spikes need them.
4. You are signed in to AWS with your own SSO session (`aws sso login`) for the site sync and the cache invalidation. Terraform itself uses the HCP dynamic credentials.
5. `terraform`, `jq`, `npm`, `aws` and `curl` are installed, and `npm ci` has been run.
6. The pass-service Lambda build exists (`npm run build:lambda --workspace @compass/pass-service`, writing `packages/pass-service/dist/lambda/api.zip` and `passkit.zip`) and the site build works. Override either with `COMPASS_LAMBDA_BUILD_CMD` or `COMPASS_SITE_BUILD_CMD`, and the site folder with `COMPASS_SITE_DIR`.

## First-time setup of an environment

Run these once per environment, in order. They are the owner-only checks that no agent can do.

1. Apply the bootstrap once, in CloudShell or a shell with your own credentials: `scripts/bootstrap.sh`. Copy `infra/bootstrap/terraform.tfvars.example` to `terraform.tfvars` first. Run `scripts/bootstrap.sh` a second time: Terraform must report no changes.
2. Generate the edge values locally: `scripts/load-secrets.sh <env> edge-values --origin-verify-out <new file> --api-key-out <new file>`. Set the HCP variables `origin_verify_value` and `api_key_value` from the two files, then shred them (see `secrets.md`).
3. Run `scripts/release.sh <env>`. The first run creates the infrastructure with empty secret containers.
4. Load the secrets (see `secrets.md`): the app secret first, then the Apple and Google values.
5. Create the Google class (see `google-class.md`).
6. Set the variable `public_base_url` to `https://` plus the value of the `cloudfront_domain_name` output (no trailing slash) and run `scripts/release.sh <env>` again. The distribution depends on the Lambdas, so the Lambdas cannot know their own public address until the first apply is done; this second apply only updates the two Lambda configurations.
7. Confirm that an immediately following plan shows no changes (the dev zero-diff check), and that the release ended with an HTTP 200 health check.

## What the script does

1. Checks that the argument is `dev` or `prod`; anything else prints the usage and stops before any Terraform runs.
2. Reads `infra/envs/<env>/cloud.auto.tfbackend` and exports `TF_CLOUD_ORGANIZATION`, `TF_CLOUD_PROJECT` and `TF_WORKSPACE`. A missing key stops the script and is named.
3. Builds the Lambda zips into `infra/build/` and the site.
4. Runs `terraform init` and `terraform plan -out` in `infra/envs/<env>`.
5. Refuses the plan, prints the affected addresses or types and exits non-zero if it would destroy or replace a retained resource, or touches a resource type outside the allow list.
6. Prints the plan counts and waits for you to type `yes`. Anything else exits without applying.
7. Applies the saved plan, syncs the site to the site bucket, and invalidates the CloudFront cache. A failure in any of these exits non-zero.
8. Calls `GET /api/v1/health` through CloudFront, retrying while the distribution settles. Only HTTP 200 is success.

## Expected success outcome

The script ends with `health check passed (HTTP 200)` and exit status 0. A second plan in HCP shows no changes.

## If something goes wrong

- A plan refusal names the resource or type. Fix the cause; never edit the script to get past it.
- An `AccessDenied` from the apply phase means a statement in the apply role policy in `infra/bootstrap` is too narrow. Extend that one statement, apply the bootstrap again, and run the release again. Expect this on the first dev apply: the policy has not been exercised against AWS.
- The alarm topic subscription must be confirmed once with the link AWS emails to the alarm address.
- A customer managed KMS key for the alarm topic costs about USD 1 a month, which counts against the USD 20 budget.
- To roll back, see `rollback.md`.
