# Implementation Plan: infra (stream S6)

## Overview

This plan builds all of stream S6: the Terraform under `infra/**` (except the S0-owned `infra/modules/api/openapi.yaml`), the owner-run scripts under `scripts/**`, and the runbooks under `docs/runbooks/**`. The implementation language is **Terraform / HCL** for the configuration, **Bash** for `bootstrap.sh`, `release.sh` and `load-secrets.sh`, and **Node.js (ESM `.mjs`)** for `google-wallet-class.mjs`, matching the design and the tech steering (Terraform only, HCP Terraform, us-east-1, AWS provider `~> 6.0`, `required_version >= 1.15, < 2.0`).

The build order lays the shared foundation first (version pins, provider, tags, ignore files), then the six leaf modules (each with its own plan-only native tests), then the two environment roots that compose all six modules, then the cross-cutting invariant tests, the repo-wide leakage scan, the owner-run scripts, and finally the runbooks.

## Execution rules (read before starting any task)

- **Every task is required.** There are no optional tasks and no `*` markers. Every test task must be done.
- **Sequential only.** Run tasks strictly in numeric order (1, 1.1, 1.2, 2, 2.1, ...). Do not run tasks in parallel and do not use Run All Tasks.
- **No subagent delegation.** Each task is performed directly in the chat session, saving files after each step. Do not delegate to a task-execution subagent.
- **File ownership.** Only files under `infra/**` (except the S0-owned `infra/modules/api/openapi.yaml`, which is read via `templatefile()` and never edited), `scripts/**` (not `spikes/`), `docs/runbooks/**`, `docs/article/screenshots/infra/`, and `.kiro/specs/infra/` are touched. Never edit `contracts/**`, `packages/**`, `package.json` or `package-lock.json`.
- **Offline checks only.** The only commands run are offline: `terraform fmt`, `terraform validate` (after `terraform init -backend=false`), `tflint`, `terraform test` with mock providers, Trivy config scan, and `shellcheck`. Never run `terraform init` against HCP, `terraform plan` against a real workspace, `terraform apply`, or any script in `scripts/`. The owner runs every deploy.
- **No secrets or identifiers in committed files.** No account ID, HCP organisation or workspace name, email, or ARN appears in any committed file. Only `.example` files carry placeholder shapes.
- **Commit at the end of each top-level task**, only after that task's applicable checks pass (`terraform fmt`, `terraform validate`, `tflint`, `terraform test`, Trivy, `shellcheck`). Use Conventional Commits with scope `infra`, giving the subject and body through multiple `-m` flags (never a commit message file), for example:
  `git commit -m "feat(infra): lay the Terraform foundation" -m "Add .terraformignore, ignore rules, and the shared versions.tf convention."`
  **Never push, merge, open a PR or tag.** The first commit (Task 1) also stages and includes `.kiro/specs/infra/`.

## Tasks

- [x] 1. Lay the Terraform foundation (version pins, provider, tags, ignore files)
  - [x] 1.1 Create the repo-level ignore and example-file scaffolding under `infra/`
    - Create `infra/.terraformignore` excluding the real `cloud.auto.tfbackend` and `terraform.tfvars` files and local state and plan artefacts from HCP uploads (`build/` is not excluded: the remote run needs the Lambda zips, see design.md Implementation deviations)
    - Add `infra/build/` and the real `cloud.auto.tfbackend` and `terraform.tfvars` paths to `.gitignore` (keep `.example` counterparts committed)
    - _Requirements: 1.7, 10.3, 17.5_

  - [x] 1.2 Create the shared `versions.tf` convention content used by every root and module
    - Define the `terraform` block with `required_version = ">= 1.15, < 2.0"` and `required_providers` for `hashicorp/aws ~> 6.0` (and `hashicorp/random` where used)
    - Establish the one-file-per-concern layout (`versions.tf`, `provider.tf`, `variables.tf`, `locals.tf`, `main.tf`, `outputs.tf`) as the template for later tasks
    - _Requirements: 1.2, 1.3, 1.8_

  - [x] 1.3 Run the applicable offline checks and make the first commit
    - Run `terraform fmt` on the created files; this task has no module to `validate`/`test` yet
    - Stage the foundation files and `.kiro/specs/infra/` (requirements.md, design.md, tasks.md, .config.kiro) and commit with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 1.2, 1.3, 1.7, 1.8, 10.3, 17.5_

