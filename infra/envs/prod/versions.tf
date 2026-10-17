terraform {
  required_version = ">= 1.15, < 2.0"

  # State and runs live in HCP Terraform. The organisation, project and
  # workspace come from TF_CLOUD_ORGANIZATION, TF_CLOUD_PROJECT and TF_WORKSPACE
  # (scripts/release.sh exports them from the git-ignored cloud.auto.tfbackend),
  # so no private name is committed and no -backend-config file is passed.
  cloud {}

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
