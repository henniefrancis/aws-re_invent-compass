# The custom domain in the environment roots (ADR-031).
#
# prod serves the site, /board and the API on reinvent-compass.vegas with
# pass.reinvent-compass.vegas as a second alias; dev serves dev.reinvent-compass.vegas
# only. With domain_name null the roots behave as before. Run from the infra
# directory. Providers are mocked; nothing reaches AWS or HCP Terraform.

mock_provider "aws" {
  override_during = plan

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "aws"
    }
  }

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
      arn            = "arn:aws:cloudfront::aws:distribution/EEXAMPLE"
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

run "prod_serves_the_apex_and_the_pass_host" {
  command = plan

  module {
    source = "./envs/prod"
  }

  variables {
    domain_name   = "reinvent-compass.vegas"
    extra_aliases = ["pass.reinvent-compass.vegas"]
  }

  assert {
    condition     = module.edge.public_domain_names == tolist(["reinvent-compass.vegas", "pass.reinvent-compass.vegas"])
    error_message = "prod must serve the apex and the pass host."
  }
}

run "dev_serves_the_dev_host_only" {
  command = plan

  module {
    source = "./envs/dev"
  }

  variables {
    domain_name = "dev.reinvent-compass.vegas"
  }

  assert {
    condition     = module.edge.public_domain_names == tolist(["dev.reinvent-compass.vegas"])
    error_message = "dev must serve dev.reinvent-compass.vegas only."
  }
}

run "no_domain_keeps_the_cloudfront_default" {
  command = plan

  module {
    source = "./envs/dev"
  }

  assert {
    condition     = length(module.edge.public_domain_names) == 0
    error_message = "With domain_name null the root must keep the CloudFront default domain."
  }
}

run "a_domain_outside_the_zone_is_rejected" {
  command = plan

  module {
    source = "./envs/prod"
  }

  variables {
    domain_name = "example.org"
  }

  expect_failures = [var.domain_name]
}

run "an_alias_without_a_domain_is_rejected" {
  command = plan

  module {
    source = "./envs/prod"
  }

  variables {
    extra_aliases = ["pass.reinvent-compass.vegas"]
  }

  expect_failures = [var.extra_aliases]
}

# PUBLIC_BASE_URL comes from the domain when one is set, with an explicit
# public_base_url winning and the old two-apply path kept when there is no domain.
run "public_base_url_is_derived_from_the_domain" {
  command = plan

  module {
    source = "./envs/prod"
  }

  assert {
    condition = alltrue([
      for env in ["dev", "prod"] :
      can(regex("public_base_url[[:space:]]*=[[:space:]]*var[.]public_base_url != \"\" [?] var[.]public_base_url : [(]var[.]domain_name == null [?] \"\" : \"https://[$][{]var[.]domain_name[}]\"[)]", file("${path.module}/../${env}/locals.tf"))) &&
      can(regex("public_base_url[[:space:]]*=[[:space:]]*local[.]public_base_url", file("${path.module}/../${env}/main.tf")))
    ])
    error_message = "The roots must derive PUBLIC_BASE_URL from the custom domain and pass it to the api module."
  }
}