- [x] 2. Implement the Data_Module (`infra/modules/data`)
  - [x] 2.1 Implement the DynamoDB single table with GSI1 and GSI2
    - Write `versions.tf`, `variables.tf` (`env`, `table_name` default `compass-<env>`, with validation), `locals.tf`, `main.tf`, `outputs.tf` (`table_name`, `table_arn`)
    - Configure `billing_mode = "PAY_PER_REQUEST"`, `ttl` on attribute `ttl` enabled, `point_in_time_recovery` enabled, `deletion_protection_enabled = true`, and `lifecycle { prevent_destroy = true }`
    - Declare GSI1 (pass -> device) and GSI2 (subHash -> pass) using the stable `hash_key`/`range_key` arguments (not `key_schema`), each with an explicit `projection_type = "INCLUDE"` and `non_key_attributes` covering its access pattern
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 9.2_

  - [x] 2.2 Write plan assertions and the GSI-form static scan for the Data_Module
    - Native test (`mock_provider`, `command = plan`) asserting on-demand mode, TTL attribute `ttl`, PITR enabled, deletion protection enabled, and each GSI's explicit `projection_type`
    - Static HCL scan asserting the `global_secondary_index` blocks use `hash_key`/`range_key` and not `key_schema` (locks in the choice avoiding GSI replacement on the Retained_Resource)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8_

  - [x] 2.3 Run the offline checks and commit the Data_Module
    - Run `terraform fmt`, `terraform validate` (with `terraform init -backend=false`), `tflint`, `terraform test` (mock providers), and a Trivy config scan on the module; fix any finding
    - Commit the module and its tests with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 9.2_

- [x] 3. Implement the Secrets_Module (`infra/modules/secrets`)
  - [x] 3.1 Implement the three secret containers and the generated values
    - Write `versions.tf`, `variables.tf` (`env`), `locals.tf`, `main.tf`, `outputs.tf`
    - Create `compass/<env>/apple-pass`, `compass/<env>/google-wallet`, `compass/<env>/app` containers, each with `lifecycle { prevent_destroy = true }`
    - Generate `random_password` for the pepper and the origin-verify value, each `length >= 32`, marked sensitive; write both into the `app` secret version only; create no Terraform-managed version for `apple-pass` or `google-wallet`, and apply `ignore_changes = [secret_string]` where a version resource exists so an out-of-band value is never overwritten
    - Expose outputs `app_secret_arn`, `apple_secret_arn`, `google_secret_arn`, and a `sensitive` `origin_verify_secret_value` for in-graph wiring only; declare no output of the pepper or origin-verify as a non-sensitive value
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.3, 17.1_

  - [x] 3.2 Write plan assertions for the Secrets_Module
    - Native test asserting three containers with the exact names, a `random_password` pepper and origin-verify each of length >= 32, no Terraform version on apple/google, and `prevent_destroy = true` on all three containers
    - _Requirements: 7.1, 7.2, 7.5, 9.3_

  - [x] 3.3 Run the offline checks and commit the Secrets_Module
    - Run `terraform fmt`, `terraform validate` (`init -backend=false`), `tflint`, `terraform test` (mock providers), and a Trivy config scan; fix any finding
    - Commit the module and its tests with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.3, 17.1_

- [x] 4. Implement the Site_Module (`infra/modules/site`)
  - [x] 4.1 Implement the private, versioned S3 bucket with OAC and bucket policy
    - Write `versions.tf`, `variables.tf` (`bucket_name_prefix`, `distribution_arn`), `locals.tf`, `main.tf`, `outputs.tf` (`bucket_regional_domain_name`, `bucket_arn`, `oac_id`)
    - Create one `aws_s3_bucket` with `lifecycle { prevent_destroy = true }`, an `aws_s3_bucket_public_access_block` with all four settings true, SSE-S3 (AES256) default encryption, versioning enabled, one `aws_cloudfront_origin_access_control` (signing `sigv4`), and a bucket policy allowing `s3:GetObject` only when `AWS:SourceArn` equals the distribution ARN and denying all other principals
    - Add an inline `trivy:ignore:AVD-AWS-0132` comment on the encryption block citing Requirement 3.2 (SSE-S3 mandated for the public site bucket)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.4_

  - [x] 4.2 Write plan assertions for the Site_Module
    - Native test asserting public-access-block all true, SSE-S3 AES256, versioning enabled, bucket policy scoped to the distribution ARN, one OAC, and `prevent_destroy = true` on the bucket
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 9.4_

  - [x] 4.3 Run the offline checks and commit the Site_Module
    - Run `terraform fmt`, `terraform validate` (`init -backend=false`), `tflint`, `terraform test` (mock providers), and a Trivy config scan (only the documented AVD-AWS-0132 suppression is allowed); fix any other finding
    - Commit the module and its tests with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.4_

