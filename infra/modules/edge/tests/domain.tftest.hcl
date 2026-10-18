# Plan-only assertions for the custom domain of the edge module (ADR-031).
# The aws provider is mocked, so nothing here reaches AWS. With a domain the
# distribution carries the aliases, an ACM certificate validated by DNS records in
# the existing hosted zone, TLSv1.2_2021 and A and AAAA alias records. With
# domain_name null nothing about the distribution changes.

mock_provider "aws" {
  override_during = plan

  mock_data "aws_route53_zone" {
    defaults = {
      zone_id = "Z0EXAMPLEZONE"
    }
  }

  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:us-east-1:aws:certificate/example"
      domain_validation_options = [
        {
          domain_name           = "reinvent-compass.vegas"
          resource_record_name  = "_aaaa.reinvent-compass.vegas."
          resource_record_type  = "CNAME"
          resource_record_value = "_bbbb.acm-validations.aws."
        },
        {
          domain_name           = "pass.reinvent-compass.vegas"
          resource_record_name  = "_cccc.pass.reinvent-compass.vegas."
          resource_record_type  = "CNAME"
          resource_record_value = "_dddd.acm-validations.aws."
        },
        {
          domain_name           = "dev.reinvent-compass.vegas"
          resource_record_name  = "_eeee.dev.reinvent-compass.vegas."
          resource_record_type  = "CNAME"
          resource_record_value = "_ffff.acm-validations.aws."
        },
      ]
    }
  }

  mock_resource "aws_acm_certificate_validation" {
    defaults = {
      certificate_arn = "arn:aws:acm:us-east-1:aws:certificate/example"
    }
  }

  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      domain_name    = "d1example.cloudfront.net"
      hosted_zone_id = "Z2FDTNDATAQYW2"
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
  env                              = "dev"
  site_bucket_regional_domain_name = "compass-dev-site-example.s3.us-east-1.amazonaws.com"
  oac_id                           = "oac-example"
  api_stage_invoke_host            = "abc123.execute-api.us-east-1.amazonaws.com"
  origin_verify_secret_value       = "0123456789012345678901234567890123456789"
  api_key_value                    = "abcdefghijklmnopqrstuvwxyz0123456789"
}

run "no_domain_changes_nothing" {
  command = plan

  assert {
    condition     = length(aws_cloudfront_distribution.this.aliases) == 0
    error_message = "Without a domain the distribution must have no alias."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.this.viewer_certificate).cloudfront_default_certificate == true
    error_message = "Without a domain the distribution must keep the CloudFront default certificate."
  }

  assert {
    condition     = length(aws_acm_certificate.this) == 0 && length(aws_acm_certificate_validation.this) == 0 && length(aws_route53_record.validation) == 0 && length(aws_route53_record.alias) == 0 && length(data.aws_route53_zone.this) == 0
    error_message = "Without a domain there must be no certificate, no DNS record and no zone lookup."
  }

  assert {
    condition     = length(output.public_domain_names) == 0
    error_message = "Without a domain no public name is reported."
  }
}

