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

  # Environment for the Lambdas, using the variable names the pass-service
  # (S5) reads. Names and ARNs only, never a secret value: the Lambdas resolve
  # the secrets at runtime. Optional values are omitted when empty so the S5
  # defaults apply.
  common_environment = merge(
    {
      TABLE_NAME              = var.table_name
      APP_SECRET_ID           = var.secret_arns.app
      ORIGIN_VERIFY_SECRET_ID = var.secret_arns.origin_verify
      APPLE_SECRET_ID         = var.secret_arns.apple
      EVENT_TIMEZONE          = var.event_timezone
    },
    var.public_base_url == "" ? {} : { PUBLIC_BASE_URL = var.public_base_url },
  )

  api_environment = merge(
    local.common_environment,
    {
      EVENT_WINDOW_START         = var.event_window_start
      EVENT_WINDOW_END           = var.event_window_end
      ID_TOKEN_VERIFIER          = var.id_token_verifier
      ID_TOKEN_ISSUER            = var.id_token_issuer
      APNS_ENABLED               = tostring(var.apns_enabled)
      GOOGLE_WALLET_ENABLED      = tostring(var.google_wallet_enabled)
      GOOGLE_SECRET_ID           = var.secret_arns.google
      GOOGLE_WALLET_CLASS_SUFFIX = var.google_wallet_class_suffix
      SERVICE_VERSION            = var.service_version
    },
    var.id_token_jwks_uri == "" ? {} : { ID_TOKEN_JWKS_URI = var.id_token_jwks_uri },
    var.apns_push_type == "" ? {} : { APNS_PUSH_TYPE = var.apns_push_type },
  )

  passkit_environment = local.common_environment

  lambda_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  # Key prefixes of the single table, from the pass-service data model. Writes
  # are limited to them with dynamodb:LeadingKeys, so a bug or a stolen role
  # cannot write any other item.
  api_write_key_prefixes     = ["PASS#*", "DEV#*", "HANDOFF#*", "RATE#*", "ACTIVE#*", "PASSREG#*"]
  passkit_write_key_prefixes = ["DEV#*", "PASSREG#*"]

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
        Sid      = "ReadTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [var.table_arn, "${var.table_arn}/index/*"]
      },
      {
        Sid      = "WriteTableItems"
        Effect   = "Allow"
        Action   = ["dynamodb:BatchWriteItem", "dynamodb:DeleteItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = var.table_arn
        Condition = {
          "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = local.api_write_key_prefixes }
        }
      },
      {
        Sid      = "ReadSecrets"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = [var.secret_arns.app, var.secret_arns.origin_verify, var.secret_arns.apple, var.secret_arns.google]
      },
    ]
  })

  # The passkit Lambda serves the Apple PassKit web service: it records device
  # registrations and serves pass bundles. It writes only device registration
  # items, needs the app and Apple secrets, and never the Google key.
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
        Sid      = "ReadTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [var.table_arn, "${var.table_arn}/index/*"]
      },
      {
        Sid      = "WriteDeviceRegistrations"
        Effect   = "Allow"
        Action   = ["dynamodb:DeleteItem", "dynamodb:PutItem"]
        Resource = var.table_arn
        Condition = {
          "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = local.passkit_write_key_prefixes }
        }
      },
      {
        Sid      = "ReadSecrets"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = [var.secret_arns.app, var.secret_arns.origin_verify, var.secret_arns.apple]
      },
    ]
  })
}
