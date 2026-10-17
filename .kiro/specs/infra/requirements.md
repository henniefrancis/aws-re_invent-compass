# Requirements Document

## Introduction

This spec (stream S6, `infra`) owns all of the Terraform for re:Invent Compass, the owner-run deploy and set-up scripts, and the operations runbooks. The infrastructure provisions the serverless Compass API (CloudFront, WAF, API Gateway REST, two Lambdas, DynamoDB, Secrets Manager, observability) in the owner's personal AWS account, region us-east-1, through HCP Terraform with dynamic provider credentials. There are no AWS access keys anywhere.

The approved build plan is the source of truth (sections 6, 7, 8 S6 row, 11.3 and 13). Decisions that shape this spec are recorded in ADR-001 (state in HCP Terraform), ADR-013 (edge: CloudFront, WAF and API Gateway REST), ADR-014 (Terraform in HCP with dynamic credentials), ADR-015 (retained resources), ADR-019 (Google Wallet key in Secrets Manager), ADR-020 (dev environment before prod) and ADR-021 (CloudFront flat-rate Free plan, proposed). Where this document and the build plan disagree, the plan wins.

Ownership is strict. This spec owns `infra/**`, `scripts/**` and `docs/runbooks/**`. The one exception inside `infra/**` is `infra/modules/api/openapi.yaml`, which is a byte-identical copy owned by S0 (foundation-contracts). This spec references and consumes that file but never edits it. If a change is needed outside this ownership, it is written up as a note for the integrator and not applied here.

Two safety rules run through every requirement. First, the owner runs every deploy; the agent never runs `terraform apply` or any deploy script, and tests never create real AWS resources (mock providers only). Second, no secret, token, email address, account identifier or other identifier may be output by Terraform or echoed by a script, and access logs and WAF must never capture IP addresses or identifiers. Anything private is handled through git-ignored files with a committed `.example`.

The schedule milestone (ADR-020, build plan section 9.3) is that the dev environment must be deployable from scratch on or before 21 October, so that real-device and end-to-end checks can run before prod.

## Glossary

- **Infra_Spec**: The deliverables this spec owns: all Terraform under `infra/**` (except the S0-owned `infra/modules/api/openapi.yaml`), the scripts under `scripts/**`, and the runbooks under `docs/runbooks/**`.
- **Terraform_Config**: The Terraform root and module configuration files for this project.
- **Bootstrap_Config**: The Terraform configuration in `infra/bootstrap`, run once by the owner with local execution.
- **HCP_Terraform**: HashiCorp Cloud Platform Terraform, which holds this project's state and runs plans and applies.
- **OIDC_Provider**: The AWS IAM OpenID Connect provider for `app.terraform.io` with audience `aws.workload.identity`.
- **Plan_Role**: A per-environment IAM role assumed by HCP_Terraform during the plan phase. Read-only plus state access.
- **Apply_Role**: A per-environment IAM role assumed by HCP_Terraform during the apply phase. Scoped to tagged project resources.
- **Site_Module**: The Terraform module at `infra/modules/site`.
- **Edge_Module**: The Terraform module at `infra/modules/edge`.
- **Api_Module**: The Terraform module at `infra/modules/api`.
- **Data_Module**: The Terraform module at `infra/modules/data`.
- **Secrets_Module**: The Terraform module at `infra/modules/secrets`.
- **Observability_Module**: The Terraform module at `infra/modules/observability`.
- **Distribution**: The single CloudFront distribution created by Edge_Module.
- **Web_ACL**: The AWS WAF web ACL created by Edge_Module, CLOUDFRONT scope, in us-east-1.
- **Rest_Api**: The API Gateway REST API created by Api_Module from the OpenAPI file.
- **Openapi_Copy**: The file `infra/modules/api/openapi.yaml`, an S0-owned byte-identical copy that Api_Module consumes but does not edit.
- **Retained_Resource**: A resource carrying `prevent_destroy`: the Distribution, the DynamoDB table, the three secrets and the site bucket.
- **Release_Script**: `scripts/release.sh`, run by the owner to deploy an environment.
- **Bootstrap_Script**: `scripts/bootstrap.sh`, run by the owner to apply Bootstrap_Config once.
- **Load_Secrets_Script**: `scripts/load-secrets.sh`, run by the owner to load certificate and key values into Secrets Manager.
- **Google_Class_Script**: `scripts/google-wallet-class.mjs`, run by the owner to set up the Google Wallet issuer and class.
- **Owner**: The person who runs every deploy and holds the AWS and HCP credentials.
- **Agent**: The automated Kiro session that writes code and tests but never deploys.
- **Env_Var**: An environment variable.

