# Runbook: release an environment

Owner-run. The agent never runs a deploy. Deploy `dev` first and `prod` second (ADR-020).

## Command

```
scripts/release.sh dev
scripts/release.sh prod
```

The script builds the two Lambda bundles and the site, saves a Terraform plan in HCP Terraform, refuses any plan that destroys or replaces a retained resource or touches an unexpected resource type, asks you to type `yes`, applies the saved plan, syncs the site, invalidates the CloudFront cache and checks `GET /api/v1/health`.

## Deploy-day checklist (release 0.1.0)

Owner-run, in this order. Do not skip a step or reorder them. The detail lives in the linked runbooks, so this list only gives the order. The release is cut from `main` as 0.1.0. There is no release branch.

Before the day: the prod preconditions below are met, `secrets.md` steps 1 and 2 are done for prod (the edge values exist and the HCP variables are set), and `npm-release.md` "Prepare a release" is committed on `develop`.

1. Open a PR from `develop` into `main`. Wait for CI to go green. Merge it.
2. Check out `main` into a clean working tree (`git switch main`, `git pull`, `git status` shows nothing) and run `npm ci`.
3. Rehearse on dev from that checkout: `scripts/release.sh dev`. It must end with `health check passed (HTTP 200)`.
4. Run `scripts/release.sh prod`. Type `prod` when asked. The health check at the end fails by design, because the secrets are not loaded yet (first-time setup, step 7). That is not a failed deploy.
5. Create a fresh Google service account key in the Google Cloud console and save it outside the repository (`google-wallet-setup.md`, "Prod key and prod class").
6. Load the prod secrets in this order (`secrets.md`, "Commands"): `scripts/load-secrets.sh prod origin-verify --origin-verify-file <file>`, then `scripts/load-secrets.sh prod app`, then `scripts/load-secrets.sh prod apple --p12 <file> --wwdr <file> --pass-type-id <id> --team-id <id>`, then `scripts/load-secrets.sh prod google --service-account <key file> --issuer-id <id>`.
7. Run `scripts/check-secrets.sh prod`. All seven values must report present.
8. Create the Google class: `node scripts/google-wallet-class.mjs --service-account <key file> --issuer-id <id> --env prod` (`google-class.md`). Expect `class: created`.
9. Shred the Google key, the `.p12` copy and the edge value files, and clear your shell history of anything that held a value (`secrets.md`, last step).
10. Run `scripts/release.sh prod` again. The health check must pass (HTTP 200) and the plan must show zero changes apart from the one in-place api Lambda update that a new commit causes (see "What the script does", step 7).
11. Confirm the prod alarm topic subscription: click the link AWS emailed to the alarm address (`alarms.md`).
12. Check the apex domain yourself: `curl https://reinvent-compass.vegas/api/v1/health` must return HTTP 200.
13. Smoke test prod on a real iPhone and a real Android phone: open the board page, issue a pass, add it to the wallet.
14. Run the `e2e` workflow (`.github/workflows/e2e.yml`, started by hand from the Actions tab) on the `main` commit. It must be green.
15. Tag and publish the package (`npm-release.md`, "Tag order"): create the tag `v0.1.0` on the `main` commit that prod now runs, push it, and approve the `npm-publish` environment when the publish job waits.

After the package is published:

16. On a clean machine, run `npx reinvent-compass@0.1.0 demo` and check that it starts.
17. In Kiro, use "Import power from GitHub" on the repository and check that the Power loads.
18. Set `packageVersion` to `'0.1.0'` in `site/src/lib/content/links.ts`, then release the site (`scripts/release.sh prod`). Proposal for the owner: change the status line in `README.md` from "built, not yet released" to the released state, with the live links, because the README is the owner's file.
19. Deprecate the placeholder: `npm deprecate reinvent-compass@0.0.1 "Placeholder. Use 0.1.0 or later."`
20. Merge `main` back into `develop` so the two branches match.
21. Watch for 30 to 60 minutes: the five alarms (`alarms.md`) and the health check. If something breaks, use `rollback.md` to roll forward, or `kill-switch.md` to block traffic at the edge.

