terraform {
  required_version = ">= 1.15, < 2.0"

  # State lives in HCP Terraform (ADR-001) in a workspace set to Local execution
  # mode: Terraform runs on the owner's machine with the owner's own credentials
  # and HCP only stores the state. The organisation, project and workspace come
  # from TF_CLOUD_ORGANIZATION, TF_CLOUD_PROJECT and TF_WORKSPACE, so no private
  # name is committed. The bootstrap needs neither the plan nor the apply role,
  # which do not exist until it has run.
  cloud {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    tfe = {
      source  = "hashicorp/tfe"
      version = "~> 0.82.0"
    }
  }
}