run "prod_domain_with_the_pass_alias" {
  command = plan

  variables {
    domain_name      = "reinvent-compass.vegas"
    extra_aliases    = ["pass.reinvent-compass.vegas"]
    hosted_zone_name = "reinvent-compass.vegas"
  }

  assert {
    condition     = aws_cloudfront_distribution.this.aliases == toset(["reinvent-compass.vegas", "pass.reinvent-compass.vegas"])
    error_message = "The distribution must carry both aliases."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.this.viewer_certificate).acm_certificate_arn == "arn:aws:acm:us-east-1:aws:certificate/example" && one(aws_cloudfront_distribution.this.viewer_certificate).ssl_support_method == "sni-only" && one(aws_cloudfront_distribution.this.viewer_certificate).minimum_protocol_version == "TLSv1.2_2021"
    error_message = "The viewer certificate must be the ACM certificate, SNI only, TLSv1.2_2021."
  }

  assert {
    condition     = aws_acm_certificate.this[0].domain_name == "reinvent-compass.vegas" && aws_acm_certificate.this[0].subject_alternative_names == toset(["pass.reinvent-compass.vegas"]) && aws_acm_certificate.this[0].validation_method == "DNS"
    error_message = "The certificate must cover both names and validate by DNS."
  }

  assert {
    condition     = toset(keys(aws_route53_record.validation)) == toset(["reinvent-compass.vegas", "pass.reinvent-compass.vegas"]) && alltrue([for r in values(aws_route53_record.validation) : r.zone_id == "Z0EXAMPLEZONE" && r.allow_overwrite])
    error_message = "One validation record per name must be created in the zone."
  }

  assert {
    condition     = toset(keys(aws_route53_record.alias)) == toset(["reinvent-compass.vegas/A", "reinvent-compass.vegas/AAAA", "pass.reinvent-compass.vegas/A", "pass.reinvent-compass.vegas/AAAA"])
    error_message = "An A and an AAAA alias record must exist for every name."
  }

  assert {
    condition     = alltrue([for r in values(aws_route53_record.alias) : one(r.alias).name == "d1example.cloudfront.net" && one(r.alias).zone_id == "Z2FDTNDATAQYW2" && r.zone_id == "Z0EXAMPLEZONE"])
    error_message = "Every alias record must point at the distribution in the zone."
  }

  assert {
    condition     = length(aws_acm_certificate_validation.this) == 1
    error_message = "The distribution must wait for the certificate validation."
  }

  assert {
    condition     = output.public_domain_names == tolist(["reinvent-compass.vegas", "pass.reinvent-compass.vegas"])
    error_message = "The public names must be reported."
  }
}

run "dev_domain_only" {
  command = plan

  variables {
    domain_name      = "dev.reinvent-compass.vegas"
    hosted_zone_name = "reinvent-compass.vegas"
  }

  assert {
    condition     = aws_cloudfront_distribution.this.aliases == toset(["dev.reinvent-compass.vegas"]) && length(aws_route53_record.alias) == 2
    error_message = "Dev has one alias, with an A and an AAAA record."
  }
}

run "alias_outside_the_zone_is_rejected" {
  command = plan

  variables {
    domain_name      = "example.org"
    hosted_zone_name = "reinvent-compass.vegas"
  }

  expect_failures = [var.hosted_zone_name]
}

run "extra_alias_needs_a_domain" {
  command = plan

  variables {
    extra_aliases = ["pass.reinvent-compass.vegas"]
  }

  expect_failures = [var.extra_aliases]
}

run "domain_needs_a_zone" {
  command = plan

  variables {
    domain_name = "reinvent-compass.vegas"
  }

  expect_failures = [var.hosted_zone_name]
}

# Static scan of facts a mock plan cannot show.
run "source_scan" {
  command = plan

  assert {
    condition     = can(regex("minimum_protocol_version[[:space:]]*=[[:space:]]*\"TLSv1[.]2_2021\"", file("${path.module}/main.tf"))) && can(regex("ssl_support_method[[:space:]]*=[[:space:]]*\"sni-only\"", file("${path.module}/main.tf")))
    error_message = "The custom certificate must be SNI only with TLSv1.2_2021."
  }

  assert {
    condition     = can(regex("(?s)resource[[:space:]]+\"aws_acm_certificate\"[[:space:]]+\"this\".*?create_before_destroy[[:space:]]*=[[:space:]]*true", file("${path.module}/main.tf")))
    error_message = "The certificate must be replaced create-before-destroy."
  }

  assert {
    condition     = can(regex("data[[:space:]]+\"aws_route53_zone\"", file("${path.module}/main.tf"))) && !can(regex("resource[[:space:]]+\"aws_route53_zone\"", file("${path.module}/main.tf")))
    error_message = "The hosted zone must be read with a data source, not managed."
  }
}