- [x] 5. Implement the Edge_Module (`infra/modules/edge`)
  - [x] 5.1 Implement the CloudFront function, response headers policy, and distribution
    - Write `versions.tf`, `variables.tf` (`site_bucket_regional_domain_name`, `oac_id`, `api_stage_invoke_host`, `origin_verify_secret_value` sensitive, `kill_switch_enabled` default false), `locals.tf`, `main.tf`, `outputs.tf` (`distribution_arn`, `distribution_domain_name`)
    - Create one `aws_cloudfront_function` (viewer-request) that rewrites directory-style paths to `index.html`, and one `aws_cloudfront_response_headers_policy` setting CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Permissions-Policy`
    - Create one `aws_cloudfront_distribution` with `default_root_object = "index.html"`, `lifecycle { prevent_destroy = true }`; default behaviour to the site bucket via OAC with the response headers policy and the viewer-request function attached; an ordered `/api/*` behaviour to stage `live` as a custom origin with `origin_path = "/live"`, the `x-origin-verify` custom origin header sourced from `origin_verify_secret_value`, the managed `CachingDisabled` cache policy and `AllViewerExceptHostHeader` origin request policy, and no CloudFront function; no `custom_error_response` block; no standard (access) logging
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 9.1_

  - [x] 5.2 Implement the WAF Web_ACL and associate it with the distribution
    - Create one `aws_wafv2_web_acl` at scope `CLOUDFRONT` (us-east-1) with exactly five rules in priority order: per-IP rate-based, `AWSManagedRulesCommonRuleSet`, `AWSManagedRulesKnownBadInputsRuleSet`, `AWSManagedRulesAmazonIpReputationList`, and a kill-switch rule at priority 5 whose action is `block` when `kill_switch_enabled` is true and `count` when false
    - Set `visibility_config.sampled_requests_enabled = false` on every rule and at the ACL level; configure no WAF logging destination
    - Associate the Web_ACL with the distribution by setting the distribution `web_acl_id` to the Web_ACL ARN
    - _Requirements: 4.8, 4.9, 4.10, 4.11, 4.12_

  - [x] 5.3 Write property test for WAF sampling disabled
    - **Property 2: Sampling is disabled on every WAF rule**
    - **Validates: Requirements 4.11, 16.5, 17.4**

  - [x] 5.4 Write plan assertions for the Edge_Module distribution and headers
    - Native test asserting one distribution with `default_root_object`, OAC default behaviour with the viewer-request function, `/api/*` ordered behaviour to stage `live` with `origin_path = "/live"` and the two managed policies and no function, no `custom_error_response`, response headers policy present, no standard logging, `web_acl_id` set to the Web_ACL ARN, one Web_ACL at `CLOUDFRONT` scope with five ordered rules and the kill-switch at priority 5 (block when enabled, count when disabled), and `prevent_destroy = true` on the distribution
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.12, 9.1_

  - [x] 5.5 Run the offline checks and commit the Edge_Module
    - Run `terraform fmt`, `terraform validate` (`init -backend=false`), `tflint`, `terraform test` (mock providers), and a Trivy config scan; fix any finding
    - Commit the module and its tests with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 9.1_

- [x] 6. Checkpoint - foundation, data, secrets, site, and edge modules
  - Ensure all offline checks pass for the modules built so far. Ask the user if questions arise.

- [x] 7. Implement the Api_Module (`infra/modules/api`)
  - [x] 7.1 Implement the REST API, deployment, and Lambda functions with dedicated roles
    - Write `versions.tf`, `variables.tf` (`env`, `api_lambda_zip`, `passkit_lambda_zip`, `table_name`, `secret_arns`, `throttle_rate`, `throttle_burst`, optional `route_throttles` map), `locals.tf`, `main.tf`, `outputs.tf` (`rest_api_id`, `stage_invoke_host`, `api_lambda_role_arn`, `passkit_lambda_role_arn`)
    - Create `aws_api_gateway_rest_api` with `body = templatefile("${path.module}/openapi.yaml", { api_lambda_invoke_arn = ..., passkit_lambda_invoke_arn = ... })` passing exactly those two variables and no others, reading the S0 file without writing it; set `endpoint_configuration { types = ["REGIONAL"] }`; do not set `binary_media_types`
    - Create one `aws_api_gateway_deployment` with `triggers = { redeployment = sha1(aws_api_gateway_rest_api.this.body) }` and `lifecycle { create_before_destroy = true }`
    - Create two `aws_lambda_function` (`api`, `passkit`), each `architectures = ["arm64"]`, `runtime = "nodejs24.x"`, `memory_size = 512`, timeouts 10 s (`api`) and 5 s (`passkit`); create one dedicated `aws_iam_role` per Lambda; create two `aws_lambda_permission` with principal `apigateway.amazonaws.com` and `source_arn = "${execution_arn}/*/*"`
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.9, 5.10, 5.11_

  - [x] 7.2 Implement the `live` stage, throttling, method settings, and log groups
    - Create one `aws_api_gateway_stage` named `live` referencing the deployment
    - Add default `aws_api_gateway_method_settings` on `*/*` with `logging_level = "OFF"`, `data_trace_enabled = false`, `metrics_enabled = true`; apply stage-level throttling (rate and burst) and per-route method-level throttle overrides from `route_throttles`
    - Set `access_log_settings` with a format that records the path only as `$context.resourcePath` and contains no `$context.path`, `$context.identity.sourceIp`, or other source-IP or full-path field
    - Create one CloudWatch log group per Lambda and one for the stage access logs, all `retention_in_days = 14`; do not create an `aws_api_gateway_account` CloudWatch role here (it comes from the bootstrap)
    - _Requirements: 5.4, 5.5, 5.7, 5.8, 5.12, 5.13, 5.14_

  - [x] 7.3 Write property test for log retention
    - **Property 3: Every log group retains logs for 14 days**
    - **Validates: Requirements 5.12, 5.13, 16.3**

  - [x] 7.4 Write property test for identifier-free access log format
    - **Property 4: The access log format captures no IP or full path**
    - **Validates: Requirements 5.7, 5.8, 16.6, 17.3**

  - [x] 7.5 Write plan assertions for the Api_Module resources
    - Native test asserting the REST API `body` built from exactly the two template variables with no `binary_media_types` and `endpoint_configuration` `["REGIONAL"]`, the deployment `sha1` trigger with `create_before_destroy`, two Lambdas arm64 `nodejs24.x` 512 MB with 10 s and 5 s timeouts and dedicated roles, two `aws_lambda_permission` with `source_arn` `.../*/*`, the single `live` stage, default `method_settings` values plus stage throttling, and no per-environment `aws_api_gateway_account`
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.9, 5.10, 5.11, 5.14_

  - [x] 7.6 Run the offline checks and commit the Api_Module
    - Run `terraform fmt`, `terraform validate` (`init -backend=false`), `tflint`, `terraform test` (mock providers), and a Trivy config scan; fix any finding. Do not edit `infra/modules/api/openapi.yaml` (S0-owned)
    - Commit the module and its tests with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14_

