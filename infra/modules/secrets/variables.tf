variable "env" {
  description = "Environment name, dev or prod."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "The env value must be dev or prod."
  }
}

variable "recovery_window_in_days" {
  description = "Recovery window after a secret is deleted. 30 by default; the teardown runbook sets 0 to delete a dev environment secrets at once."
  type        = number
  default     = 30

  validation {
    condition     = var.recovery_window_in_days == 0 || (var.recovery_window_in_days >= 7 && var.recovery_window_in_days <= 30)
    error_message = "The recovery_window_in_days value must be 0 or between 7 and 30."
  }
}
