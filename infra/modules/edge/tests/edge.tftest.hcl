# Plan-only assertions for the edge module (Requirements 4.1 to 4.12, 9.1).
# The aws provider is mocked, so nothing here reaches AWS. Values the provider
# computes are supplied by the mock defaults below so they are known at plan.
#
# The distribution "origin" set and the managed policy data sources are not
# visible to a plan assertion under a mock (the set holds computed members and
# is marked sensitive by the origin header, and a mocked data source has no id),
# so those facts are asserted against the source in the source_scan run.

mock_provider "aws" {
  override_during = plan

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

  mock_resource "aws_cloudfront_response_headers_policy" {
    defaults = {
      id = "headers-policy-example"
    }
  }
}

variables {
  env                              = "dev"
  site_bucket_regional_domain_name = "compass-dev-site-example.s3.us-east-1.amazonaws.com"
  oac_id                           = "oac-example"
  api_stage_invoke_host            = "abc123.execute-api.us-east-1.amazonaws.com"
  origin_verify_secret_value       = "0123456789012345678901234567890123456789"
  api_key_value                    = "abcdefghijklmnopqrstuvwxyz0123456789"
}

run "distribution_default_behaviour" {
  command = plan

  assert {
    condition     = aws_cloudfront_distribution.this.default_root_object == "index.html"
    error_message = "The distribution must serve index.html at the root."
  }

  assert {
    condition     = aws_cloudfront_distribution.this.default_cache_behavior[0].target_origin_id == "site"
    error_message = "The default behaviour must target the site origin."
  }

  assert {
    condition     = aws_cloudfront_distribution.this.default_cache_behavior[0].response_headers_policy_id == "headers-policy-example"
    error_message = "The default behaviour must attach the response headers policy."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.this.default_cache_behavior[0].function_association).event_type == "viewer-request"
    error_message = "The default behaviour must attach the viewer-request function."
  }

  assert {
    condition     = aws_cloudfront_distribution.this.web_acl_id == aws_wafv2_web_acl.this.arn
    error_message = "The distribution must be associated with the web ACL ARN."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.this.logging_config) == 0
    error_message = "Standard logging must stay off."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.this.custom_error_response) == 0
    error_message = "No custom_error_response may be set."
  }
}

run "distribution_api_behaviour" {
  command = plan

  assert {
    condition     = length(aws_cloudfront_distribution.this.ordered_cache_behavior) == 1
    error_message = "Exactly one ordered behaviour is expected."
  }

  assert {
    condition     = aws_cloudfront_distribution.this.ordered_cache_behavior[0].path_pattern == "/api/*" && aws_cloudfront_distribution.this.ordered_cache_behavior[0].target_origin_id == "api"
    error_message = "The ordered behaviour must route /api/* to the API origin."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.this.ordered_cache_behavior[0].function_association) == 0
    error_message = "The API behaviour must not attach a function."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.this.ordered_cache_behavior[0].allowed_methods) == 7
    error_message = "The API behaviour must allow all seven methods."
  }
}

run "api_behaviour_has_response_headers_and_waf_limits" {
  command = plan

  assert {
    condition     = aws_cloudfront_distribution.this.ordered_cache_behavior[0].response_headers_policy_id == "headers-policy-example"
    error_message = "The API behaviour must attach a response headers policy."
  }

  assert {
    condition     = one(one(one(aws_wafv2_web_acl.this.association_config).request_body).cloudfront).default_size_inspection_limit == "KB_64"
    error_message = "The web ACL must inspect request bodies up to 64 KB."
  }

  assert {
    condition     = one([for r in aws_wafv2_web_acl.this.rule : length(one(r.action).block) if r.name == "api-body-size-limit"]) == 1
    error_message = "The body size rule must block."
  }
}

run "web_acl_shape" {
  command = plan

  assert {
    condition     = aws_wafv2_web_acl.this.scope == "CLOUDFRONT"
    error_message = "The web ACL must use CLOUDFRONT scope."
  }

  assert {
    condition     = length(aws_wafv2_web_acl.this.rule) == 7
    error_message = "The web ACL must contain the five defined rules, the PassKit rate rule and the API body size rule."
  }

  assert {
    condition     = sort([for r in aws_wafv2_web_acl.this.rule : format("%d-%s", r.priority, r.name)]) == tolist(["1-per-ip-rate-limit", "2-aws-managed-common", "3-aws-managed-known-bad-inputs", "4-aws-managed-ip-reputation", "5-kill-switch", "6-passkit-rate-limit", "7-api-body-size-limit"])
    error_message = "The rules must be in the defined priority order."
  }
}

run "kill_switch_counts_by_default" {
  command = plan

  assert {
    condition     = one([for r in aws_wafv2_web_acl.this.rule : r.priority if r.name == "kill-switch"]) == 5
    error_message = "The kill-switch rule must sit at priority 5."
  }

  assert {
    condition     = one([for r in aws_wafv2_web_acl.this.rule : length(one(r.action).count) if r.name == "kill-switch"]) == 1 && one([for r in aws_wafv2_web_acl.this.rule : length(one(r.action).block) if r.name == "kill-switch"]) == 0
    error_message = "With the switch off the rule must count and not block."
  }
}

run "kill_switch_blocks_when_enabled" {
  command = plan

  variables {
    kill_switch_enabled = true
  }

  assert {
    condition     = one([for r in aws_wafv2_web_acl.this.rule : length(one(r.action).block) if r.name == "kill-switch"]) == 1 && one([for r in aws_wafv2_web_acl.this.rule : length(one(r.action).count) if r.name == "kill-switch"]) == 0
    error_message = "With the switch on the rule must block and not count."
  }

  assert {
    condition     = one([for r in aws_wafv2_web_acl.this.rule : r.priority if r.name == "kill-switch"]) == 5
    error_message = "The kill-switch rule must keep priority 5 when enabled."
  }
}