- [x] 8. Implement the Observability_Module (`infra/modules/observability`)
  - [x] 8.1 Implement the KMS-encrypted SNS topic, alarms, and budget
    - Write `versions.tf`, `variables.tf` (`env`, `alarm_email` sensitive with a non-empty email validation, `rest_api_id`, `api_lambda_name`, `passkit_lambda_name`), `locals.tf`, `main.tf`, `outputs.tf` (`sns_topic_arn` only)
    - Create one customer managed `aws_kms_key` and `aws_kms_alias` whose policy allows account-root administration and grants `cloudwatch.amazonaws.com` `kms:GenerateDataKey*` and `kms:Decrypt` scoped by `aws:SourceAccount`; create one `aws_sns_topic` encrypted with it and one email `aws_sns_topic_subscription` from `alarm_email`
    - Create four `aws_cloudwatch_metric_alarm` (API 5xx, API or Lambda throttles, APNs push failures, Lambda function errors), each with `alarm_actions = [sns_topic_arn]` on the ALARM state; create one monthly `aws_budgets_budget` with a 20 USD limit and notifications at 50, 80 and 100 percent of actual spend to `alarm_email`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 8.2 Write plan assertions and the empty-email edge case for the Observability_Module
    - Native test asserting one SNS topic encrypted with a customer managed KMS key whose policy allows `cloudwatch.amazonaws.com`, one email subscription, four alarms wired to the topic, and one monthly 20 USD budget at 50/80/100 percent
    - Edge-case assertion that an empty `alarm_email` fails at plan time
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 8.3 Run the offline checks and commit the Observability_Module
    - Run `terraform fmt`, `terraform validate` (`init -backend=false`), `tflint`, `terraform test` (mock providers), and a Trivy config scan; fix any finding
    - Commit the module and its tests with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 9. Implement the Bootstrap_Config (`infra/bootstrap`)
  - [x] 9.1 Implement the OIDC provider, four roles, and the account API Gateway role
    - Write `versions.tf` (local-execution `cloud` block per ADR-001), `provider.tf`, `variables.tf` (organisation name, project, never committed literally), `locals.tf`, `oidc.tf`, `roles-plan.tf`, `roles-apply.tf`, `apigw-account.tf`, `outputs.tf`, and `terraform.tfvars.example`
    - Create exactly one `aws_iam_openid_connect_provider` for `https://app.terraform.io` with client ID list `["aws.workload.identity"]`
    - Create four roles (dev/prod Plan_Role and Apply_Role), each trust policy conditioning with `StringEquals` on `app.terraform.io:aud = aws.workload.identity` and `app.terraform.io:sub` matching `organization:<org>:project:reinvent-compass:workspace:<workspace>:run_phase:<plan|apply>` using variable references only, never a literal org or workspace name in a committed file
    - Plan_Role policy: read-only `Describe*`/`Get*`/`List*` only, no state permissions, with an explicit `Deny` on `secretsmanager:GetSecretValue` for every resource except `compass/<env>/app*`
    - Apply_Role policy: scope by `aws:RequestTag/project` on create and `aws:ResourceTag/project` on later actions, name-prefix ARNs where tags are unsupported, `iam:PassRole` only for the two Lambda execution role ARNs, and `iam:CreateRole` conditioned on `iam:PermissionsBoundary` equal to the project boundary policy ARN
    - Create the account-level API Gateway CloudWatch role and `aws_api_gateway_account` exactly once; create no long-lived access or secret key
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 9.2 Write plan assertions for the Bootstrap_Config
    - Native test (`mock_provider`, `command = plan`) asserting exactly one OIDC provider with the correct URL and audience, four roles with trust subjects matching workspace and run phase, the Plan_Role read-only policy with the Secrets Manager deny, the Apply_Role tag and `iam:PassRole` scoping, the account API Gateway role and `aws_api_gateway_account`, and no `aws_iam_access_key`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 9.3 Run the offline checks and commit the Bootstrap_Config
    - Run `terraform fmt`, `terraform validate` (`init -backend=false`), `tflint`, `terraform test` (mock providers), and a Trivy config scan; fix any finding. Confirm `terraform.tfvars.example` carries only placeholder shapes, never a real org, workspace, account ID, email, or ARN
    - Commit the bootstrap and its tests with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 10. Checkpoint - all six modules and the bootstrap
  - Ensure all offline checks pass. Ask the user if questions arise.

