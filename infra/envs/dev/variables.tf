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

variable "public_base_url" {
  description = "Public base URL, https://<distribution>.cloudfront.net with no trailing slash. The distribution depends on the API Lambdas, so this is known only after the first apply: set it from the cloudfront_domain_name output and apply again. Empty omits PUBLIC_BASE_URL."
  type        = string
  default     = ""

  validation {
    condition     = var.public_base_url == "" || can(regex("^https://[a-z0-9.-]+$", var.public_base_url))
    error_message = "The public_base_url value must be empty or an https URL with no path and no trailing slash."
  }
}

variable "event_timezone" {
  description = "IANA time zone of the event, from the Events API GetEvent. Never hard-coded."
  type        = string
}

variable "event_window_start" {
  description = "Event start, ISO 8601 with offset, from GetEvent."
  type        = string
}

variable "event_window_end" {
  description = "Event end, ISO 8601 with offset, from GetEvent."
  type        = string
}

variable "service_version" {
  description = "Version string returned by the health route. scripts/release.sh passes the release version."
  type        = string
  default     = "0.0.0"
}

variable "id_token_verifier" {
  description = "ID token verifier mode, cognito or oidc (spike SP2)."
  type        = string
  default     = "cognito"
}

variable "id_token_issuer" {
  description = "Exact iss claim of the Builder ID ID token (spike SP2)."
  type        = string
}

variable "id_token_jwks_uri" {
  description = "JWKS URI, required in oidc mode (spike SP2). Empty omits the variable."
  type        = string
  default     = ""
}

variable "apns_enabled" {
  description = "Switch for Apple push notifications (spike SP3 fallback)."
  type        = bool
  default     = true
}

variable "apns_push_type" {
  description = "APNs push type, alert or background (spike SP3). Empty omits the variable."
  type        = string
  default     = ""
}

variable "google_wallet_enabled" {
  description = "Switch for Google Wallet (spike SP4)."
  type        = bool
  default     = true
}

variable "google_wallet_class_suffix" {
  description = "Suffix of the Google Wallet class id, the same value scripts/google-wallet-class.mjs uses. Null selects compass-<env>."
  type        = string
  default     = null
}
