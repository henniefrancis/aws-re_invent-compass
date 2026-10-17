data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# Alarm topic, encrypted with a customer managed key. The key costs about
# USD 1 a month, which counts against the monthly budget below.
# ---------------------------------------------------------------------------

resource "aws_kms_key" "alarms" {
  description             = "Encrypts the ${local.name_prefix} alarm topic."
  enable_key_rotation     = true
  deletion_window_in_days = 7
  policy                  = local.kms_key_policy
}

resource "aws_kms_alias" "alarms" {
  name          = "alias/${local.name_prefix}-alarms"
  target_key_id = aws_kms_key.alarms.key_id
}

resource "aws_sns_topic" "alarms" {
  name              = "${local.name_prefix}-alarms"
  kms_master_key_id = aws_kms_key.alarms.arn
}

# The owner confirms the subscription once, out of band, with the link AWS
# emails. The address is a sensitive workspace variable and is never output.
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# ---------------------------------------------------------------------------
# Four alarms. Each notifies the topic when it enters the ALARM state.
# Missing data does not breach: a quiet period is not an incident.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name_prefix}-api-5xx"
  alarm_description   = "The Compass API returned server errors."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    ApiName = var.rest_api_name
    Stage   = local.stage_name
  }
}

# API Gateway publishes no throttle count, so this alarm watches the Lambda
# Throttles metric of both functions. API-level 429 responses show in the access
# log status field.
resource "aws_cloudwatch_metric_alarm" "throttles" {
  alarm_name          = "${local.name_prefix}-throttles"
  alarm_description   = "A Compass Lambda function was throttled."
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  metric_query {
    id          = "total"
    expression  = "SUM(METRICS())"
    label       = "Lambda throttles"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = local.lambda_function_names

    content {
      id = "throttles_${metric_query.key}"

      metric {
        namespace   = "AWS/Lambda"
        metric_name = "Throttles"
        period      = 300
        stat        = "Sum"

        dimensions = {
          FunctionName = metric_query.value
        }
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "apns_push_failures" {
  alarm_name          = "${local.name_prefix}-apns-push-failures"
  alarm_description   = "Apple push notifications for passes failed."
  namespace           = local.apns_metric_namespace
  metric_name         = local.apns_metric_name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    Function = local.apns_metric_function
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${local.name_prefix}-lambda-errors"
  alarm_description   = "A Compass Lambda function failed."
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  metric_query {
    id          = "total"
    expression  = "SUM(METRICS())"
    label       = "Lambda errors"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = local.lambda_function_names

    content {
      id = "errors_${metric_query.key}"

      metric {
        namespace   = "AWS/Lambda"
        metric_name = "Errors"
        period      = 300
        stat        = "Sum"

        dimensions = {
          FunctionName = metric_query.value
        }
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Monthly cost budget: 20 USD, alerting at 50, 80 and 100 percent of actual
# spend. The budget emails the owner directly.
# ---------------------------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = local.budget_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = local.budget_alert_percentages

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alarm_email]
    }
  }
}
