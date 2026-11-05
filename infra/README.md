# Infrastructure (stream S6)

Terraform only, region `us-east-1`, state in HCP Terraform. The build plan (sections 6, 7 and 11.3) and the spec in `.kiro/specs/infra/` are the source of truth. Nothing here is applied by an agent: the owner runs every plan and apply.

## What is deployed where

| Environment | Root        | Address                            |
| ----------- | ----------- | ---------------------------------- |
| prod        | `envs/prod` | https://reinvent-compass.vegas     |
| dev         | `envs/dev`  | https://dev.reinvent-compass.vegas |

Each environment has its own HCP Terraform workspace. Both addresses are the custom domain (ADR-031), serving the site, `/board` and the Compass API under `/api/*`. The owner deploys with `scripts/release.sh <env>`.

## Layout

```
infra/
  .terraformignore     files kept out of the HCP upload
  bootstrap/           OIDC provider, four roles, boundaries, account API Gateway role, budget, domain, HCP workspaces (owner runs once)
  modules/             site, edge, api, data, secrets, observability
  envs/dev, envs/prod  compose the six modules; real tfvars and tfbackend are git-ignored
  tests/               native tests (mock providers, plan only) and static scans
  build/               git-ignored Lambda zips written by scripts/release.sh
```

## Bootstrap

`infra/bootstrap` holds what exists once per account, and the owner runs it with `scripts/bootstrap.sh`:

- the HCP Terraform OIDC provider, and a plan role and an apply role for each of dev and prod, each with a permissions boundary;
- the account API Gateway role for access logs;
- the domain registration of `reinvent-compass.vegas` with Route 53 Domains (ADR-031), kept by `prevent_destroy`;
- the one monthly cost budget for the account, with alerts at 50, 80 and 100 percent;
- the dev and prod HCP Terraform workspaces and their non-sensitive variables (the tfe provider). Sensitive workspace variables are set by `scripts/set-workspace-secrets.sh`, never in Terraform state.

The bootstrap workspace itself is the one seed that must exist before this runs.

## File conventions

Each root and module splits concerns into one file per concern:

| File           | Content                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| `versions.tf`  | `terraform` block, `required_version`, `required_providers`, `cloud` block (roots) |
| `provider.tf`  | AWS provider (`us-east-1`) with `default_tags` (roots only)                        |
| `variables.tf` | Inputs, each constrained one with a `validation` block                             |
| `locals.tf`    | Computed values (names, tags)                                                      |
| `main.tf`      | Resources, or the module composition in a root                                     |
| `outputs.tf`   | Outputs; never a secret, token, email address or account identifier                |

## Version pins

Every root and module uses the same pins:

```hcl
terraform {
  required_version = ">= 1.15, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
```

Terraform generates no secret value, so no `random` provider is used. The bootstrap also uses `hashicorp/tfe ~> 0.82.0`. The lock files of the three roots (`bootstrap`, `envs/dev`, `envs/prod`) are committed. They were generated for every platform with `terraform providers lock -platform=linux_amd64 -platform=windows_amd64 -platform=darwin_arm64`; the lock files of the modules are not committed.

## Offline checks

Run from a root or module directory. None of these needs AWS or HCP credentials:

```
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
tflint
trivy config .
```

## Private values

Real `terraform.tfvars` and `cloud.auto.tfbackend` files are git-ignored. Commit only the `.example` files, which carry placeholder shapes.

## Tests

Native tests (mock providers, plan only): run `terraform test` in a module or root directory, and from `infra/` for the cross-cutting tests in `infra/tests` (after `terraform init -backend=false`). Static scans and script checks, with no dependencies: `node --test "infra/tests/static/*.test.mjs"` from the repository root.
