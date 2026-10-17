# Property 4: the access log format captures no IP address and no full path.
#
# For all planned configurations of the live stage access log, the format string
# must contain $context.resourcePath and must not contain $context.path,
# $context.identity.sourceIp or any other source-IP or identity field.
# Requirements 5.7, 5.8, 16.6 and 17.3.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_lambda_function" {
    defaults = {
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:aws:function:compass-dev-fn/invocations"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:us-east-1:aws:log-group:/aws/example"
    }
  }
}

variables {
  env                = "dev"
  api_lambda_zip     = "tests/fixtures/api.zip"
  passkit_lambda_zip = "tests/fixtures/passkit.zip"
  table_name         = "compass-dev"
  table_arn          = "arn:aws:dynamodb:us-east-1:aws:table/compass-dev"
  secret_arns = {
    app           = "arn:aws:secretsmanager:us-east-1:aws:secret:compass/dev/app-AbCdEf"
    origin_verify = "arn:aws:secretsmanager:us-east-1:aws:secret:compass/dev/origin-verify-AbCdEf"
    apple         = "arn:aws:secretsmanager:us-east-1:aws:secret:compass/dev/apple-pass-AbCdEf"
    google        = "arn:aws:secretsmanager:us-east-1:aws:secret:compass/dev/google-wallet-AbCdEf"
  }
  permissions_boundary_arn   = "arn:aws:iam::aws:policy/compass-permissions-boundary"
  api_key_value              = "abcdefghijklmnopqrstuvwxyz0123456789"
  event_timezone             = "America/Los_Angeles"
  event_window_start         = "2026-11-30T08:00:00-08:00"
  event_window_end           = "2026-12-04T20:00:00-08:00"
  id_token_issuer            = "https://issuer.example.invalid"
  google_wallet_class_suffix = "compass-dev"
}

run "format_records_route_template_only" {
  command = plan

  assert {
    condition     = strcontains(one(aws_api_gateway_stage.live.access_log_settings).format, "$context.resourcePath")
    error_message = "The access log format must record the route template through $context.resourcePath."
  }

  assert {
    condition     = !strcontains(one(aws_api_gateway_stage.live.access_log_settings).format, "$context.path") && !strcontains(one(aws_api_gateway_stage.live.access_log_settings).format, "$context.identity.sourceIp")
    error_message = "The access log format must not contain $context.path or $context.identity.sourceIp."
  }

  assert {
    condition     = !can(regex("[$]context[.](identity|requestOverride|responseOverride|authorizer|awsEndpointRequestId|domainName|apiId|accountId|wafResponseCode|webaclArn|xrayTraceId|path)([^A-Za-z]|$)", one(aws_api_gateway_stage.live.access_log_settings).format))
    error_message = "The access log format must not contain an identity, account, path or trace field."
  }

  assert {
    condition     = !can(regex("[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+", one(aws_api_gateway_stage.live.access_log_settings).format))
    error_message = "The access log format must not embed an address."
  }
}

# Static scan of the source of the format, which is the single place it is set.
run "source_scan" {
  command = plan

  assert {
    condition     = can(regex("[$]context[.]resourcePath", file("${path.module}/locals.tf"))) && !can(regex("[$]context[.]path", file("${path.module}/locals.tf"))) && !can(regex("sourceIp", file("${path.module}/locals.tf")))
    error_message = "locals.tf must record resourcePath and never path or sourceIp."
  }

  assert {
    condition     = !can(regex("[$]context[.]path", file("${path.module}/main.tf"))) && !can(regex("sourceIp", file("${path.module}/main.tf")))
    error_message = "main.tf must not reference $context.path or sourceIp."
  }
}