Passes issued before a lost secret or custom domain cannot be repaired in bulk. See "Reissuing passes" in `rollback.md`. Notes from the first dev deploy are in `first-deploy-notes.md`.

## Preconditions

1. The bootstrap has been applied once (see "First-time setup" below) and a second apply of `infra/bootstrap` shows no changes.
2. `infra/envs/<env>/cloud.auto.tfbackend` exists (copy the `.example`, fill in the HCP organisation, project and workspace names). It is git-ignored.
3. The custom domain (ADR-031). The domain is registered and its Route 53 hosted zone exists in this account. The bootstrap registers it (see "Registering the domain" below; with `register_domain = false` it reads a zone that an earlier registration created). Because the domain is registered with Route 53 Domains in the same account, the name servers are normally set to the hosted zone automatically; check once with `dig NS reinvent-compass.vegas +short` (or the Route 53 console, read only) that they match the zone name servers. The workspace variables are, per environment:
   - dev: `domain_name = dev.reinvent-compass.vegas`; `hosted_zone_name` keeps its default `reinvent-compass.vegas`; `extra_aliases` is not set.
   - prod: `domain_name = reinvent-compass.vegas`; `hosted_zone_name` keeps its default; `extra_aliases` is not set (the passes use the apex too).

   The bootstrap creates them from `workspace_variables` (see `infra/bootstrap/terraform.tfvars.example`). The ACM certificate validates by itself: the first apply creates the validation records in the zone and waits for them, usually a few minutes. If it waits for long, repeat the delegation check above. With these variables set `PUBLIC_BASE_URL` is `https://<domain_name>` from the first apply, so the second apply of step 6 below is not needed. With `domain_name` unset the old behaviour stays.
   3a. The HCP workspace for the environment exists and is CLI-driven. The bootstrap creates it with the `tfe` provider, with `TFC_AWS_PROVIDER_AUTH`, `TFC_AWS_PLAN_ROLE_ARN` and `TFC_AWS_APPLY_ROLE_ARN` and the non-sensitive Terraform variables you put in `workspace_variables`: `event_timezone`, `event_window_start`, `event_window_end` (from the Events API `GetEvent`) and `id_token_issuer` (spike SP2), with `id_token_jwks_uri`, `id_token_verifier`, `apns_push_type` and the two switches when the spikes need them. The sensitive variables `alarm_email`, `origin_verify_value` and `api_key_value` are set by `scripts/set-workspace-secrets.sh` (see `secrets.md`).

