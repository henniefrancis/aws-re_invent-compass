# Plan-only assertions for the api module (Requirements 5.1 to 5.14).
# The aws provider is mocked, so nothing here reaches AWS. The zip fixtures are
# placeholder files: the plan only needs them to exist so their hash can be read.
#
# prevent_destroy-style meta-arguments and argument names that plan output does
# not show are asserted against the source in the source_scan run.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_lambda_function" {
    defaults = {
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:aws:function:compass-dev-fn/invocations"
    }
  }

  mock_resource "aws_api_gateway_rest_api" {
    defaults = {
      id            = "restapi1"
      execution_arn = "arn:aws:execute-api:us-east-1:aws:restapi1"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:us-east-1:aws:log-group:/aws/example"
    }
  }
}

override_resource {
  target          = aws_lambda_function.api
  override_during = plan
  values = {
    invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:aws:function:compass-dev-api/invocations"
  }
}

override_resource {
  target          = aws_lambda_function.passkit
  override_during = plan
  values = {
    invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:aws:function:compass-dev-passkit/invocations"
  }
}

override_resource {
  target          = aws_iam_role.api
  override_during = plan
  values = {
    arn = "arn:aws:iam::aws:role/compass-dev-api-lambda"
  }
}

override_resource {
  target          = aws_iam_role.passkit
  override_during = plan
  values = {
    arn = "arn:aws:iam::aws:role/compass-dev-passkit-lambda"
  }
}

variables {
  env                = "dev"
  api_lambda_zip     = "tests/fixtures/api.zip"
  passkit_lambda_zip = "tests/fixtures/passkit.zip"
  table_name         = "compass-dev"
  table_arn          = "arn:aws:dynamodb:us-east-1:aws:table/compass-dev"
  secret_arns = {
    app    = "arn:aws:secretsmanager:us-east-1:aws:secret:compass/dev/app-AbCdEf"
    apple  = "arn:aws:secretsmanager:us-east-1:aws:secret:compass/dev/apple-pass-AbCdEf"
    google = "arn:aws:secretsmanager:us-east-1:aws:secret:compass/dev/google-wallet-AbCdEf"
  }
  permissions_boundary_arn = "arn:aws:iam::aws:policy/compass-permissions-boundary"
}

run "rest_api_from_contract" {
  command = plan

  assert {
    condition     = one(aws_api_gateway_rest_api.this.endpoint_configuration).types == tolist(["REGIONAL"])
    error_message = "The REST API must be a regional endpoint."
  }

  assert {
    condition     = aws_api_gateway_rest_api.this.binary_media_types == null || length(aws_api_gateway_rest_api.this.binary_media_types) == 0
    error_message = "binary_media_types must not be set in Terraform."
  }

  assert {
    condition     = strcontains(aws_api_gateway_rest_api.this.body, "functions/arn:aws:lambda:us-east-1:aws:function:compass-dev-api/invocations") && strcontains(aws_api_gateway_rest_api.this.body, "functions/arn:aws:lambda:us-east-1:aws:function:compass-dev-passkit/invocations")
    error_message = "The body must be rendered with both Lambda invoke ARNs."
  }

  assert {
    condition     = !strcontains(aws_api_gateway_rest_api.this.body, "api_lambda_invoke_arn") && !strcontains(aws_api_gateway_rest_api.this.body, "passkit_lambda_invoke_arn")
    error_message = "No template marker may be left unrendered in the body."
  }

  assert {
    condition     = strcontains(aws_api_gateway_rest_api.this.body, "x-amazon-apigateway-binary-media-types") && strcontains(aws_api_gateway_rest_api.this.body, "application/vnd.apple.pkpass")
    error_message = "The contract must supply the binary media types."
  }
}

run "deployment_and_stage" {
  command = plan

  assert {
    condition     = aws_api_gateway_deployment.this.triggers["redeployment"] == sha1(aws_api_gateway_rest_api.this.body)
    error_message = "The deployment must redeploy on a change of the rendered body."
  }

  assert {
    condition     = aws_api_gateway_stage.live.stage_name == "live"
    error_message = "The stage must be named live."
  }

  assert {
    condition     = aws_api_gateway_method_settings.default.method_path == "*/*"
    error_message = "The default method settings must apply to every method."
  }

  assert {
    condition     = one(aws_api_gateway_method_settings.default.settings).logging_level == "OFF" && one(aws_api_gateway_method_settings.default.settings).data_trace_enabled == false && one(aws_api_gateway_method_settings.default.settings).metrics_enabled == true
    error_message = "Default settings must be logging OFF, data trace off and metrics on."
  }

  assert {
    condition     = one(aws_api_gateway_method_settings.default.settings).throttling_rate_limit == 50 && one(aws_api_gateway_method_settings.default.settings).throttling_burst_limit == 100
    error_message = "The stage-wide throttle must default to 50 and 100."
  }

  assert {
    condition     = length(aws_api_gateway_method_settings.route) == 0
    error_message = "No route override may exist by default."
  }
}

run "route_throttle_overrides" {
  command = plan

  variables {
    route_throttles = {
      "api/v1/passes/POST" = { rate = 5, burst = 10 }
    }
  }

  assert {
    condition     = one(aws_api_gateway_method_settings.route["api/v1/passes/POST"].settings).throttling_rate_limit == 5 && one(aws_api_gateway_method_settings.route["api/v1/passes/POST"].settings).throttling_burst_limit == 10
    error_message = "A route override must carry its own rate and burst."
  }

  assert {
    condition     = aws_api_gateway_method_settings.route["api/v1/passes/POST"].method_path == "api/v1/passes/POST"
    error_message = "A route override must use its key as the method path."
  }
}