## Requirements

### Requirement 1: Terraform foundation and file conventions

**User Story:** As the owner, I want the Terraform to follow one consistent set of version pins, region and file conventions, so that every environment is provisioned the same safe way.

#### Acceptance Criteria

1. THE Terraform_Config SHALL configure the AWS provider with region us-east-1, so that every managed resource is created in us-east-1.
2. THE Terraform_Config SHALL declare a `required_version` constraint of `>= 1.15, < 2.0`.
3. THE Terraform_Config SHALL declare the AWS provider source `hashicorp/aws` with a version constraint of `~> 6.0`.
4. THE Terraform_Config SHALL configure state in HCP_Terraform using a `cloud` block.
5. THE Terraform_Config `cloud` block SHALL read the HCP_Terraform organisation, project and workspace from the `TF_CLOUD_ORGANIZATION`, `TF_CLOUD_PROJECT` and `TF_WORKSPACE` environment variables, and SHALL NOT pass a `-backend-config` file.
6. THE Release_Script SHALL load the git-ignored `infra/envs/<env>/cloud.auto.tfbackend` file (KEY=VALUE lines) and export `TF_CLOUD_ORGANIZATION`, `TF_CLOUD_PROJECT` and `TF_WORKSPACE` from it, and IF any of those three values is missing, THEN THE Release_Script SHALL fail with an error that names the missing key.
7. THE Infra_Spec SHALL commit a `cloud.auto.tfbackend.example` file and SHALL keep any real `cloud.auto.tfbackend` file git-ignored and uncommitted.
8. THE Terraform_Config SHALL place version constraints in `versions.tf`, the provider configuration in `provider.tf`, input variables in `variables.tf`, and local values in `locals.tf`, with each concern in its own file.
9. THE provider configuration in `provider.tf` SHALL set `default_tags` with at least a `project` tag and an `environment` tag, so that every managed resource carries both tags.
10. THE Terraform_Config SHALL declare a `validation` block on each input variable in `variables.tf` that has a constrained value (for example the environment name and the alarm email address).

### Requirement 2: Bootstrap OIDC provider and plan and apply roles

**User Story:** As the owner, I want a one-time bootstrap that creates the HCP OIDC trust and separate least-privilege roles per environment and run phase, so that deploys need no AWS keys.

#### Acceptance Criteria

1. THE Bootstrap_Config SHALL be located in `infra/bootstrap` and SHALL use a configuration suited to local execution (no `cloud` block and no remote backend requiring the project roles), so that the Owner can apply it once in CloudShell with the Owner's own credentials.
2. THE Bootstrap_Config SHALL create exactly one OIDC_Provider for `app.terraform.io` with the client ID audience `aws.workload.identity`.
3. THE Bootstrap_Config SHALL create a separate Plan_Role and a separate Apply_Role for the dev environment and for the prod environment, giving four roles in total.
4. THE Bootstrap_Config SHALL restrict each role's trust policy so that the subject matches this HCP_Terraform organisation, the project `reinvent-compass`, the role's own workspace, and the role's own run phase, where `run_phase:plan` maps to a Plan_Role and `run_phase:apply` maps to an Apply_Role.
5. THE Bootstrap_Config SHALL grant each Plan_Role permissions limited to read-only AWS actions (describe, get and list) only, and SHALL NOT grant the Plan_Role any state permissions (HCP_Terraform holds the state).
6. THE Bootstrap_Config SHALL scope each Apply_Role to this project's resources by requiring the project tag through `aws:RequestTag` on create actions and `aws:ResourceTag` on later actions, by restricting to name-prefix ARNs for resource types that do not support tag conditions, and by granting `iam:PassRole` only for the two Lambda execution roles.
7. THE Bootstrap_Config SHALL create the account-level API Gateway CloudWatch Logs role and the `aws_api_gateway_account` setting exactly once for the account, so that no environment root creates it.
8. THE Bootstrap_Config SHALL NOT create or store any long-lived AWS access key or secret key.
9. WHEN the Bootstrap_Config is applied more than once with no configuration change, THE Bootstrap_Config SHALL produce no resource changes (idempotent).