- [x] 11. Compose the environment roots (`infra/envs/dev`, `infra/envs/prod`)
  - [x] 11.1 Implement the `dev` environment root composing all six modules
    - Write `versions.tf` (with the `cloud` block reading `TF_CLOUD_ORGANIZATION`, `TF_CLOUD_PROJECT`, `TF_WORKSPACE`, no `-backend-config`), `provider.tf` (AWS region us-east-1 with `default_tags` for `project` and `environment`), `variables.tf` (with validation on `env` restricted to `dev|prod` and the alarm email), `locals.tf`, `main.tf` (composition of Site, Edge, Api, Data, Secrets, Observability), `outputs.tf` (non-sensitive only)
    - Wire the modules together (Secrets `origin_verify_secret_value` into Edge in-graph, Site/Edge distribution ARN and OAC exchange, Api stage host into Edge, Data table name and secret ARNs into Api, Api identifiers into Observability)
    - Commit `cloud.auto.tfbackend.example` and `terraform.tfvars.example`; keep the real files git-ignored
    - _Requirements: 1.1, 1.4, 1.5, 1.8, 1.9, 1.10, 10.1, 10.2, 10.3_

  - [x] 11.2 Implement the `prod` environment root with the same composition
    - Create `infra/envs/prod` with the same file shape and the same six-module composition as `dev` (no module present in one and absent from the other)
    - Commit `prod` `cloud.auto.tfbackend.example` and `terraform.tfvars.example`; keep the real files git-ignored
    - _Requirements: 1.1, 1.4, 1.5, 1.8, 1.9, 1.10, 10.1, 10.2, 10.3_

  - [x] 11.3 Run the offline checks and commit the environment roots
    - For each of `dev` and `prod`, run `terraform fmt`, `terraform validate` (`init -backend=false`), and `tflint`; run a Trivy config scan over the composed roots; fix any finding. Confirm the only `.tfbackend`/`.tfvars` committed are `.example` placeholders
    - Commit both environment roots with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 1.1, 1.4, 1.5, 1.8, 1.9, 1.10, 10.1, 10.2, 10.3_