run "lambda_functions" {
  command = plan

  assert {
    condition     = aws_lambda_function.api.runtime == "nodejs24.x" && aws_lambda_function.passkit.runtime == "nodejs24.x"
    error_message = "Both Lambdas must use nodejs24.x."
  }

  assert {
    condition     = aws_lambda_function.api.architectures == tolist(["arm64"]) && aws_lambda_function.passkit.architectures == tolist(["arm64"])
    error_message = "Both Lambdas must run on arm64."
  }

  assert {
    condition     = aws_lambda_function.api.memory_size == 512 && aws_lambda_function.passkit.memory_size == 512
    error_message = "Both Lambdas must have 512 MB."
  }

  assert {
    condition     = aws_lambda_function.api.timeout == 10 && aws_lambda_function.passkit.timeout == 5
    error_message = "The api timeout must be 10 s and the passkit timeout 5 s."
  }

  assert {
    condition     = aws_lambda_function.api.role == aws_iam_role.api.arn && aws_lambda_function.passkit.role == aws_iam_role.passkit.arn && aws_iam_role.api.name != aws_iam_role.passkit.name && aws_iam_role.api.arn != aws_iam_role.passkit.arn
    error_message = "Each Lambda must use its own dedicated role."
  }

  assert {
    condition     = aws_iam_role.api.permissions_boundary == var.permissions_boundary_arn && aws_iam_role.passkit.permissions_boundary == var.permissions_boundary_arn
    error_message = "Both roles must carry the project permissions boundary."
  }

  assert {
    condition     = !contains(keys(one(aws_lambda_function.passkit.environment).variables), "GOOGLE_SECRET_ARN") && contains(keys(one(aws_lambda_function.api.environment).variables), "GOOGLE_SECRET_ARN")
    error_message = "Only the api Lambda may know the Google secret."
  }
}

run "lambda_permissions" {
  command = plan

  assert {
    condition     = aws_lambda_permission.api.principal == "apigateway.amazonaws.com" && aws_lambda_permission.passkit.principal == "apigateway.amazonaws.com"
    error_message = "Both permissions must name the API Gateway principal."
  }

  assert {
    condition     = aws_lambda_permission.api.source_arn == "${aws_api_gateway_rest_api.this.execution_arn}/*/*" && aws_lambda_permission.passkit.source_arn == "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
    error_message = "Both permissions must be scoped to <execution_arn>/*/*."
  }

  assert {
    condition     = aws_lambda_permission.api.function_name == "compass-dev-api" && aws_lambda_permission.passkit.function_name == "compass-dev-passkit"
    error_message = "Each permission must target its own function."
  }
}

run "invalid_env_is_rejected" {
  command = plan

  variables {
    env = "staging"
  }

  expect_failures = [var.env]
}

run "invalid_route_throttle_key_is_rejected" {
  command = plan

  variables {
    route_throttles = {
      "/api/v1/passes" = { rate = 5, burst = 10 }
    }
  }

  expect_failures = [var.route_throttles]
}

# Static HCL scan for facts that plan output does not show.
run "source_scan" {
  command = plan

  assert {
    condition     = length(regexall("(?m)^resource[[:space:]]+\"aws_lambda_permission\"", file("${path.module}/main.tf"))) == 2
    error_message = "Exactly two aws_lambda_permission resources are required."
  }

  assert {
    condition     = length(regexall("(?m)^resource[[:space:]]+\"aws_lambda_function\"", file("${path.module}/main.tf"))) == 2 && length(regexall("(?m)^resource[[:space:]]+\"aws_iam_role\"", file("${path.module}/main.tf"))) == 2
    error_message = "Exactly two Lambdas and two execution roles are required."
  }

  assert {
    condition     = length(regexall("(?m)^resource[[:space:]]+\"aws_api_gateway_stage\"", file("${path.module}/main.tf"))) == 1
    error_message = "Exactly one stage is required."
  }

  assert {
    condition     = !can(regex("(?m)^[^#]*aws_api_gateway_account", file("${path.module}/main.tf"))) && !can(regex("(?m)^[^#]*binary_media_types", file("${path.module}/main.tf")))
    error_message = "The module must not create the account role or set binary_media_types."
  }

  assert {
    condition     = can(regex("templatefile[(]\"[$][{]path[.]module[}]/openapi[.]yaml\"", file("${path.module}/main.tf"))) && length(regexall("(?m)^[[:space:]]*(api_lambda_invoke_arn|passkit_lambda_invoke_arn)[[:space:]]*=", file("${path.module}/main.tf"))) == 2
    error_message = "templatefile must read the contract copy with exactly the two documented variables."
  }

  assert {
    condition     = can(regex("(?s)resource[[:space:]]+\"aws_api_gateway_deployment\".*lifecycle[[:space:]]*[{][[:space:]]*create_before_destroy[[:space:]]*=[[:space:]]*true", file("${path.module}/main.tf")))
    error_message = "The deployment must set create_before_destroy = true."
  }

  assert {
    condition     = !can(regex("(?m)^[[:space:]]*(write|local_file|local_sensitive_file)", file("${path.module}/main.tf"))) && !can(regex("resource[[:space:]]+\"local_file\"", file("${path.module}/main.tf")))
    error_message = "The module must never write the contract copy."
  }
}
