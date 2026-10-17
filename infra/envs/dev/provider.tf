# AWS credentials come from HCP dynamic provider credentials (the plan and apply
# roles assumed through OIDC). There are no access keys in this configuration.
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = local.tags
  }
}
