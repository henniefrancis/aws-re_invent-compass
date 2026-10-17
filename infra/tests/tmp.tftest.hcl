mock_provider "aws" {
  override_during = plan
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "example"
    }
  }
}
mock_provider "random" {
  override_during = plan
}

variables {
  alarm_email        = "x"
  api_lambda_zip     = "modules/api/tests/fixtures/api.zip"
  passkit_lambda_zip = "modules/api/tests/fixtures/passkit.zip"
}

run "dev" {
  command = plan
  module {
    source = "./envs/dev"
  }
  variables {
    alarm_email = "a@b.cd"
  }
  assert {
    condition     = output.cloudfront_domain_name != "zzz"
    error_message = "x"
  }
}