# M2, L1 and L2 are facts about the source: the global per-IP rule is scoped to
# /api/*, the API headers policy sets nosniff, HSTS and no-referrer, and the body
# rule uses the 64 KB limit.
run "waf_and_headers_source_scan" {
  command = plan

  assert {
    condition     = can(regex("(?s)name[[:space:]]*=[[:space:]]*\"per-ip-rate-limit\".*?scope_down_statement.*?search_string[[:space:]]*=[[:space:]]*\"/api/\"", file("${path.module}/main.tf")))
    error_message = "The global per-IP rule must be scoped to /api/*."
  }

  assert {
    condition     = can(regex("api_body_limit_bytes[[:space:]]*=[[:space:]]*65536", file("${path.module}/locals.tf"))) && can(regex("default_size_inspection_limit[[:space:]]*=[[:space:]]*\"KB_64\"", file("${path.module}/main.tf")))
    error_message = "The body limit and the inspection limit must both be 64 KB."
  }

  assert {
    condition     = can(regex("(?s)resource[[:space:]]+\"aws_cloudfront_response_headers_policy\"[[:space:]]+\"api\".*?strict_transport_security.*?content_type_options.*?referrer_policy[[:space:]]*=[[:space:]]*\"no-referrer\"", file("${path.module}/main.tf")))
    error_message = "The API headers policy must set HSTS, nosniff and no-referrer."
  }
}

run "no_waf_logging_destination" {
  command = plan

  assert {
    condition     = !can(regex("aws_wafv2_web_acl_logging_configuration", file("${path.module}/main.tf")))
    error_message = "No WAF logging configuration may be declared."
  }
}

run "invalid_api_host_is_rejected" {
  command = plan

  variables {
    api_stage_invoke_host = "https://abc123.execute-api.us-east-1.amazonaws.com/live"
  }

  expect_failures = [var.api_stage_invoke_host]
}

run "short_api_key_is_rejected" {
  command = plan

  variables {
    api_key_value = "short"
  }

  expect_failures = [var.api_key_value]
}

run "short_origin_verify_is_rejected" {
  command = plan

  variables {
    origin_verify_secret_value = "short"
  }

  expect_failures = [var.origin_verify_secret_value]
}

# Static HCL scan: prevent_destroy is a lifecycle meta-argument that plan output
# does not show, and the origin and managed policy wiring is not visible under a
# mock provider (see the header of this file).
run "source_scan" {
  command = plan

  assert {
    condition     = can(regex("(?s)resource[[:space:]]+\"aws_cloudfront_distribution\"[[:space:]]+\"this\".*lifecycle[[:space:]]*[{][[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*true", file("${path.module}/main.tf")))
    error_message = "The distribution must set prevent_destroy = true."
  }

  assert {
    condition     = can(regex("name[[:space:]]*=[[:space:]]*\"x-api-key\"", file("${path.module}/main.tf"))) && can(regex("value[[:space:]]*=[[:space:]]*var[.]api_key_value", file("${path.module}/main.tf")))
    error_message = "The API origin must also send x-api-key from the variable."
  }

  assert {
    condition     = can(regex("origin_path[[:space:]]*=[[:space:]]*\"/live\"", file("${path.module}/main.tf"))) && can(regex("name[[:space:]]*=[[:space:]]*\"x-origin-verify\"", file("${path.module}/main.tf"))) && can(regex("value[[:space:]]*=[[:space:]]*var[.]origin_verify_secret_value", file("${path.module}/main.tf")))
    error_message = "The API origin must use /live and send x-origin-verify from the variable."
  }

  assert {
    condition     = can(regex("name[[:space:]]*=[[:space:]]*\"Managed-CachingDisabled\"", file("${path.module}/main.tf"))) && can(regex("name[[:space:]]*=[[:space:]]*\"Managed-AllViewerExceptHostHeader\"", file("${path.module}/main.tf")))
    error_message = "The managed CachingDisabled and AllViewerExceptHostHeader policies must be looked up."
  }

  assert {
    condition     = can(regex("(?s)ordered_cache_behavior[[:space:]]*[{][^}]*cache_policy_id[[:space:]]*=[[:space:]]*data[.]aws_cloudfront_cache_policy[.]caching_disabled[.]id[^}]*origin_request_policy_id[[:space:]]*=[[:space:]]*data[.]aws_cloudfront_origin_request_policy[.]all_viewer_except_host_header[.]id", file("${path.module}/main.tf")))
    error_message = "The API behaviour must wire both managed policies."
  }

  assert {
    condition     = can(regex("(?s)origin_access_control_id[[:space:]]*=[[:space:]]*var[.]oac_id", file("${path.module}/main.tf")))
    error_message = "The site origin must use the origin access control."
  }

  assert {
    condition     = !can(regex("(?m)^[[:space:]]*(logging_config|custom_error_response)[[:space:]]*[{]", file("${path.module}/main.tf")))
    error_message = "The distribution must not declare logging_config or custom_error_response blocks."
  }

  assert {
    condition = alltrue([
      for h in ["content_security_policy", "strict_transport_security", "content_type_options", "referrer_policy"] :
      can(regex("(?m)^[[:space:]]*${h}[[:space:]]*[{]", file("${path.module}/main.tf")))
    ]) && can(regex("header[[:space:]]*=[[:space:]]*\"Permissions-Policy\"", file("${path.module}/main.tf"))) && can(regex("referrer_policy[[:space:]]*=[[:space:]]*\"no-referrer\"", file("${path.module}/main.tf")))
    error_message = "The response headers policy must set CSP, HSTS, nosniff, no-referrer and Permissions-Policy."
  }
}
