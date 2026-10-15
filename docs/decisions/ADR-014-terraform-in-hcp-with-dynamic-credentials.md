# ADR-014 Terraform in HCP with dynamic credentials

Status: Accepted, 2026-10-15 (owner approved the build plan).

## Context

All infrastructure goes through Terraform, and state lives in HCP Terraform (ADR-001). tech.md first planned deploys from GitHub Actions through GitHub OIDC. The owner chose a personal HCP Terraform organisation, HCP dynamic provider credentials and an owner-run release script (ADR-004 item 8).

## Decision

- **Personal HCP Terraform organisation**, project `reinvent-compass`, three workspaces:
  - `reinvent-compass-bootstrap`: local execution, run once by the owner with their own credentials in CloudShell. Creates the OIDC provider `app.terraform.io` (audience `aws.workload.identity`) and the plan and apply roles for dev and prod, trusted per workspace and `run_phase`.
  - `reinvent-compass-dev` and `reinvent-compass-prod`: remote, CLI-driven, with `TFC_AWS_PROVIDER_AUTH=true`, `TFC_AWS_PLAN_ROLE_ARN` and `TFC_AWS_APPLY_ROLE_ARN`.
- Plan role: read-only plus state. Apply role: scoped to tagged project resources. No AWS keys.
- The organisation and workspace names are private: a git-ignored `infra/envs/<env>/cloud.auto.tfbackend` or the `TF_CLOUD_ORGANIZATION` and `TF_WORKSPACE` variables, with a committed `.example`.
- Terraform `>= 1.15, < 2.0`; AWS provider `~> 6.0`. File conventions follow Passembly, with `tests/*.tftest.hcl` and mock providers.
- **Owner-run `scripts/release.sh`:** build, `terraform plan -out` in HCP, refuse any destroy or replace of retained resources or any unexpected resource type, typed `yes`, apply, sync the site, invalidate the cache, health check.
- This **replaces the GitHub OIDC deploy**. There is no deploy workflow (ADR-018).

## Consequences

- About 90 managed resources per environment, inside the 500-resource free tier.
- Not in Terraform (owner runbooks): the Apple Pass Type ID and certificate, the Google Wallet issuer and class, the npm trusted publisher, GitHub settings.

## Source

- re:Invent Compass build plan sections 6, 7.1, 7.2, 11.3.
- [HCP AWS dynamic credentials](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/dynamic-provider-credentials/aws-configuration), [HCP Terraform free tier](https://www.hashicorp.com/en/blog/continuing-hcp-terraform-s-enhanced-free-tier-experience).
