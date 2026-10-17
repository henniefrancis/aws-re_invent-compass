# One CloudFront distribution fronts the site at / and the API at /api/*
# (ADR-013). The distribution is a retained resource (ADR-015): its domain is
# baked into every issued pass.

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host_header" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_function" "site_viewer_request" {
  name    = "${local.name_prefix}-site-viewer-request"
  comment = "Rewrite directory-style site paths to index.html."
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = local.site_viewer_request_code
}

resource "aws_cloudfront_response_headers_policy" "site" {
  name    = "${local.name_prefix}-site-security-headers"
  comment = "Security headers for the Compass site."

  security_headers_config {
    content_security_policy {
      content_security_policy = local.content_security_policy
      override                = true
    }

    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = local.permissions_policy
      override = true
    }
  }
}

# Headers for API responses: nosniff, HSTS and no referrer. No CSP, which is
# meaningless for JSON and pass downloads.
resource "aws_cloudfront_response_headers_policy" "api" {
  name    = "${local.name_prefix}-api-security-headers"
  comment = "Security headers for the Compass API."

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
  }
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  default_root_object = "index.html"
  comment             = "Compass ${var.env}: site and API"
  web_acl_id          = aws_wafv2_web_acl.this.arn

  origin {
    origin_id                = local.site_origin_id
    domain_name              = var.site_bucket_regional_domain_name
    origin_access_control_id = var.oac_id
  }

  origin {
    origin_id   = local.api_origin_id
    domain_name = var.api_stage_invoke_host
    origin_path = "/live"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # CloudFront overwrites a viewer-supplied header of the same name with a
    # custom origin header, so a client cannot choose either value.
    custom_header {
      name  = "x-origin-verify"
      value = var.origin_verify_secret_value
    }

    custom_header {
      name  = "x-api-key"
      value = var.api_key_value
    }
  }

  # Default behaviour: the site, through the OAC. No custom_error_response block
  # exists on this distribution on purpose: a distribution-level rewrite of 403
  # or 404 would also rewrite the error bodies of the API (problem+json).
  default_cache_behavior {
    target_origin_id           = local.site_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.site_viewer_request.arn
    }
  }

  # API behaviour: never cached, every viewer header except Host forwarded, and
  # no function so request URIs reach the origin untouched.
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = local.api_origin_id
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = false
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id

    response_headers_policy_id = aws_cloudfront_response_headers_policy.api.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  # No standard (access) logging: there is no logging_config block (Requirement
  # 4.7).

  lifecycle {
    prevent_destroy = true
  }
}

# WAF web ACL for the distribution. CLOUDFRONT scope is only valid in
# us-east-1, which is the provider region. There is no logging configuration and
# request sampling is off at the ACL and on every rule, so no source address or
# identifier is retained (Requirements 4.10, 4.11, 17.4).
resource "aws_wafv2_web_acl" "this" {
  name        = local.name_prefix
  description = "Compass ${var.env} edge protection."
  scope       = "CLOUDFRONT"

  # Inspect request bodies up to 64 KB. A larger body counts as oversize and the
  # api-body-size-limit rule blocks it on /api/*.
  association_config {
    request_body {
      cloudfront {
        default_size_inspection_limit = "KB_64"
      }
    }
  }

  default_action {
    allow {}
  }

  rule {
    name     = "per-ip-rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = local.rate_limit
        aggregate_key_type = "IP"

        # API paths only, so a busy site page load cannot trip the API ceiling.
        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/"
            positional_constraint = "STARTS_WITH"

            field_to_match {
              uri_path {}
            }

            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-per-ip-rate-limit"
      sampled_requests_enabled   = false
    }
  }

  rule {
    name     = "aws-managed-common"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        # Pass bodies can exceed the 8 KB body-size limit of this rule group.
        # The API Gateway request validator and the Lambda schema checks bound
        # the body, so this one rule counts instead of blocking.
        rule_action_override {
          name = "SizeRestrictions_BODY"

          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-aws-managed-common"
      sampled_requests_enabled   = false
    }
  }

  rule {
    name     = "aws-managed-known-bad-inputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-aws-managed-known-bad-inputs"
      sampled_requests_enabled   = false
    }
  }

  rule {
    name     = "aws-managed-ip-reputation"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-aws-managed-ip-reputation"
      sampled_requests_enabled   = false
    }
  }

  # Kill switch: always present at priority 5, only its effect toggles. The
  # statement matches every request (URI path length of zero or more).
  rule {
    name     = "kill-switch"
    priority = 5

    action {
      dynamic "block" {
        for_each = var.kill_switch_enabled ? [1] : []
        content {}
      }

      dynamic "count" {
        for_each = var.kill_switch_enabled ? [] : [1]
        content {}
      }
    }

    statement {
      size_constraint_statement {
        comparison_operator = "GE"
        size                = 0

        field_to_match {
          uri_path {}
        }

        text_transformation {
          priority = 0
          type     = "NONE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-kill-switch"
      sampled_requests_enabled   = false
    }
  }

  # Per-IP ceiling on the PassKit web service paths only (sixth rule, after the
  # kill switch so the documented priorities 1 to 5 never move).
  rule {
    name     = "passkit-rate-limit"
    priority = 6

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = local.passkit_rate_limit
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/passkit/"
            positional_constraint = "STARTS_WITH"

            field_to_match {
              uri_path {}
            }

            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-passkit-rate-limit"
      sampled_requests_enabled   = false
    }
  }

  # Seventh rule: block a request body above 64 KB on /api/*.
  rule {
    name     = "api-body-size-limit"
    priority = 7

    action {
      block {}
    }

    statement {
      and_statement {
        statement {
          byte_match_statement {
            search_string         = "/api/"
            positional_constraint = "STARTS_WITH"

            field_to_match {
              uri_path {}
            }

            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }

        statement {
          size_constraint_statement {
            comparison_operator = "GT"
            size                = local.api_body_limit_bytes

            field_to_match {
              body {
                oversize_handling = "MATCH"
              }
            }

            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-api-body-size-limit"
      sampled_requests_enabled   = false
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name_prefix
    sampled_requests_enabled   = false
  }
}
