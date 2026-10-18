# One cost budget for the whole account, here and nowhere else. Each environment
# used to create its own account-wide budget, which doubled the alerts for the
# same spend. The budget emails the owner directly.
resource "aws_budgets_budget" "monthly" {
  name         = "compass-account-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = [50, 80, 100]

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alarm_email]
    }
  }
}
