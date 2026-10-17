locals {
  name_prefix = "compass-${var.env}"

  # Stage that serves /api/* behind CloudFront. It matches the api module.
  stage_name = "live"

  # Custom metric the passkit Lambda emits (embedded metric format) each time an
  # APNs push fails. The pass-service stream must emit this exact name.
  apns_metric_namespace = "Compass"
  apns_metric_name      = "ApnsPushFailures"

  # Budget (Requirement 8.5 and 8.6).
  budget_limit_usd         = "20"
  budget_alert_percentages = [50, 80, 100]

  lambda_function_names = {
    api     = var.api_lambda_name
    passkit = var.passkit_lambda_name
  }

  account_id = data.aws_caller_identity.current.account_id

  # Customer managed key policy for the alarm topic: the account root keeps
  # administration, and CloudWatch alarms may encrypt for the topic, scoped to
  # this account (Requirement 8.1 and 8.6 design notes).
  kms_key_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountRootAdministration"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AllowCloudWatchAlarmsToPublish"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = ["kms:GenerateDataKey*", "kms:Decrypt"]
        Resource  = "*"
        Condition = {
          StringEquals = { "aws:SourceAccount" = local.account_id }
        }
      },
    ]
  })
}
