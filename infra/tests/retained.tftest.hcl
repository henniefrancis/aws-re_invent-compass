# Property 5: every retained resource is protected against destruction.
#
# For all seven Retained_Resources (the CloudFront distribution, the DynamoDB table,
# the four secrets and the site bucket), prevent_destroy = true sits in the
# resource lifecycle block. Requirements 9.1 to 9.4 and 16.2.
#
# prevent_destroy is a lifecycle meta-argument that plan output never shows, and a
# refusal can only be observed against existing state, which a plan-only test with
# a mock provider does not have. The invariant is therefore asserted by scanning
# the source of each resource block. Run from the infra directory.

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

run "all_retained_resources_set_prevent_destroy" {
  command = plan

  module {
    source = "./envs/dev"
  }

  # Each retained resource block is cut out of its file on its own, so a
  # prevent_destroy belonging to a neighbouring resource can never satisfy it.
  assert {
    condition = alltrue([
      for r in [
        { file = "edge", type = "aws_cloudfront_distribution", name = "this" },
        { file = "data", type = "aws_dynamodb_table", name = "this" },
        { file = "site", type = "aws_s3_bucket", name = "this" },
        { file = "secrets", type = "aws_secretsmanager_secret", name = "apple_pass" },
        { file = "secrets", type = "aws_secretsmanager_secret", name = "google_wallet" },
        { file = "secrets", type = "aws_secretsmanager_secret", name = "app" },
        { file = "secrets", type = "aws_secretsmanager_secret", name = "origin_verify" },
        ] : length([
          for blk in split("\nresource ", "\n${file("${path.module}/../../modules/${r.file}/main.tf")}") :
          blk if startswith(blk, "\"${r.type}\" \"${r.name}\"") && can(regex("lifecycle[[:space:]]*[{][[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*true", blk))
      ]) == 1
    ])
    error_message = "All seven retained resources (distribution, table, site bucket, four secrets) must set prevent_destroy = true in their own block."
  }
}

# Each retained resource type exists exactly the expected number of times, so a
# second copy without protection cannot be added unnoticed.
run "retained_resource_counts" {
  command = plan

  module {
    source = "./envs/dev"
  }

  assert {
    condition = alltrue([
      length(regexall("(?m)^resource[[:space:]]+\"aws_cloudfront_distribution\"", file("${path.module}/../../modules/edge/main.tf"))) == 1,
      length(regexall("(?m)^resource[[:space:]]+\"aws_dynamodb_table\"", file("${path.module}/../../modules/data/main.tf"))) == 1,
      length(regexall("(?m)^resource[[:space:]]+\"aws_s3_bucket\"", file("${path.module}/../../modules/site/main.tf"))) == 1,
      length(regexall("(?m)^resource[[:space:]]+\"aws_secretsmanager_secret\"", file("${path.module}/../../modules/secrets/main.tf"))) == 4,
      length(regexall("(?m)^[[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*true", join("\n", [for m in ["edge", "data", "site", "secrets"] : file("${path.module}/../../modules/${m}/main.tf")]))) == 7,
    ])
    error_message = "Exactly seven resources must carry prevent_destroy = true."
  }

  assert {
    condition     = !can(regex("(?m)^[[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*false", join("\n", [for m in ["edge", "data", "site", "secrets", "api", "observability"] : file("${path.module}/../../modules/${m}/main.tf")])))
    error_message = "No resource may set prevent_destroy = false."
  }
}
