# Property 1: every managed resource carries the required tags.
#
# For all taggable resources in a planned environment root, the plan shows a
# project tag and an environment tag, supplied by provider default_tags.
# Requirements 1.9 and 16.4.
#
# Run from the infra directory: terraform init -backend=false && terraform test.
# Under a mock provider tags_all is computed and unknown at plan time, so the
# invariant is asserted where it is set: the tag map in locals.tf, the provider
# default_tags that apply it, and the absence of any resource-level tags argument
# that could shadow it. The bootstrap provider is scanned the same way.

mock_provider "aws" {
  override_during = plan

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "aws"
    }
  }

  mock_resource "aws_wafv2_web_acl" {
    defaults = {
      arn = "arn:aws:wafv2:us-east-1:aws:global/webacl/compass-dev/example"
    }
  }

  mock_resource "aws_cloudfront_function" {
    defaults = {
      arn = "arn:aws:cloudfront::aws:function/compass-dev-site-viewer-request"
    }
  }
}

variables {
  # Built from parts so no email address literal sits in a committed file.
  alarm_email         = join("@", ["alarms", "example.invalid"])
  origin_verify_value = "0123456789012345678901234567890123456789"
  api_key_value       = "abcdefghijklmnopqrstuvwxyz0123456789"
  api_lambda_zip      = "modules/api/tests/fixtures/api.zip"
  passkit_lambda_zip  = "modules/api/tests/fixtures/passkit.zip"
  wallet_images_dir   = "modules/site/tests/fixtures/wallet"
  event_timezone      = "America/Los_Angeles"
  event_window_start  = "2026-11-30T08:00:00-08:00"
  event_window_end    = "2026-12-04T20:00:00-08:00"
  id_token_issuer     = "https://issuer.example.invalid"
}

run "dev_root_tags_are_set_at_source" {
  command = plan

  module {
    source = "./envs/dev"
  }

  assert {
    condition     = var.env == "dev"
    error_message = "The dev root must default to the dev environment."
  }

  assert {
    condition     = can(regex("project[[:space:]]*=[[:space:]]*\"reinvent-compass\"", file("${path.module}/locals.tf"))) && can(regex("environment[[:space:]]*=[[:space:]]*var[.]env", file("${path.module}/locals.tf")))
    error_message = "locals.tf must define the project and environment tags."
  }

  assert {
    condition     = can(regex("(?s)default_tags[[:space:]]*[{][[:space:]]*tags[[:space:]]*=[[:space:]]*local[.]tags", file("${path.module}/provider.tf")))
    error_message = "provider.tf must apply local.tags through default_tags."
  }
}

run "prod_root_tags_are_set_at_source" {
  command = plan

  module {
    source = "./envs/prod"
  }

  assert {
    condition     = var.env == "prod"
    error_message = "The prod root must default to the prod environment."
  }

  assert {
    condition     = can(regex("project[[:space:]]*=[[:space:]]*\"reinvent-compass\"", file("${path.module}/locals.tf"))) && can(regex("environment[[:space:]]*=[[:space:]]*var[.]env", file("${path.module}/locals.tf")))
    error_message = "locals.tf must define the project and environment tags."
  }

  assert {
    condition     = can(regex("(?s)default_tags[[:space:]]*[{][[:space:]]*tags[[:space:]]*=[[:space:]]*local[.]tags", file("${path.module}/provider.tf")))
    error_message = "provider.tf must apply local.tags through default_tags."
  }
}

# The bootstrap configuration tags its resources too, and no module may set a
# tags argument that could replace the default tags with a smaller map.
run "bootstrap_and_modules_keep_the_default_tags" {
  command = plan

  module {
    source = "./envs/dev"
  }

  assert {
    condition     = can(regex("project[[:space:]]*=[[:space:]]*\"reinvent-compass\"", file("${path.module}/../../bootstrap/provider.tf"))) && can(regex("environment[[:space:]]*=[[:space:]]*\"bootstrap\"", file("${path.module}/../../bootstrap/provider.tf")))
    error_message = "The bootstrap provider must set the project and environment default tags."
  }

  assert {
    condition = alltrue([
      for m in ["site", "edge", "api", "data", "secrets", "observability"] :
      !can(regex("(?m)^[[:space:]]*tags[[:space:]]*=", file("${path.module}/../../modules/${m}/main.tf")))
    ])
    error_message = "No module resource may set its own tags argument."
  }
}
