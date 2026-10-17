locals {
  name_prefix = "compass-${var.env}"

  api_function_name     = "${local.name_prefix}-api"
  passkit_function_name = "${local.name_prefix}-passkit"

  # Every log group keeps logs for 14 days (Requirements 5.12 and 5.13).
  log_retention_days = 14

  stage_name = "live"

  # Access log format. It records the route template only, through
  # resourcePath, and never the full request path, a source address or any
  # identifier (Requirements 5.7, 5.8 and 17.3). Only request id, route
  # template, method, status, latency and outcome are kept.
  access_log_format = jsonencode({
    requestId          = "$context.requestId"
    routeKey           = "$context.resourcePath"
    httpMethod         = "$context.httpMethod"
    status             = "$context.status"
    responseLatency    = "$context.responseLatency"
    integrationLatency = "$context.integrationLatency"
    outcome            = "$context.error.responseType"
  })

  # Environment for both Lambdas. Names and ARNs only, never a secret value:
  # the Lambdas resolve the secrets at runtime.
  common_environment = {
    COMPASS_ENV    = var.env
    TABLE_NAME     = var.table_name
    APP_SECRET_ARN = var.secret_arns.app
  }

  api_environment = merge(local.common_environment, {
    APPLE_SECRET_ARN  = var.secret_arns.apple
    GOOGLE_SECRET_ARN = var.secret_arns.google
  })

  passkit_environment = merge(local.common_environment, {
    APPLE_SECRET_ARN = var.secret_arns.apple
  })

  lambda_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  # The api Lambda reads and writes pass, hand-off and rate records, reads device
  # registrations to push, and reads all three secrets (it signs Apple passes and
  # patches Google objects).
  api_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteOwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.api_lambda.arn}:*"
      },
      {
        Sid    = "UseTable"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
        ]
        Resource = [var.table_arn, "${var.table_arn}/index/*"]
      },
      {
        Sid      = "ReadSecrets"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = [var.secret_arns.app, var.secret_arns.apple, var.secret_arns.google]
      },
    ]
  })

  # The passkit Lambda serves the Apple PassKit web service: it records device
  # registrations and serves pass bundles. It needs the app and Apple secrets and
  # never the Google key.
  passkit_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteOwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.passkit_lambda.arn}:*"
      },
      {
        Sid    = "UseTable"
        Effect = "Allow"
        Action = [
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
        ]
        Resource = [var.table_arn, "${var.table_arn}/index/*"]
      },
      {
        Sid      = "ReadSecrets"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = [var.secret_arns.app, var.secret_arns.apple]
      },
    ]
  })
}
