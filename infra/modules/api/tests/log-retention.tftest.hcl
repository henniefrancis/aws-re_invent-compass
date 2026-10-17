# Property 3: every log group retains logs for 14 days.
#
# For all CloudWatch log groups created by the api module (the two Lambda log
# groups and the stage access-log group), retention_in_days must equal 14.
# Requirements 5.12, 5.13 and 16.3.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_lambda_function" {
    defaults = {
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:aws:function:compass-dev-fn/invocations"
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

run "every_log_group_keeps_14_days" {
  command = plan

  assert {
    condition     = aws_cloudwatch_log_group.api_lambda.retention_in_days == 14
    error_message = "The api Lambda log group must retain logs for 14 days."
  }

  assert {
    condition     = aws_cloudwatch_log_group.passkit_lambda.retention_in_days == 14
    error_message = "The passkit Lambda log group must retain logs for 14 days."
  }

  assert {
    condition     = aws_cloudwatch_log_group.access.retention_in_days == 14
    error_message = "The stage access-log group must retain logs for 14 days."
  }
}

run "log_group_names" {
  command = plan

  assert {
    condition     = aws_cloudwatch_log_group.api_lambda.name == "/aws/lambda/${aws_lambda_function.api.function_name}" && aws_cloudwatch_log_group.passkit_lambda.name == "/aws/lambda/${aws_lambda_function.passkit.function_name}"
    error_message = "Each Lambda log group must use the name Lambda writes to."
  }
}

# Static scan: every log group in the source states a retention of 14 days, so a
# group added later cannot default to never expiring.
run "source_scan" {
  command = plan

  assert {
    condition     = length(regexall("(?m)^resource[[:space:]]+\"aws_cloudwatch_log_group\"", file("${path.module}/main.tf"))) == 3
    error_message = "The module must declare exactly three log groups."
  }

  assert {
    condition     = length(regexall("retention_in_days[[:space:]]*=[[:space:]]*local[.]log_retention_days", file("${path.module}/main.tf"))) == 3 && can(regex("log_retention_days[[:space:]]*=[[:space:]]*14", file("${path.module}/locals.tf")))
    error_message = "Every log group must use the 14 day retention local."
  }
}