4. You are signed in to AWS with your own SSO session (`aws sso login`) for the site sync and the cache invalidation, in the Compass account. If your shell's default identity belongs to another account, set `AWS_PROFILE` to your Compass profile first (for example `AWS_PROFILE=<profile> scripts/release.sh dev`). Terraform itself uses the HCP dynamic credentials.
5. `terraform`, `jq`, `npm`, `aws` and `curl` are installed, and `npm ci` has been run.
6. The pass-service Lambda build exists (`npm run build:lambda --workspace @compass/pass-service`, writing `packages/pass-service/dist/lambda/api.zip` and `passkit.zip`) and the site build works. Override either with `COMPASS_LAMBDA_BUILD_CMD` or `COMPASS_SITE_BUILD_CMD`, and the site folder with `COMPASS_SITE_DIR`.
7. The provider lock files of the three roots are committed (`infra/bootstrap`, `infra/envs/dev` and `infra/envs/prod`). To regenerate one, run this with network access in that root: `terraform providers lock -platform=linux_amd64 -platform=windows_amd64 -platform=darwin_arm64`, and commit the file. A lock made by a plain `terraform init` on one machine fails on the HCP runners.
8. Workspace hygiene that IAM cannot enforce: speculative plans from forks and VCS auto-apply stay disabled (the bootstrap sets `speculative_enabled = false` and `auto_apply = false`, with no VCS connection), and access to the workspace state is limited to you. API key values can be read by the plan role through `apigateway:GET`, because the key resource refresh needs it, so state access is what protects them.
9. Reserved concurrency (api 20, passkit 10) is a deliberate cap. A new AWS account can have a Lambda concurrency quota too low to reserve any; if the first apply fails on reserved concurrency, request a Lambda concurrency quota increase in the Service Quotas console and keep the defaults, rather than setting `api_reserved_concurrency` and `passkit_reserved_concurrency` to `-1`. A value of `-1` removes the cap entirely, so a flood could run up Lambda cost with nothing but the WAF rate rules and the budget alarm in the way.
10. The upload to HCP: the Terraform CLI is run from `infra/envs/<env>` and, because the workspace working directory is `envs/<env>`, uploads the tree one level up, the `infra/` directory (so `modules/` travels with it). The ignore file at `infra/.terraformignore` is therefore the upload root file, and the same file is kept in `infra/envs/dev` and `infra/envs/prod`. It excludes real tfvars, auto tfvars, `.env*`, `*.pem`, `*.p12`, state and plan files at every depth; `infra/build/` is deliberately uploaded because the remote run needs the Lambda zips. A static test applies these rules to every file under `infra/`.
11. The bootstrap writes the two role ARN workspace variables with write-only attributes, so they stay out of state. Terraform therefore pushes a changed ARN only when `value_wo_version` is raised: if a plan or apply role ARN ever changes (for example the role is recreated), bump `value_wo_version` on `tfe_variable.plan_role_arn` and `tfe_variable.apply_role_arn` in `infra/bootstrap/workspaces.tf` and apply the bootstrap again, or the workspace keeps assuming the old role. The workspaces also set `global_remote_state = false`, so no other workspace can read their state.

## First-time setup of an environment

Run these once per environment, in order. They are the owner-only checks that no agent can do.

1. Create the bootstrap workspace by hand in HCP (the one documented seed exception to the golden rule: it must exist before Terraform can manage anything). Set it to Local execution. Export `TFE_TOKEN`, `TF_CLOUD_ORGANIZATION` and `TF_WORKSPACE` in your shell and copy `infra/bootstrap/terraform.tfvars.example` to `terraform.tfvars`. Run `scripts/bootstrap.sh` in CloudShell or a shell with your own credentials. It creates the OIDC provider, the roles, the boundaries, the API Gateway account role, and the dev and prod workspaces with their variables. Run it a second time: Terraform must report no changes. AWS allows one `app.terraform.io` OIDC provider per account: if another configuration already manages one (`aws iam list-open-id-connect-providers`), set `create_oidc_provider = false` and the bootstrap reads it instead. It must list the `aws.workload.identity` audience, and its owner must keep it while Compass runs.
   Registering the domain: to have the bootstrap buy `reinvent-compass.vegas`, set `register_domain = true` and fill in `domain_contact` in `terraform.tfvars` (personal data, git-ignored; privacy protection hides it from WHOIS). Before you apply:
   - Check the price with `aws route53domains list-prices --region us-east-1 --tld vegas` and that the domain is free with `aws route53domains check-domain-availability --region us-east-1 --domain-name reinvent-compass.vegas`. The charge lands on the account in the month you apply, so the budget alerts may fire that month.
   - If an earlier registration of the domain is still in progress (`aws route53domains list-operations --region us-east-1`), wait for it instead. If the domain is already registered in this account, do not register it again: add an `import` block for `aws_route53domains_domain.this[0]` with id `reinvent-compass.vegas`, plan, and apply the import.
   - If a hosted zone named `reinvent-compass.vegas` already exists, say so first: the registration creates its own zone, and a second zone with the same name breaks the zone lookups.
     The plan shows one `aws_route53domains_domain` to create; applying it is the purchase and can take up to an hour. Confirm the registrant email from Route 53 within 15 days, or the registry suspends the domain. The resource has `prevent_destroy`, auto-renew and the transfer lock on.
