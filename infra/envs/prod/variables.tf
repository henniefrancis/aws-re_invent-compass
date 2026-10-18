variable "env" {
  description = "Environment name, dev or prod."
  type        = string
  default     = "prod"

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

    # Attendee pass routes, keyed by the OpenAPI path with the serial number parameter.
    "api/v1/passes/{serialNumber}/apple/GET" = { rate = 5, burst = 10 }
    "api/v1/passes/{serialNumber}/PUT"       = { rate = 5, burst = 10 }
    "api/v1/passes/{serialNumber}/void/POST" = { rate = 5, burst = 10 }

    # Apple PassKit web service routes: register, unregister and latest pass.
    "api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}/POST"   = { rate = 10, burst = 20 }
    "api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}/DELETE" = { rate = 10, burst = 20 }
    "api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}/GET"                                             = { rate = 10, burst = 20 }
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

variable "origin_verify_value" {
  description = "Value of the x-origin-verify header CloudFront sends to the API. Sensitive: supply it as an HCP workspace variable. Generate it locally (see docs/runbooks/secrets.md) and load the same value into the app secret with scripts/load-secrets.sh."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.origin_verify_value) >= 32
    error_message = "The origin_verify_value value must be at least 32 characters."
  }
}

variable "api_key_value" {
  description = "Value of the API key CloudFront sends in x-api-key. Sensitive: supply it as an HCP workspace variable, 20 to 128 characters."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.api_key_value) >= 20 && length(var.api_key_value) <= 128
    error_message = "The api_key_value value must be 20 to 128 characters."
  }
}

variable "api_reserved_concurrency" {
  description = "Reserved concurrency of the api Lambda. Use -1 for none (a new account with a low concurrency quota cannot reserve any)."
  type        = number
  default     = 20
}

variable "passkit_reserved_concurrency" {
  description = "Reserved concurrency of the passkit Lambda. Use -1 for none."
  type        = number
  default     = 10
}

variable "handoff_calendar_enabled" {
  description = "Switch for the hand-off calendar download. See docs/runbooks/alarms.md."
  type        = bool
  default     = true
}

variable "table_deletion_protection" {
  description = "DynamoDB deletion protection. Keep true; only docs/runbooks/teardown.md sets it false."
  type        = bool
  default     = true
}

variable "site_force_destroy" {
  description = "Let Terraform empty and delete the site bucket. Keep false; only docs/runbooks/teardown.md sets it true."
  type        = bool
  default     = false
}

variable "secret_recovery_window_days" {
  description = "Recovery window of the secrets after deletion. Keep 30; only docs/runbooks/teardown.md sets 0."
  type        = number
  default     = 30
}

variable "hosted_zone_name" {
  description = "Name of the existing public Route 53 hosted zone that holds the custom domain."
  type        = string
  default     = "reinvent-compass.vegas"
}

variable "domain_name" {
  description = "Custom domain of the site, /board and the API (prod reinvent-compass.vegas, dev dev.reinvent-compass.vegas). Null keeps the CloudFront default domain, a certificate is then not requested, and public_base_url must be set after the first apply."
  type        = string
  default     = null

  validation {
    condition     = var.domain_name == null ? true : (var.domain_name == var.hosted_zone_name || endswith(var.domain_name, ".${var.hosted_zone_name}"))
    error_message = "The domain_name value must be the hosted zone name or a name inside it."
  }
}

variable "extra_aliases" {
  description = "Further alias names on the same distribution. Null or empty for none (neither environment uses one today). Needs domain_name. Set as an HCL variable in HCP."
  type        = list(string)
  default     = null

  validation {
    condition     = var.extra_aliases == null ? true : alltrue([for a in var.extra_aliases : a == var.hosted_zone_name || endswith(a, ".${var.hosted_zone_name}")])
    error_message = "Every extra alias must be the hosted zone name or a name inside it."
  }

  validation {
    condition     = var.extra_aliases == null ? true : (length(var.extra_aliases) == 0 || var.domain_name != null)
    error_message = "extra_aliases needs domain_name."
  }
}