- [x] 12. Implement the cross-cutting invariant tests (`infra/tests/*.tftest.hcl`)
  - [x] 12.1 Write property test for required tags on every managed resource
    - **Property 1: Every managed resource carries the required tags**
    - **Validates: Requirements 1.9, 16.4**

  - [x] 12.2 Write property test for retained-resource destroy protection
    - **Property 5: Every retained resource is protected against destruction**
    - Native plan behaviour assertion plus a static HCL scan asserting `prevent_destroy = true` in the lifecycle block of all six Retained_Resources
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 16.2**

  - [x] 12.3 Write property test for no secret or identifier in outputs
    - **Property 6: No Terraform output exposes a secret or identifier**
    - **Validates: Requirements 7.4, 17.1**

  - [x] 12.4 Write property test for identical module composition across environments
    - **Property 9: The two environments compose the same modules**
    - **Validates: Requirements 10.1**

  - [x] 12.5 Run the invariant tests offline and commit them
    - Run `terraform test` (mock providers, `command = plan`) and the static scans for tasks 12.1 to 12.4; fix any finding
    - Commit the cross-cutting tests with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 1.9, 7.4, 9.1, 9.2, 9.3, 9.4, 10.1, 16.2, 16.4, 17.1_

- [x] 13. Implement the repo-wide leakage scan test
  - [x] 13.1 Write property test for no account id, account-bearing ARN, or email in owned files
    - **Property 7: No committed owned file embeds an account id, account-bearing ARN, or email**
    - Scan every committed file under `infra/**`, `scripts/**`, and `docs/runbooks/**` (runnable in CI and locally, no AWS); fail on a 12-digit account id, an `arn:aws` embedding an account id, or an email address
    - **Validates: Requirements 17.6**

  - [x] 13.2 Run the leakage scan offline and commit it
    - Run the leakage scan over the owned files and confirm it passes; fix any finding
    - Commit the scan with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 17.6_

- [x] 14. Checkpoint - environments composed and invariants verified
  - Ensure all offline checks pass. Ask the user if questions arise.

