# Property 2: sampling is disabled on every WAF rule.
#
# For all five rules in the web ACL, visibility_config.sampled_requests_enabled
# must be false, and so must the ACL-level setting, whatever the kill-switch
# state. Requirements 4.11, 16.5 and 17.4.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_wafv2_web_acl" {
    defaults = {
      arn = "arn:aws:wafv2:us-east-1:aws:global/webacl/compass-dev/example"
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

run "sampling_off_with_kill_switch_disabled" {
  command = plan

  assert {
    condition     = length(aws_wafv2_web_acl.this.rule) == 8
    error_message = "The web ACL must contain eight rules (the five defined rules, the PassKit rate rule, the API body size rule and the site rate rule)."
  }

  assert {
    condition     = alltrue([for r in aws_wafv2_web_acl.this.rule : one(r.visibility_config).sampled_requests_enabled == false])
    error_message = "sampled_requests_enabled must be false on every rule."
  }

  assert {
    condition     = one(aws_wafv2_web_acl.this.visibility_config).sampled_requests_enabled == false
    error_message = "sampled_requests_enabled must be false on the web ACL."
  }
}

run "sampling_off_with_kill_switch_enabled" {
  command = plan

  variables {
    kill_switch_enabled = true
  }

  assert {
    condition     = alltrue([for r in aws_wafv2_web_acl.this.rule : one(r.visibility_config).sampled_requests_enabled == false])
    error_message = "sampled_requests_enabled must be false on every rule when the kill switch is on."
  }

  assert {
    condition     = one(aws_wafv2_web_acl.this.visibility_config).sampled_requests_enabled == false
    error_message = "sampled_requests_enabled must be false on the web ACL when the kill switch is on."
  }
}

# Static scan: every visibility_config block in the source sets sampling off, so
# a rule added later cannot slip through with the default of sampling on.
run "source_scan" {
  command = plan

  assert {
    condition     = length(regexall("sampled_requests_enabled[[:space:]]*=[[:space:]]*false", file("${path.module}/main.tf"))) == length(regexall("(?m)^[[:space:]]*visibility_config[[:space:]]*[{]", file("${path.module}/main.tf")))
    error_message = "Every visibility_config block must set sampled_requests_enabled = false."
  }

  assert {
    condition     = !can(regex("sampled_requests_enabled[[:space:]]*=[[:space:]]*true", file("${path.module}/main.tf")))
    error_message = "No visibility_config may enable sampled requests."
  }
}
