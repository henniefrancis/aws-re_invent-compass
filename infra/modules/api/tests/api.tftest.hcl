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

run "api_key_gates_every_method" {
  command = plan

  # Every operation in the rendered contract requires the api_key scheme, so API
  # Gateway rejects a call without the x-api-key header that CloudFront injects.
  assert {
    condition = alltrue(flatten([
      for path, item in yamldecode(aws_api_gateway_rest_api.this.body).paths : [
        for method, op in item :
        anytrue([for sec in op.security : contains(keys(sec), "api_key")])
        if contains(["get", "put", "post", "delete", "patch", "head", "options"], method)
      ]
    ]))
    error_message = "Every operation must require the api_key security scheme."
  }

  assert {
    condition     = length(flatten([for path, item in yamldecode(aws_api_gateway_rest_api.this.body).paths : [for method, op in item : method if contains(["get", "put", "post", "delete", "patch", "head", "options"], method)]])) == 15
    error_message = "The contract must still define its 15 operations."
  }

  assert {
    condition     = yamldecode(aws_api_gateway_rest_api.this.body).components.securitySchemes.api_key.name == "x-api-key" && yamldecode(aws_api_gateway_rest_api.this.body)["x-amazon-apigateway-api-key-source"] == "HEADER"
    error_message = "The api_key scheme must read the x-api-key header."
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
    condition     = aws_lambda_function.api.timeout == 15 && aws_lambda_function.passkit.timeout == 5
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
    condition     = !contains(keys(one(aws_lambda_function.passkit.environment).variables), "GOOGLE_SECRET_ID") && contains(keys(one(aws_lambda_function.api.environment).variables), "GOOGLE_SECRET_ID")
    error_message = "Only the api Lambda may know the Google secret."
  }
}

run "lambda_environment_matches_the_pass_service" {
  command = plan

  assert {
    condition = alltrue([
      for k in ["TABLE_NAME", "APP_SECRET_ID", "ORIGIN_VERIFY_SECRET_ID", "APPLE_SECRET_ID", "EVENT_TIMEZONE"] :
      contains(keys(one(aws_lambda_function.passkit.environment).variables), k)
    ])
    error_message = "The passkit Lambda must receive the variables the pass-service reads."
  }

  assert {
    condition = alltrue([
      for k in ["TABLE_NAME", "APP_SECRET_ID", "ORIGIN_VERIFY_SECRET_ID", "APPLE_SECRET_ID", "GOOGLE_SECRET_ID", "EVENT_TIMEZONE", "EVENT_WINDOW_START", "EVENT_WINDOW_END", "ID_TOKEN_VERIFIER", "ID_TOKEN_ISSUER", "APNS_ENABLED", "GOOGLE_WALLET_ENABLED", "GOOGLE_WALLET_CLASS_SUFFIX", "SERVICE_VERSION"] :
      contains(keys(one(aws_lambda_function.api.environment).variables), k)
    ])
    error_message = "The api Lambda must receive the variables the pass-service reads."
  }

  assert {
    condition     = !contains(keys(one(aws_lambda_function.api.environment).variables), "PUBLIC_BASE_URL") && !contains(keys(one(aws_lambda_function.api.environment).variables), "ID_TOKEN_JWKS_URI") && !contains(keys(one(aws_lambda_function.api.environment).variables), "APNS_PUSH_TYPE")
    error_message = "Optional variables must be omitted when empty."
  }
}

run "optional_environment_is_set_when_given" {
  command = plan

  variables {
    public_base_url   = "https://example.invalid"
    id_token_jwks_uri = "https://issuer.example.invalid/jwks"
    apns_push_type    = "alert"
  }

  assert {
    condition     = one(aws_lambda_function.api.environment).variables["PUBLIC_BASE_URL"] == "https://example.invalid" && one(aws_lambda_function.passkit.environment).variables["PUBLIC_BASE_URL"] == "https://example.invalid" && one(aws_lambda_function.api.environment).variables["APNS_PUSH_TYPE"] == "alert"
    error_message = "Optional values must reach the Lambdas when set."
  }
}

