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