2. Generate the edge values locally and set the sensitive HCP variables from them (see `secrets.md`, steps 1 and 2).
3. Run `scripts/release.sh <env>`. The first run creates the infrastructure with empty secret containers.
4. Load the secrets (see `secrets.md`): `origin-verify`, `app`, `apple`, `google`. Then run `scripts/check-secrets.sh <env>`.
5. Create the Google class (see `google-class.md`).
6. Only when `domain_name` is not set: set the variable `public_base_url` to `https://` plus the value of the `cloudfront_domain_name` output (no trailing slash) and run `scripts/release.sh <env>` again. The distribution depends on the Lambdas, so the Lambdas cannot know their own public address until the first apply is done; this second apply only updates the two Lambda configurations.
7. Expect the health check of the first release (step 3) to fail, and the script to exit non-zero: by design the API cannot answer until the origin-verify secret is loaded (step 4) and `PUBLIC_BASE_URL` is set (step 6). That is not a failed deploy; carry on with steps 4 to 6. The health check of the release in step 6 is the first one that must pass.
8. Confirm that an immediately following plan shows no changes (the dev zero-diff check), and that the release ended with an HTTP 200 health check.

## What the script does

1. Checks that the argument is `dev` or `prod`; anything else prints the usage and stops before any Terraform runs.
2. Reads `infra/envs/<env>/cloud.auto.tfbackend` and exports `TF_CLOUD_ORGANIZATION`, `TF_CLOUD_PROJECT` and `TF_WORKSPACE`. A missing key stops the script and is named.
3. Checks that you have an AWS session, then builds the Lambda zips into `infra/build/` and the site, and adds the Google Wallet pass images (`packages/pass-service/artwork/google/*.png`) to the built site under `wallet/`, so the site sync uploads them (pass-service task 47, infra task 25).
4. Runs `terraform init` in `infra/envs/<env>`, checks with `aws s3api head-bucket` that your session can reach the site bucket of the last apply (a first deploy has none yet and skips this), and runs `terraform plan -out`. A session in another account stops here with a message that names `AWS_PROFILE`, before anything is planned or applied.
5. Refuses the plan, prints the affected addresses or types and exits non-zero if it would destroy or replace a retained resource, or touches a resource type outside the allow list.
6. Prints the plan counts and waits for you to type `yes` (dev) or `prod` (prod). Anything else exits without applying. The saved plan file `tfplan` is written to `infra/envs/<env>` (it is git-ignored and excluded from the HCP upload) and the script removes it when it ends, whatever the outcome; the plan JSON that the refusal checks read is held in memory only and never written to disk.
7. Applies the saved plan, syncs the site to the site bucket, and invalidates the CloudFront cache. A failure in any of these exits non-zero. An empty plan skips the apply (HCP Terraform refuses to apply a saved plan with no changes) and still asks for the typed word, syncs, invalidates and checks health. The `service_version` variable comes from `git describe`, so after a new commit the api Lambda shows one in-place update; the zero-diff check is only meaningful with no commit in between.
8. Calls `GET /api/v1/health` through CloudFront, retrying while the distribution settles. Only HTTP 200 is success.

## Expected success outcome

The script ends with `health check passed (HTTP 200)` and exit status 0. A second plan in HCP shows no changes.

## If something goes wrong

- A plan refusal names the resource or type. Fix the cause; never edit the script to get past it.
- An `AccessDenied` from the apply phase means a statement in the apply role policy in `infra/bootstrap` is too narrow. Extend only that one statement, apply the bootstrap again, and re-review the diff before you run the release again. Never widen a statement to a wildcard to get past it, and never let an IAM write statement name anything but the two Lambda roles. Expect this on the first dev apply: the policy has not been exercised against AWS.
- The alarm topic subscription must be confirmed once with the link AWS emails to the alarm address.
- A customer managed KMS key for the alarm topic costs about USD 1 a month, which counts against the USD 60 account budget.
- To roll back, see `rollback.md`. For alarms and the switches, see `alarms.md`. To remove dev after 1 November, see `teardown.md`.