- [x] 15. Implement the owner-run deploy and setup scripts (`scripts/**`)
  - [x] 15.1 Implement `scripts/bootstrap.sh`
    - Run `terraform init` and `terraform apply` against `infra/bootstrap`; exit 0 on a clean apply and non-zero on failure, never reporting success on failure; echo no secret or identifier on any path
    - Do not execute this script; it is owner-run only. Validate it with `shellcheck`
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 15.2 Implement `scripts/release.sh`
    - Accept exactly one env argument validated against `dev|prod` (usage message and non-zero exit otherwise, no Terraform run); load `infra/envs/<env>/cloud.auto.tfbackend` and export the three `TF_CLOUD_*` vars, failing by name if any is missing
    - Build the two Lambda zips into git-ignored `infra/build/` and build the site; run `terraform plan -out`; refuse any saved plan that would destroy or replace a Retained_Resource or introduce a resource type outside the allow list (print which, non-zero exit, no apply); require a typed `yes`
    - On confirmation apply the saved plan, `aws s3 sync` the site, and `aws cloudfront create-invalidation`; exit non-zero if apply, sync, or invalidation fails; health-check `GET https://<cf>/api/v1/health` treating only HTTP 200 as success; echo no secret or identifier on any path
    - Do not execute this script; it is owner-run only. Validate it with `shellcheck`
    - _Requirements: 1.6, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10_

  - [x] 15.3 Implement `scripts/load-secrets.sh`
    - Read certificate and key material from owner-provided file-path arguments; exit non-zero with a path-only (never content) error when a file is missing or unreadable; write each value into the matching Secrets Manager secret; exit non-zero if a write fails; never echo, print, or log any secret value on any path, referring to secrets only by name or path
    - Do not execute this script; it is owner-run only. Validate it with `shellcheck`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 15.4 Implement `scripts/google-wallet-class.mjs`
    - Idempotent create-or-update of the Google Wallet issuer and class (repeat runs leave the same state, no duplicates); exit 0 on success and non-zero on any Google Wallet API failure; manage nothing in Terraform; echo no secret value
    - Do not execute this script; it is owner-run only
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 15.5 Write script behaviour and leakage tests
    - Assert `shellcheck` is clean on `bootstrap.sh`, `release.sh`, and `load-secrets.sh`
    - Example tests for deterministic branches: `release.sh` argument validation, missing backend key named, Retained_Resource refusal, unexpected resource-type refusal, non-`yes` abort; `load-secrets.sh` missing-file and write-failure paths
    - **Property 8: No script echoes a secret on any exit path** (static grep-based assertion that no script path echoes a secret-bearing variable)
    - **Validates: Requirements 11.4, 12.11, 13.5, 13.6, 17.2**

  - [x] 15.6 Run the script checks offline and commit the scripts
    - Run `shellcheck` on all three shell scripts and the script behaviour and leakage tests; fix any finding. Never run any script in `scripts/`
    - Commit the scripts and their tests with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 14.1, 14.2, 14.3, 14.4, 17.2_

