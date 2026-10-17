variable "env" {
  description = "Environment name, dev or prod."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "The env value must be dev or prod."
  }
}

variable "alarm_email" {
  description = "Address that receives alarm and budget notifications. Set it as a sensitive HCP workspace variable; it is never committed and never output."
  type        = string
  sensitive   = true

  validation {
    condition     = length(trimspace(var.alarm_email)) > 0
    error_message = "The alarm_email value must not be empty."
  }

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+[.][^@\\s]+$", var.alarm_email))
    error_message = "The alarm_email value must be an email address."
  }
}

variable "table_name" {
  description = "DynamoDB table name. Null selects compass-<env>. Set it only after restoring a table into a new name (see the rollback runbook)."
  type        = string
  default     = null
}

variable "throttle_rate" {
  description = "Stage-wide steady-state request rate limit (requests per second)."
  type        = number
  default     = 50

  validation {
    condition     = var.throttle_rate > 0
    error_message = "The throttle_rate value must be greater than 0."
  }
}

variable "throttle_burst" {
  description = "Stage-wide burst limit (requests)."
  type        = number
  default     = 100

  validation {
    condition     = var.throttle_burst >= 1
    error_message = "The throttle_burst value must be at least 1."
  }
}

variable "route_throttles" {
  description = "Per-route throttle overrides keyed by method path (no leading slash). They are tighter than the stage default for the routes that write or are costly."
  type = map(object({
    rate  = number
    burst = number
  }))
  default = {
    "api/v1/passes/POST"   = { rate = 5, burst = 10 }
    "api/v1/handoffs/POST" = { rate = 5, burst = 10 }
    "api/v1/me/DELETE"     = { rate = 2, burst = 4 }
  }
}

variable "kill_switch_enabled" {
  description = "When true the WAF kill-switch rule blocks every request. See docs/runbooks/kill-switch.md."
  type        = bool
  default     = false
}

variable "api_lambda_zip" {
  description = "Path to the api Lambda package, relative to this directory. scripts/release.sh builds it into infra/build."
  type        = string
  default     = "../../build/api-lambda.zip"
}

variable "passkit_lambda_zip" {
  description = "Path to the passkit Lambda package, relative to this directory. scripts/release.sh builds it into infra/build."
  type        = string
  default     = "../../build/passkit-lambda.zip"
}
