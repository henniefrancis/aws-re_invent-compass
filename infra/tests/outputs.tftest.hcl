# Property 6: no Terraform output exposes a secret or identifier.
#
# For all outputs declared by the environment roots and modules, no value is a
# secret, token, email address or account identifier, and any unavoidable
# sensitive value is marked sensitive. Requirements 7.4 and 17.1.
#
# This file pins the output sets of the roots and the module outputs that must
# stay out of any root output. The lexical, repo-wide check that every output
# block is free of secret-bearing references lives in infra/tests/static
# (outputs.test.mjs). Run from the infra directory.

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

run "roots_output_only_the_allowed_non_secret_values" {
  command = plan

  module {
    source = "./envs/dev"
  }

  assert {
    condition = alltrue([
      for env in ["dev", "prod"] :
      sort(flatten(regexall("(?m)^output[[:space:]]+\"([a-z_]+)\"", file("${path.module}/../${env}/outputs.tf")))) == tolist(["cloudfront_domain_name", "distribution_id", "site_bucket_name"])
    ])
    error_message = "Each root may output only the CloudFront domain, the distribution id and the site bucket name."
  }

  assert {
    condition = alltrue([
      for env in ["dev", "prod"] :
      !can(regex("sensitive|secret|key|email|arn|account|token|pepper|origin_verify", join("\n", [for l in split("\n", file("${path.module}/../${env}/outputs.tf")) : l if startswith(trimspace(l), "value")])))
    ])
    error_message = "A root output value must not reference a secret, key, email, ARN or account."
  }
}

run "secret_values_are_not_module_outputs" {
  command = plan

  module {
    source = "./envs/dev"
  }

  assert {
    condition     = !can(regex("(?m)^output[[:space:]]+\"[a-z_]*(pepper|origin_verify|api_key|password|secret_value)", join("\n", [for m in ["site", "edge", "api", "data", "secrets", "observability"] : file("${path.module}/../../modules/${m}/outputs.tf")])))
    error_message = "No module may output a pepper, origin-verify value, API key or password."
  }

  assert {
    condition     = !can(regex("(?m)^output[[:space:]]+\"[a-z_]*email", join("\n", [for m in ["observability", "data", "api"] : file("${path.module}/../../modules/${m}/outputs.tf")])))
    error_message = "The alarm email must never be output."
  }
}