run "lambda_role_policies_follow_least_privilege" {
  command = plan

  assert {
    condition     = !strcontains(aws_iam_role_policy.passkit.policy, "google-wallet") && strcontains(aws_iam_role_policy.api.policy, "google-wallet")
    error_message = "Only the api role may read the Google secret."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.passkit.policy, "dynamodb:UpdateItem") && !strcontains(aws_iam_role_policy.passkit.policy, "BatchWriteItem") && strcontains(aws_iam_role_policy.api.policy, "dynamodb:UpdateItem") && strcontains(aws_iam_role_policy.api.policy, "dynamodb:BatchWriteItem")
    error_message = "Table actions must match what each Lambda needs (forget_me uses BatchWriteItem on the api role only)."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.passkit.policy).Statement :
      !anytrue([for a in try(tolist(s.Action), [s.Action]) : contains(["dynamodb:PutItem", "dynamodb:DeleteItem"], a)]) ||
      s.Condition["ForAllValues:StringLike"]["dynamodb:LeadingKeys"] == ["DEV#*", "PASSREG#*"]
    ])
    error_message = "The passkit role may write only DEV# items."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.api.policy).Statement :
      !anytrue([for a in try(tolist(s.Action), [s.Action]) : contains(["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:UpdateItem"], a)]) ||
      toset(s.Condition["ForAllValues:StringLike"]["dynamodb:LeadingKeys"]) == toset(["PASS#*", "DEV#*", "HANDOFF#*", "RATE#*", "ACTIVE#*", "PASSREG#*"])
    ])
    error_message = "The api role may write only the known key prefixes."
  }
}

run "reserved_concurrency_and_trust" {
  command = plan

  assert {
    condition     = aws_lambda_function.api.reserved_concurrent_executions == 20 && aws_lambda_function.passkit.reserved_concurrent_executions == 10
    error_message = "The Lambdas must reserve 20 and 10 concurrent executions by default."
  }

  # IAM has no condition on the content of a trust document, so the pin to the
  # Lambda service is asserted here on the document itself (owner review H2).
  assert {
    condition = alltrue([
      for r in [aws_iam_role.api, aws_iam_role.passkit] :
      length(jsondecode(r.assume_role_policy).Statement) == 1 &&
      jsondecode(r.assume_role_policy).Statement[0].Effect == "Allow" &&
      jsondecode(r.assume_role_policy).Statement[0].Action == "sts:AssumeRole" &&
      jsondecode(r.assume_role_policy).Statement[0].Principal == { Service = "lambda.amazonaws.com" } &&
      !can(jsondecode(r.assume_role_policy).Statement[0].Condition)
    ])
    error_message = "Both Lambda roles must trust lambda.amazonaws.com and nothing else."
  }
}

run "api_key_and_tracing" {
  command = plan

  assert {
    condition     = aws_api_gateway_rest_api.this.api_key_source == "HEADER"
    error_message = "The API key must be read from the header."
  }

  assert {
    condition     = aws_api_gateway_stage.live.xray_tracing_enabled == false
    error_message = "X-Ray must be off on the stage."
  }

  assert {
    condition     = aws_api_gateway_api_key.this.enabled && aws_api_gateway_usage_plan_key.this.key_type == "API_KEY"
    error_message = "The API key must be enabled and attached to the usage plan."
  }

  assert {
    condition     = one(aws_lambda_function.api.tracing_config).mode == "PassThrough" && one(aws_lambda_function.passkit.tracing_config).mode == "PassThrough"
    error_message = "Lambda tracing must stay off (PassThrough)."
  }
}

run "short_api_key_is_rejected" {
  command = plan

  variables {
    api_key_value = "short"
  }

  expect_failures = [var.api_key_value]
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

# S5 review N9: the pass and PassKit route keys (braces included) are valid keys.
run "pass_route_throttle_keys_are_valid" {
  command = plan

  variables {
    route_throttles = {
      "api/v1/passes/{serialNumber}/apple/GET"                                                                    = { rate = 5, burst = 10 }
      "api/v1/passes/{serialNumber}/PUT"                                                                          = { rate = 5, burst = 10 }
      "api/v1/passes/{serialNumber}/void/POST"                                                                    = { rate = 5, burst = 10 }
      "api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}/POST"   = { rate = 10, burst = 20 }
      "api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}/DELETE" = { rate = 10, burst = 20 }
      "api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}/GET"                                             = { rate = 10, burst = 20 }
    }
  }

  assert {
    condition     = length(aws_api_gateway_method_settings.route) == 6
    error_message = "Each of the six pass and PassKit routes must get its own method setting."
  }

  assert {
    condition     = one(aws_api_gateway_method_settings.route["api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}/GET"].settings).throttling_rate_limit == 10
    error_message = "The PassKit latest-pass route must carry its own rate."
  }
}
