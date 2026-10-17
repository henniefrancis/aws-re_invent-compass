# The tfe provider manages the dev and prod workspaces. It reads its token from
# the TFE_TOKEN environment variable of the owner shell; no token is configured
# here.
provider "tfe" {}

# Runs with the owner's own credentials (local execution). There are no access
# keys in this configuration.
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      project     = "reinvent-compass"
      environment = "bootstrap"
    }
  }
}
