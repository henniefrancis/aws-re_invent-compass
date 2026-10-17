# Infrastructure (stream S6)

Terraform only, region `us-east-1`, state in HCP Terraform. The build plan (sections 6, 7 and 11.3) and the spec in `.kiro/specs/infra/` are the source of truth. Nothing here is applied by an agent: the owner runs every plan and apply.

## Layout

```
infra/
  .terraformignore     files kept out of the HCP upload
  bootstrap/           OIDC provider, four roles, account API Gateway role (owner runs once)
  modules/             site, edge, api, data, secrets, observability
  envs/dev, envs/prod  compose the six modules; real tfvars and tfbackend are git-ignored
  tests/               native tests (mock providers, plan only) and static scans
  build/               git-ignored Lambda zips written by scripts/release.sh
```

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
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}
```

`random` is declared only where it is used (the secrets module). Provider lock files are git-ignored because they are generated per platform; create them with `terraform providers lock` when needed.

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
