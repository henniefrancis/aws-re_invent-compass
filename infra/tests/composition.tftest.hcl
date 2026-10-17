# Property 9: the two environments compose the same modules.
#
# For all six modules (site, edge, api, data, secrets, observability), each module
# is present in both the dev and the prod root, with none present in one and
# absent from the other. Requirement 10.1.
#
# The roots are meant to be identical except for the default of var.env and the
# example files, so the composition is checked three ways: each root declares the
# six module blocks with the expected source, the main.tf files are byte
# identical, and so are locals, outputs, provider and versions. Run from the infra
# directory.

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
  alarm_email         = join("@", ["alarms", "example.invalid"])
  origin_verify_value = "0123456789012345678901234567890123456789"
  api_key_value       = "abcdefghijklmnopqrstuvwxyz0123456789"
  api_lambda_zip      = "modules/api/tests/fixtures/api.zip"
  passkit_lambda_zip  = "modules/api/tests/fixtures/passkit.zip"
  event_timezone      = "America/Los_Angeles"
  event_window_start  = "2026-11-30T08:00:00-08:00"
  event_window_end    = "2026-12-04T20:00:00-08:00"
  id_token_issuer     = "https://issuer.example.invalid"
}

run "both_roots_declare_all_six_modules" {
  command = plan

  module {
    source = "./envs/dev"
  }

  assert {
    condition = alltrue(flatten([
      for env in ["dev", "prod"] : [
        for m in ["site", "edge", "api", "data", "secrets", "observability"] :
        can(regex("(?s)module[[:space:]]+\"${m}\"[[:space:]]*[{][[:space:]]*source[[:space:]]*=[[:space:]]*\"../../modules/${m}\"", file("${path.module}/../${env}/main.tf")))
      ]
    ]))
    error_message = "Each root must declare the site, edge, api, data, secrets and observability modules."
  }

  assert {
    condition = alltrue([
      for env in ["dev", "prod"] :
      length(regexall("(?m)^module[[:space:]]+\"", file("${path.module}/../${env}/main.tf"))) == 6
    ])
    error_message = "Each root must compose exactly six modules."
  }
}

run "roots_are_identical_apart_from_the_env_default" {
  command = plan

  module {
    source = "./envs/dev"
  }

  assert {
    condition = alltrue([
      for f in ["main.tf", "locals.tf", "outputs.tf", "provider.tf", "versions.tf"] :
      file("${path.module}/../dev/${f}") == file("${path.module}/../prod/${f}")
    ])
    error_message = "The dev and prod roots must compose the same modules in the same way."
  }

  assert {
    condition     = replace(file("${path.module}/../dev/variables.tf"), "default     = \"dev\"", "default     = \"prod\"") == file("${path.module}/../prod/variables.tf")
    error_message = "The dev and prod variables must differ only in the env default."
  }
}
