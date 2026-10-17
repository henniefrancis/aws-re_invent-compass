# Compass API: an API Gateway REST API imported from the S0 OpenAPI contract,
# fronting two Lambda functions (api and passkit). The contract file is read
# through templatefile() and never written by this module.

# ---------------------------------------------------------------------------
# Lambda execution roles: one per function, each carrying the project
# permissions boundary so the bootstrap apply role may create it.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "api" {
  name                 = "${local.api_function_name}-lambda"
  description          = "Execution role of the Compass api Lambda."
  assume_role_policy   = local.lambda_assume_role_policy
  permissions_boundary = var.permissions_boundary_arn
}

resource "aws_iam_role" "passkit" {
  name                 = "${local.passkit_function_name}-lambda"
  description          = "Execution role of the Compass passkit Lambda."
  assume_role_policy   = local.lambda_assume_role_policy
  permissions_boundary = var.permissions_boundary_arn
}

resource "aws_iam_role_policy" "api" {
  name   = "${local.api_function_name}-lambda"
  role   = aws_iam_role.api.id
  policy = local.api_role_policy
}

resource "aws_iam_role_policy" "passkit" {
  name   = "${local.passkit_function_name}-lambda"
  role   = aws_iam_role.passkit.id
  policy = local.passkit_role_policy
}

# ---------------------------------------------------------------------------
# Log groups, all kept for 14 days
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "api_lambda" {
  name              = "/aws/lambda/${local.api_function_name}"
  retention_in_days = local.log_retention_days
}

resource "aws_cloudwatch_log_group" "passkit_lambda" {
  name              = "/aws/lambda/${local.passkit_function_name}"
  retention_in_days = local.log_retention_days
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${local.name_prefix}-${local.stage_name}-access"
  retention_in_days = local.log_retention_days
}

# ---------------------------------------------------------------------------
# Lambda functions
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "api" {
  function_name = local.api_function_name
  description   = "Compass API: attendee and hand-off routes."
  role          = aws_iam_role.api.arn
  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 512
  timeout       = 10

  reserved_concurrent_executions = var.api_reserved_concurrency

  filename         = var.api_lambda_zip
  source_code_hash = filebase64sha256(var.api_lambda_zip)

  tracing_config {
    mode = "PassThrough"
  }

  environment {
    variables = local.api_environment
  }

  depends_on = [aws_cloudwatch_log_group.api_lambda, aws_iam_role_policy.api]
}

resource "aws_lambda_function" "passkit" {
  function_name = local.passkit_function_name
  description   = "Compass API: Apple PassKit web service routes."
  role          = aws_iam_role.passkit.arn
  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 512
  timeout       = 5

  reserved_concurrent_executions = var.passkit_reserved_concurrency

  filename         = var.passkit_lambda_zip
  source_code_hash = filebase64sha256(var.passkit_lambda_zip)

  tracing_config {
    mode = "PassThrough"
  }

  environment {
    variables = local.passkit_environment
  }

  depends_on = [aws_cloudwatch_log_group.passkit_lambda, aws_iam_role_policy.passkit]
}

# ---------------------------------------------------------------------------
# REST API from the contract
# ---------------------------------------------------------------------------

# templatefile() receives exactly the two documented variables and no others
# (Requirement 5.1). binary_media_types is not set here: the contract's
# x-amazon-apigateway-binary-media-types extension supplies it on import
# (Requirement 5.6).
resource "aws_api_gateway_rest_api" "this" {
  name        = local.name_prefix
  description = "Compass API ${var.env}, imported from the OpenAPI contract."

  body = templatefile("${path.module}/openapi.yaml", {
    api_lambda_invoke_arn     = aws_lambda_function.api.invoke_arn
    passkit_lambda_invoke_arn = aws_lambda_function.passkit.invoke_arn
  })

  # The API key is read from the x-api-key header, which CloudFront injects.
  api_key_source = "HEADER"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# A change to the contract forces a new deployment. The new deployment is
# created before the old one is removed, so the stage always has a deployment.
resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeployment = sha1(aws_api_gateway_rest_api.this.body)
  }

  lifecycle {
    create_before_destroy = true
  }
}

# API Gateway can write the access log only after the account-level CloudWatch
# role exists. That role and aws_api_gateway_account come once from the
# bootstrap configuration, never from here (Requirement 5.14).
resource "aws_api_gateway_stage" "live" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = local.stage_name
  description   = "Live stage served through CloudFront at /api/*."

  # No X-Ray tracing: nothing here may record request detail.
  xray_tracing_enabled = false

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format          = local.access_log_format
  }

  depends_on = [aws_cloudwatch_log_group.access]
}

# Default settings for every method: no request or response data in the
# execution log, metrics on, and the stage-wide throttle (Requirement 5.5).
resource "aws_api_gateway_method_settings" "default" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.live.stage_name
  method_path = "*/*"

  settings {
    logging_level          = "OFF"
    data_trace_enabled     = false
    metrics_enabled        = true
    throttling_rate_limit  = var.throttle_rate
    throttling_burst_limit = var.throttle_burst
  }
}

# Method-level throttle overrides, only where a route needs a tighter limit.
resource "aws_api_gateway_method_settings" "route" {
  for_each = var.route_throttles

  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.live.stage_name
  method_path = each.key

  settings {
    logging_level          = "OFF"
    data_trace_enabled     = false
    metrics_enabled        = true
    throttling_rate_limit  = each.value.rate
    throttling_burst_limit = each.value.burst
  }

  depends_on = [aws_api_gateway_method_settings.default]
}

# ---------------------------------------------------------------------------
# API key: CloudFront sends it in x-api-key so that API Gateway can refuse a
# direct execute-api call before any Lambda runs. A method enforces the key only
# when the contract marks it apiKeyRequired; see design.md (the contract change
# is an S0 request).
# ---------------------------------------------------------------------------

resource "aws_api_gateway_api_key" "this" {
  name    = "${local.name_prefix}-edge"
  enabled = true
  value   = var.api_key_value
}

resource "aws_api_gateway_usage_plan" "this" {
  name = "${local.name_prefix}-edge"

  api_stages {
    api_id = aws_api_gateway_rest_api.this.id
    stage  = aws_api_gateway_stage.live.stage_name
  }

  throttle_settings {
    rate_limit  = var.throttle_rate
    burst_limit = var.throttle_burst
  }
}

resource "aws_api_gateway_usage_plan_key" "this" {
  key_id        = aws_api_gateway_api_key.this.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.this.id
}

# ---------------------------------------------------------------------------
# API Gateway may invoke each Lambda, from this REST API only
# ---------------------------------------------------------------------------

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowRestApiInvokeApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "passkit" {
  statement_id  = "AllowRestApiInvokePasskit"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.passkit.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}
