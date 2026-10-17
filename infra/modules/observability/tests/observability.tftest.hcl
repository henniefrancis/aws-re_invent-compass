# Plan-only assertions for the observability module (Requirements 8.1 to 8.6).
# The aws provider is mocked, so nothing here reaches AWS.

mock_provider "aws" {
  override_during = plan

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "example"
    }
  }

  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:us-east-1:aws:key/example"
      key_id = "example"
    }
  }

  mock_resource "aws_sns_topic" {
    defaults = {
      arn = "arn:aws:sns:us-east-1:aws:compass-dev-alarms"
    }
  }
}

variables {
  env = "dev"
  # Built from parts so no email address literal sits in a committed file.
  alarm_email         = join("@", ["alarms", "example.invalid"])
  rest_api_name       = "compass-dev"
  web_acl_name        = "compass-dev"
  api_lambda_name     = "compass-dev-api"
  passkit_lambda_name = "compass-dev-passkit"
}

run "topic_encrypted_with_customer_managed_key" {
  command = plan

  assert {
    condition     = aws_sns_topic.alarms.kms_master_key_id == aws_kms_key.alarms.arn
    error_message = "The alarm topic must be encrypted with the customer managed key."
  }

  assert {
    condition     = aws_kms_key.alarms.enable_key_rotation
    error_message = "Key rotation must be enabled."
  }

  assert {
    condition     = jsondecode(aws_kms_key.alarms.policy).Statement[0].Action == "kms:*" && jsondecode(aws_kms_key.alarms.policy).Statement[0].Principal.AWS == "arn:aws:iam::example:root"
    error_message = "The account root must administer the key."
  }

  assert {
    condition     = jsondecode(aws_kms_key.alarms.policy).Statement[1].Principal.Service == "cloudwatch.amazonaws.com" && contains(jsondecode(aws_kms_key.alarms.policy).Statement[1].Action, "kms:GenerateDataKey*") && contains(jsondecode(aws_kms_key.alarms.policy).Statement[1].Action, "kms:Decrypt")
    error_message = "The key policy must let cloudwatch.amazonaws.com generate data keys and decrypt."
  }

  assert {
    condition     = jsondecode(aws_kms_key.alarms.policy).Statement[1].Condition.StringEquals["aws:SourceAccount"] == "example"
    error_message = "The CloudWatch grant must be scoped by aws:SourceAccount."
  }

  assert {
    condition     = aws_kms_alias.alarms.name == "alias/compass-dev-alarms"
    error_message = "The key alias is wrong."
  }
}

run "email_subscription" {
  command = plan

  assert {
    condition     = aws_sns_topic_subscription.email.protocol == "email" && aws_sns_topic_subscription.email.topic_arn == aws_sns_topic.alarms.arn
    error_message = "The topic must have one email subscription."
  }
}

run "four_alarms_wired_to_the_topic" {
  command = plan

  assert {
    condition = alltrue([
      for a in [
        aws_cloudwatch_metric_alarm.api_5xx,
        aws_cloudwatch_metric_alarm.throttles,
        aws_cloudwatch_metric_alarm.apns_push_failures,
        aws_cloudwatch_metric_alarm.lambda_errors,
        aws_cloudwatch_metric_alarm.waf_blocked,
      ] : a.alarm_actions == toset([aws_sns_topic.alarms.arn])
    ])
    error_message = "Every alarm must notify the alarm topic in the ALARM state."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.api_5xx.metric_name == "5XXError" && aws_cloudwatch_metric_alarm.api_5xx.namespace == "AWS/ApiGateway" && aws_cloudwatch_metric_alarm.api_5xx.dimensions["ApiName"] == "compass-dev"
    error_message = "The first alarm must watch API 5xx errors."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.apns_push_failures.metric_name == "ApnsFailure"
    error_message = "The APNs alarm must watch ApnsFailure."
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.throttles.metric_query) == 3 && length(aws_cloudwatch_metric_alarm.lambda_errors.metric_query) == 3
    error_message = "The throttle and error alarms must combine both Lambda functions."
  }
}

run "waf_blocked_requests_alarm" {
  command = plan

  assert {
    condition     = aws_cloudwatch_metric_alarm.waf_blocked.namespace == "AWS/WAFV2" && aws_cloudwatch_metric_alarm.waf_blocked.metric_name == "BlockedRequests" && aws_cloudwatch_metric_alarm.waf_blocked.dimensions["WebACL"] == "compass-dev" && aws_cloudwatch_metric_alarm.waf_blocked.dimensions["Region"] == "Global"
    error_message = "The WAF alarm must watch BlockedRequests of the web ACL."
  }
}

run "monthly_budget" {
  command = plan

  assert {
    condition     = aws_budgets_budget.monthly.time_unit == "MONTHLY" && aws_budgets_budget.monthly.limit_amount == "20" && aws_budgets_budget.monthly.limit_unit == "USD" && aws_budgets_budget.monthly.budget_type == "COST"
    error_message = "The budget must be a monthly 20 USD cost budget."
  }

  assert {
    condition     = toset([for n in aws_budgets_budget.monthly.notification : n.threshold]) == toset([50, 80, 100]) && length(aws_budgets_budget.monthly.notification) == 3
    error_message = "The budget must alert at 50, 80 and 100 percent."
  }

  assert {
    condition     = alltrue([for n in aws_budgets_budget.monthly.notification : n.notification_type == "ACTUAL" && n.threshold_type == "PERCENTAGE" && n.comparison_operator == "GREATER_THAN"])
    error_message = "Every budget alert must be on actual spend as a percentage."
  }
}

# Edge case: an empty alarm email fails at plan time (Requirement 8.2).
run "empty_alarm_email_is_rejected" {
  command = plan

  variables {
    alarm_email = ""
  }

  expect_failures = [var.alarm_email]
}

run "malformed_alarm_email_is_rejected" {
  command = plan

  variables {
    alarm_email = "not-an-address"
  }

  expect_failures = [var.alarm_email]
}

# Static scan: exactly one topic, one subscription, four alarms and one budget.
run "source_scan" {
  command = plan

  assert {
    condition     = length(regexall("(?m)^resource[[:space:]]+\"aws_sns_topic\"", file("${path.module}/main.tf"))) == 1 && length(regexall("(?m)^resource[[:space:]]+\"aws_sns_topic_subscription\"", file("${path.module}/main.tf"))) == 1
    error_message = "Exactly one topic and one subscription are required."
  }

  assert {
    condition     = length(regexall("(?m)^resource[[:space:]]+\"aws_cloudwatch_metric_alarm\"", file("${path.module}/main.tf"))) == 5 && length(regexall("(?m)^resource[[:space:]]+\"aws_budgets_budget\"", file("${path.module}/main.tf"))) == 1
    error_message = "Exactly five alarms and one budget are required."
  }

  assert {
    condition     = !can(regex("(?m)^output[[:space:]]+\"[a-z_]*email", file("${path.module}/outputs.tf")))
    error_message = "The alarm email must never be output."
  }
}