- [x] 16. Author the operations runbooks (`docs/runbooks/**`)
  - [x] 16.1 Write all five runbooks
    - `release.md` (command, preconditions, numbered steps, expected success outcome), `rollback.md` (roll-forward from the previous commit's bundle plus a roll-forward note for each of the six Retained_Resources by name), `secrets.md` (steps plus an instruction never to print or paste a secret value), `google-class.md` (command, preconditions, expected success outcome), `kill-switch.md` (how to enable and disable the WAF kill-switch rule)
    - Use placeholders only; no real org, workspace, account ID, email, or ARN
    - _Requirements: 9.6, 15.1, 15.2, 15.3, 15.4, 15.5_

  - [x] 16.2 Commit the runbooks
    - Confirm the runbooks carry no account ID, org, workspace, email, or ARN, then run the repo-wide leakage scan (task 13.1) over `docs/runbooks/**`
    - Commit the runbooks with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 9.6, 15.1, 15.2, 15.3, 15.4, 15.5, 17.6_

- [ ] 17. Final checkpoint - full quality gate
  - Ensure all native tests pass under `mock_provider`/`command = plan`, `terraform fmt -check`, `terraform validate` (`init -backend=false`), `tflint`, and a Trivy config scan report no HIGH or CRITICAL findings (with only the documented AVD-AWS-0132 site-bucket suppression), and `shellcheck` is clean. Ask the user if questions arise.

- [ ] 18. Save terminal captures for the Builder Center post
  - [ ] 18.1 Capture and save two or three passing-check terminal captures
    - Save two or three terminal captures to `docs/article/screenshots/infra/`: a passing `terraform test` run (mock providers) and the static checks (`terraform fmt -check`, `terraform validate`, `tflint`, Trivy, `shellcheck`). Redact any account ID, org, workspace, email, or ARN from the captures before saving
    - Commit the captures with scope `infra` using multiple `-m` flags; do not push
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 17.2, 17.6_

## Notes

- The implementation language is Terraform/HCL, Bash, and Node.js (`.mjs`), fixed by the design and tech steering (Terraform only, no CDK/CloudFormation/SAM).
- **Every task is required; there are no optional tasks.** Each top-level task ends with a step that runs the applicable offline checks and makes a local Conventional Commit (scope `infra`, subject and body via multiple `-m` flags, no message file). The first commit (Task 1) also includes `.kiro/specs/infra/`. Never push, merge, open a PR, or tag.
- **Tasks run strictly in numeric order.** Do not run tasks in parallel and do not use Run All Tasks. There is no parallel wave graph.
- This is Infrastructure as Code, so the design's nine Correctness Properties are plan invariants verified by Terraform native tests (`command = plan`, `mock_provider`) and static/repo scans, not randomized property-based tests. Each property task references its property number and the requirement clauses it validates.
- **Offline checks only.** No test or task runs `terraform init` against HCP, `terraform plan` against a real workspace, `terraform apply`, or any script in `scripts/`. `terraform validate` runs after `terraform init -backend=false`. The owner runs every deploy. Owner-only verifications (bootstrap idempotence 2.9, dev zero-diff 10.4, end-to-end health 12.10) live in the runbooks and are performed by the Owner, so they are not coding tasks here.
- **File ownership.** Only `infra/**` (except the S0-owned `infra/modules/api/openapi.yaml`), `scripts/**`, `docs/runbooks/**`, `docs/article/screenshots/infra/`, and `.kiro/specs/infra/` are edited. Never edit `contracts/**`, `packages/**`, `package.json`, or `package-lock.json`.
- **No secrets or identifiers in committed files.** No account ID, HCP organisation or workspace name, email, or ARN appears in any committed file; only `.example` files carry placeholder shapes.

## Task Dependency Graph

Execution is strictly sequential in numeric order: every leaf task is its own single-task wave, so no two tasks ever run in parallel. Do not use Run All Tasks.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["2.3"] },
    { "id": 6, "tasks": ["3.1"] },
    { "id": 7, "tasks": ["3.2"] },
    { "id": 8, "tasks": ["3.3"] },
    { "id": 9, "tasks": ["4.1"] },
    { "id": 10, "tasks": ["4.2"] },
    { "id": 11, "tasks": ["4.3"] },
    { "id": 12, "tasks": ["5.1"] },
    { "id": 13, "tasks": ["5.2"] },
    { "id": 14, "tasks": ["5.3"] },
    { "id": 15, "tasks": ["5.4"] },
    { "id": 16, "tasks": ["5.5"] },
    { "id": 17, "tasks": ["7.1"] },
    { "id": 18, "tasks": ["7.2"] },
    { "id": 19, "tasks": ["7.3"] },
    { "id": 20, "tasks": ["7.4"] },
    { "id": 21, "tasks": ["7.5"] },
    { "id": 22, "tasks": ["7.6"] },
    { "id": 23, "tasks": ["8.1"] },
    { "id": 24, "tasks": ["8.2"] },
    { "id": 25, "tasks": ["8.3"] },
    { "id": 26, "tasks": ["9.1"] },
    { "id": 27, "tasks": ["9.2"] },
    { "id": 28, "tasks": ["9.3"] },
    { "id": 29, "tasks": ["11.1"] },
    { "id": 30, "tasks": ["11.2"] },
    { "id": 31, "tasks": ["11.3"] },
    { "id": 32, "tasks": ["12.1"] },
    { "id": 33, "tasks": ["12.2"] },
    { "id": 34, "tasks": ["12.3"] },
    { "id": 35, "tasks": ["12.4"] },
    { "id": 36, "tasks": ["12.5"] },
    { "id": 37, "tasks": ["13.1"] },
    { "id": 38, "tasks": ["13.2"] },
    { "id": 39, "tasks": ["15.1"] },
    { "id": 40, "tasks": ["15.2"] },
    { "id": 41, "tasks": ["15.3"] },
    { "id": 42, "tasks": ["15.4"] },
    { "id": 43, "tasks": ["15.5"] },
    { "id": 44, "tasks": ["15.6"] },
    { "id": 45, "tasks": ["16.1"] },
    { "id": 46, "tasks": ["16.2"] },
    { "id": 47, "tasks": ["18.1"] }
  ]
}
```