### Requirement 3: Site module

**User Story:** As the owner, I want the showcase site served from a private, versioned S3 bucket reachable only through CloudFront, so that the site content is not publicly exposed at the bucket.

#### Acceptance Criteria

1. THE Site_Module SHALL create exactly one S3 bucket with all four public access block settings (block public ACLs, ignore public ACLs, block public policy, restrict public buckets) set to true.
2. THE Site_Module SHALL enable SSE-S3 (AES256) default server-side encryption on the bucket.
3. THE Site_Module SHALL enable versioning on the bucket.
4. THE Site_Module SHALL create one CloudFront Origin Access Control for the bucket.
5. THE Site_Module SHALL attach a bucket policy that allows `s3:GetObject` only when the request comes from the Distribution, and denies all other principals.

### Requirement 4: Edge module (CloudFront, response headers and WAF)

**User Story:** As the owner, I want one CloudFront distribution that fronts the site and the API with strict security headers and a WAF, so that there is one protected public address.

#### Acceptance Criteria

1. THE Edge_Module SHALL create exactly one Distribution.
2. THE Edge_Module SHALL route the default cache behaviour (the distribution's default behaviour, not an ordered behaviour with path pattern `/`) to the site bucket origin through the Origin Access Control.
3. THE Edge_Module SHALL route the ordered cache behaviour with path pattern `/api/*` to the Api_Module stage `live` as a custom origin whose `origin_path` is `/live`.
4. THE Edge_Module SHALL add a custom origin header `x-origin-verify` to requests sent to the `/api/*` origin, with the value sourced from the origin-verify secret and never set to a committed literal.
5. THE Edge_Module SHALL attach the AWS managed `CachingDisabled` cache policy and the AWS managed `AllViewerExceptHostHeader` origin request policy to the `/api/*` cache behaviour.
6. THE Edge_Module SHALL attach a response headers policy to the default cache behaviour that sets a `Content-Security-Policy`, an HTTP `Strict-Transport-Security` header, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy`.
7. THE Edge_Module SHALL NOT enable CloudFront standard (access) logging on the Distribution.
8. THE Edge_Module SHALL create exactly one Web_ACL with scope `CLOUDFRONT` in us-east-1.
9. THE Web_ACL SHALL contain exactly five rules in a defined priority order: a per-IP rate-based rule, the `AWSManagedRulesCommonRuleSet`, the `AWSManagedRulesKnownBadInputsRuleSet`, the `AWSManagedRulesAmazonIpReputationList`, and a kill-switch rule that blocks all requests when enabled.
10. THE Edge_Module SHALL NOT configure any WAF logging destination for the Web_ACL.
11. THE Web_ACL SHALL set `sampled_requests_enabled` to false on all five rules.
12. THE Edge_Module SHALL associate the Web_ACL with the Distribution.

### Requirement 5: API module

**User Story:** As the owner, I want the Compass API provisioned from the OpenAPI contract with throttling, binary media support, two Lambdas and identifier-free logs, so that the API matches the contract and keeps personal data out of logs.

#### Acceptance Criteria

1. THE Api_Module SHALL set the Rest_Api `body` to `templatefile(<path to Openapi_Copy>, ...)` passing exactly the two template variables `api_lambda_invoke_arn` and `passkit_lambda_invoke_arn`, and SHALL pass no other template variables.
2. THE Api_Module SHALL read the Openapi_Copy file without writing to it, so that the file content is never modified by this spec.
3. THE Api_Module SHALL create exactly one `aws_lambda_permission` per Lambda (two in total), each with principal `apigateway.amazonaws.com` and `source_arn` set to `<Rest_Api execution_arn>/*/*`.
4. THE Api_Module SHALL create exactly one stage named `live`.
5. THE Api_Module SHALL configure both stage-level and method-level throttling (rate and burst limits) on the `live` stage.
6. THE Api_Module SHALL rely on the binary media types declared in the contract's `x-amazon-apigateway-binary-media-types` extension (covering `application/vnd.apple.pkpass`, `application/vnd.apple.pkpasses`, and `text/calendar`), and SHALL NOT set or override `binary_media_types` in Terraform.
7. THE Api_Module SHALL set the `live` stage access log format so that the request path is recorded only as `$context.resourcePath` (the route template).
8. THE Api_Module SHALL NOT include `$context.path`, `$context.identity.sourceIp`, or any other source IP or full-path field in the access log format.
9. THE Api_Module SHALL create exactly two Lambda functions (one for `api`, one for `passkit`), each with architecture `arm64`, runtime `nodejs24.x`, and 512 MB of memory.
10. THE Api_Module SHALL set the `api` Lambda timeout to 10 seconds and the `passkit` Lambda timeout to 5 seconds.
11. THE Api_Module SHALL create one dedicated IAM execution role for each of the two Lambda functions, so that the two functions do not share a role.
12. THE Api_Module SHALL create one CloudWatch log group per Lambda with `retention_in_days` set to 14.
13. THE Api_Module SHALL create one CloudWatch log group for the `live` stage access logs with `retention_in_days` set to 14.
14. THE Api_Module SHALL rely on the account-level API Gateway CloudWatch role created once in the Bootstrap_Config (per account), and SHALL NOT create an `aws_api_gateway_account` CloudWatch role per environment.

### Requirement 6: Data module

**User Story:** As the owner, I want a durable, self-cleaning DynamoDB table with two access-pattern indexes, so that pass and device records are stored safely and expire on their own.

#### Acceptance Criteria

1. THE Data_Module SHALL create exactly one DynamoDB table whose name comes from a `table_name` input variable that defaults to `compass-<env>`, where `<env>` is the environment name provided to the module.
2. THE Data_Module SHALL configure the table with on-demand (pay-per-request) capacity mode and SHALL NOT configure provisioned read or write capacity.
3. THE Data_Module SHALL enable Time To Live on the table using the `ttl` attribute as the TTL attribute.
4. THE Data_Module SHALL enable point-in-time recovery on the table.
5. THE Data_Module SHALL enable deletion protection on the table.
6. THE Data_Module SHALL create exactly one global secondary index named GSI1 whose partition key identifies a pass and whose sort key identifies a device, so that all devices for a given pass are retrievable by a single query on GSI1.
7. THE Data_Module SHALL create exactly one global secondary index named GSI2 whose partition key is the `subHash` value and whose sort key identifies a pass, so that all passes for a given `subHash` are retrievable by a single query on GSI2.
8. THE Data_Module SHALL project onto GSI1 and GSI2 the attributes required to satisfy their stated access patterns without a subsequent read of the base table.

### Requirement 7: Secrets module

**User Story:** As the owner, I want secret containers created by Terraform while the sensitive values are loaded out of band and never output, so that secrets never appear in code, state output or logs.

#### Acceptance Criteria

1. THE Secrets_Module SHALL create exactly three secret containers whose names are `compass/<env>/apple-pass`, `compass/<env>/google-wallet`, and `compass/<env>/app`, where `<env>` is the environment name provided to the module.
2. THE Secrets_Module SHALL generate the application pepper and the origin-verify value using `random_password`, each with a minimum length of 32 characters.
3. THE Secrets_Module SHALL mark the generated pepper and the generated origin-verify value as sensitive in Terraform.
4. THE Secrets_Module SHALL NOT declare any Terraform output that exposes the pepper value or the origin-verify value.
5. THE Secrets_Module SHALL create the `compass/<env>/apple-pass` and `compass/<env>/google-wallet` containers with no initial secret value set by Terraform, so that the Owner loads those values out of band.
6. WHERE an Apple or Google secret value is later loaded out of band, THE Secrets_Module SHALL NOT overwrite that value on a subsequent Terraform apply.

### Requirement 8: Observability module

**User Story:** As the owner, I want alarms, an alert topic and a monthly budget, so that I am told when the service fails or when spending rises.

#### Acceptance Criteria

1. THE Observability_Module SHALL create exactly one SNS topic for alarms.
2. THE Observability_Module SHALL read the alarm email address from a workspace variable, and IF that variable is empty, THEN THE Observability_Module SHALL fail validation and stop.
3. THE Observability_Module SHALL create one CloudWatch alarm for each of the following conditions, giving four alarms in total: API 5xx responses, API or Lambda throttles, APNs push failures, and Lambda function errors.
4. THE Observability_Module SHALL configure each alarm created in criterion 3 to send its notification to the SNS topic created in criterion 1 when the alarm enters the ALARM state.
5. THE Observability_Module SHALL create exactly one AWS Budgets cost budget with a monthly period and a limit of 20 USD.
6. THE Observability_Module SHALL configure the budget to send alerts to the alarm email address when actual spend reaches 50 percent, 80 percent, and 100 percent of the 20 USD limit.

### Requirement 9: Retained resources

**User Story:** As the owner, I want the resources that cannot be safely replaced protected against destruction, so that a mistaken plan never orphans issued passes or loses live data.

#### Acceptance Criteria

1. THE Terraform_Config SHALL set `prevent_destroy` to true in the lifecycle block of the CloudFront Distribution.
2. THE Terraform_Config SHALL set `prevent_destroy` to true in the lifecycle block of the DynamoDB table.
3. THE Terraform_Config SHALL set `prevent_destroy` to true in the lifecycle block of each of the three secrets (`apple-pass`, `google-wallet`, and `app`), covering all three.
4. THE Terraform_Config SHALL set `prevent_destroy` to true in the lifecycle block of the site bucket.
5. IF a plan would destroy or replace any of the six Retained_Resources (the CloudFront Distribution, the DynamoDB table, the three secrets, and the site bucket), THEN THE Terraform_Config SHALL fail the plan and produce an error indicating which Retained_Resource would be destroyed.
6. THE Infra_Spec SHALL document, in `docs/runbooks/rollback.md`, a roll-forward note for each of the six Retained_Resources, so that all six are covered by name.

### Requirement 10: Environment composition

**User Story:** As the owner, I want dev and prod environments that compose the same modules, so that dev proves the stack before prod and both stay in step.

#### Acceptance Criteria

1. THE Terraform_Config SHALL provide an environment root at `infra/envs/dev` and an environment root at `infra/envs/prod` that each compose all six of the Site_Module, Edge_Module, Api_Module, Data_Module, Secrets_Module, and Observability_Module, with no module present in one environment root and absent from the other.
2. THE Infra_Spec SHALL commit exactly one `terraform.tfvars.example` file for each of the two environments.
3. IF a real `terraform.tfvars` file (any `terraform.tfvars` file that is not the `.example` file) is present, THEN THE Infra_Spec SHALL keep it git-ignored so that it is never committed.
4. WHEN the dev environment root is applied against an empty AWS account in us-east-1 with the environment's example values supplied, THE Terraform_Config SHALL provision all six modules to a successful completion with zero remaining planned changes on an immediately following plan.

### Requirement 11: Bootstrap script

**User Story:** As the owner, I want a script that applies the bootstrap configuration once, so that the OIDC trust and roles are created with a single owner-run command.

#### Acceptance Criteria

1. THE Bootstrap_Script SHALL run `terraform init` and `terraform apply` against the Bootstrap_Config for the one-time bootstrap workspace.
2. WHEN the apply completes cleanly, THE Bootstrap_Script SHALL exit with status 0.
3. IF the apply fails, THEN THE Bootstrap_Script SHALL exit with a non-zero status and SHALL NOT report success.
4. THE Bootstrap_Script SHALL pass `shellcheck` with no findings.
5. THE Agent SHALL NOT run the Bootstrap_Script.

### Requirement 12: Release script

**User Story:** As the owner, I want one guarded release script per environment that builds, plans, refuses dangerous changes, applies, syncs the site and health-checks, so that every deploy is safe and repeatable.

#### Acceptance Criteria

1. THE Release_Script SHALL accept exactly one environment name argument.
2. IF the environment argument is not `dev` or `prod`, THEN THE Release_Script SHALL print a usage message and exit with a non-zero status without running any Terraform.
3. WHEN the environment argument is valid, THE Release_Script SHALL set up the environment, build the Lambda bundle, and build the site.
4. WHEN the build step completes, THE Release_Script SHALL run `terraform plan` with `-out` so that the plan is saved.
5. IF the saved plan would destroy or replace any Retained_Resource, THEN THE Release_Script SHALL refuse the plan, print which resource would be affected, and exit with a non-zero status without applying.
6. IF the saved plan introduces a resource type that is not in the expected resource-type allow list, THEN THE Release_Script SHALL refuse the plan and exit with a non-zero status without applying.
7. WHEN the plan passes the refusal checks, THE Release_Script SHALL require the Owner to type `yes`, and IF the Owner types anything other than `yes`, THEN THE Release_Script SHALL exit without applying.
8. WHEN the Owner confirms, THE Release_Script SHALL apply the saved plan, sync the site to the site bucket, and invalidate the CloudFront cache.
9. IF the apply, the site sync, or the cache invalidation fails, THEN THE Release_Script SHALL exit with a non-zero status.
10. WHEN the apply completes, THE Release_Script SHALL perform a health check against `https://<cf>/api/v1/health` and SHALL treat an HTTP 200 response as success.
11. THE Release_Script SHALL pass `shellcheck` with no findings.
12. THE Agent SHALL NOT run the Release_Script.

### Requirement 13: Load secrets script

**User Story:** As the owner, I want a script that loads certificate and key files into Secrets Manager without printing them, so that private material reaches AWS without ever being echoed.

#### Acceptance Criteria

1. THE Load_Secrets_Script SHALL read certificate and key material from file paths that the Owner provides as arguments.
2. IF a provided file path does not exist or cannot be read, THEN THE Load_Secrets_Script SHALL exit with a non-zero status and an error that names the path but not its contents.
3. THE Load_Secrets_Script SHALL write each value into the matching Secrets Manager secret.
4. IF a write to Secrets Manager fails, THEN THE Load_Secrets_Script SHALL exit with a non-zero status.
5. THE Load_Secrets_Script SHALL NOT echo, print or log any secret value on any path (success, validation failure, or write failure), and SHALL refer to secrets only by name or path.
6. THE Load_Secrets_Script SHALL pass `shellcheck` with no findings.
7. THE Agent SHALL NOT run the Load_Secrets_Script.

### Requirement 14: Google Wallet class script

**User Story:** As the owner, I want an idempotent script that sets up the Google Wallet issuer and class, so that the Google objects exist without being managed in Terraform.

#### Acceptance Criteria

1. THE Google_Class_Script SHALL create or update the Google Wallet issuer and class, and SHALL exit with status 0 on success.
2. WHEN the Google_Class_Script runs more than once, THE Google_Class_Script SHALL leave the issuer and class in the same state as a single run (no duplicate objects, existing objects left unchanged where already correct).
3. IF the Google Wallet API call fails, THEN THE Google_Class_Script SHALL exit with a non-zero status.
4. THE Infra_Spec SHALL NOT manage the Google Wallet issuer or class in Terraform.
5. THE Agent SHALL NOT run the Google_Class_Script.

### Requirement 15: Runbooks

**User Story:** As the owner, I want written runbooks for the operations I perform by hand, so that each owner-run task has clear, repeatable steps.

#### Acceptance Criteria

1. THE Infra_Spec SHALL provide a release runbook in `docs/runbooks/` that states the command to run, its preconditions, numbered steps, and the expected success outcome.
2. THE Infra_Spec SHALL provide a rollback runbook in `docs/runbooks/` that states the steps to roll forward from the previous commit's bundle and the roll-forward notes for the Retained_Resources.
3. THE Infra_Spec SHALL provide a secret loading runbook in `docs/runbooks/` that states the steps and instructs the Owner never to print or paste a secret value.
4. THE Infra_Spec SHALL provide a Google class runbook in `docs/runbooks/` that states the command, its preconditions, and the expected success outcome.
5. THE Infra_Spec SHALL provide a kill switch runbook in `docs/runbooks/` that states how to enable and disable the WAF kill-switch rule.

### Requirement 16: Terraform tests and quality gates

**User Story:** As the owner, I want native Terraform tests with mock providers plus format, validate, lint and config scanning, so that the infrastructure is verified without ever touching real AWS.

#### Acceptance Criteria

1. THE Terraform_Config SHALL include native `terraform test` files (`tests/*.tftest.hcl`) that use `mock_provider` blocks.
2. THE Terraform tests SHALL assert that every Retained_Resource has `prevent_destroy` set to true, and SHALL fail if any does not.
3. THE Terraform tests SHALL assert that each Lambda log group has `retention_in_days` equal to 14, and SHALL fail otherwise.
4. THE Terraform tests SHALL assert that the required tags (`project` and `environment`) are present on managed resources, and SHALL fail if a required tag is missing.
5. THE Terraform tests SHALL assert that `sampled_requests_enabled` is false on all five Web_ACL rules, and SHALL fail otherwise.
6. THE Terraform tests SHALL assert that the access log format contains no IP field (no `sourceIp` and no `$context.path`), and SHALL fail otherwise.
7. WHEN the quality gates run, THE Terraform_Config SHALL pass `terraform fmt -check`, `terraform validate`, `tflint`, and a Trivy configuration scan with no HIGH or CRITICAL findings.
8. THE Terraform tests SHALL run with `command = plan` against mock providers so that no real AWS resource is created.
9. THE Agent SHALL NOT run `terraform apply` or any deploy script at any time.

### Requirement 17: Security and privacy constraints

**User Story:** As the owner, I want a hard guarantee that no secret or identifier leaks through Terraform output or script output and that logs and WAF never capture IPs, so that the service keeps its privacy promises.

#### Acceptance Criteria

1. THE Terraform_Config SHALL NOT declare any `output` whose value is a secret, token, email address, account identifier, or other identifier, and SHALL mark any unavoidable sensitive output as `sensitive`.
2. WHEN any script runs, on any exit path, THE script SHALL NOT echo, print, or log any secret, token, email address, account identifier, or other identifier value.
3. THE Api_Module `live` stage access log format SHALL contain no IP field and no identifier field (no `sourceIp`, no `$context.path`).
4. THE Edge_Module SHALL NOT enable any WAF logging destination and SHALL NOT enable sampled requests on the API rules, so that no IP address or identifier is captured in WAF logs.
5. THE Infra_Spec SHALL commit a `.example` file for every private configuration value (the backend config, each environment's tfvars, and the Bootstrap_Config's `terraform.tfvars`) and SHALL keep the real value git-ignored.
6. THE Infra_Spec SHALL include a test that fails if any committed file under `infra/**`, `scripts/**` or `docs/runbooks/**` contains a 12-digit AWS account identifier, an `arn:aws` string that embeds an account identifier, or an email address.
