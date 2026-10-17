variable "env" {
  description = "Environment name, dev or prod."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "The env value must be dev or prod."
  }
}

variable "api_lambda_zip" {
  description = "Path to the api Lambda deployment package (built by scripts/release.sh into infra/build)."
  type        = string

  validation {
    condition     = endswith(var.api_lambda_zip, ".zip")
    error_message = "The api_lambda_zip value must be the path of a .zip file."
  }
}

variable "passkit_lambda_zip" {
  description = "Path to the passkit Lambda deployment package (built by scripts/release.sh into infra/build)."
  type        = string

  validation {
    condition     = endswith(var.passkit_lambda_zip, ".zip")
    error_message = "The passkit_lambda_zip value must be the path of a .zip file."
  }
}

variable "table_name" {
  description = "Name of the DynamoDB table the Lambdas read and write (from the data module)."
  type        = string

  validation {
    condition     = length(var.table_name) >= 3
    error_message = "The table_name value must be at least 3 characters."
  }
}

variable "table_arn" {
  description = "ARN of the DynamoDB table (from the data module), used in the Lambda role policies."
  type        = string

  validation {
    condition     = startswith(var.table_arn, "arn:aws:dynamodb:")
    error_message = "The table_arn value must be a DynamoDB table ARN."
  }
}

variable "secret_arns" {
  description = "ARNs of the three Secrets Manager secrets (from the secrets module)."
  type = object({
    app    = string
    apple  = string
    google = string
  })

  validation {
    condition     = alltrue([for arn in values(var.secret_arns) : startswith(arn, "arn:aws:secretsmanager:")])
    error_message = "Every secret_arns value must be a Secrets Manager ARN."
  }
}

variable "permissions_boundary_arn" {
  description = "ARN of the project permissions boundary policy that every role created here must carry (the bootstrap apply role requires it)."
  type        = string

  validation {
    condition     = startswith(var.permissions_boundary_arn, "arn:aws:iam::") && strcontains(var.permissions_boundary_arn, ":policy/")
    error_message = "The permissions_boundary_arn value must be an IAM policy ARN."
  }
}

variable "api_key_value" {
  description = "Value of the API key that CloudFront sends in x-api-key. Supply it as a sensitive HCP variable."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.api_key_value) >= 20 && length(var.api_key_value) <= 128
    error_message = "The api_key_value value must be 20 to 128 characters."
  }
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
  description = "Optional per-route throttle overrides, keyed by method path such as api/v1/passes/POST. Use them only where a route needs a tighter limit than the stage default."
  type = map(object({
    rate  = number
    burst = number
  }))
  default = {}

  validation {
    condition     = alltrue([for k in keys(var.route_throttles) : can(regex("^[A-Za-z0-9/{}._-]+/(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$", k))])
    error_message = "Each route_throttles key must be a method path such as api/v1/passes/POST (no leading slash)."
  }

  validation {
    condition     = alltrue([for v in values(var.route_throttles) : v.rate > 0 && v.burst >= 1])
    error_message = "Each route_throttles rate must be above 0 and each burst at least 1."
  }
}

variable "public_base_url" {
  description = "Public base URL of the distribution, https://<distribution>.cloudfront.net, with no trailing slash. Empty omits PUBLIC_BASE_URL. The distribution depends on this module, so the value is known only after the first apply: set it from the cloudfront_domain_name output and apply again."
  type        = string
  default     = ""

  validation {
    condition     = var.public_base_url == "" || can(regex("^https://[a-z0-9.-]+$", var.public_base_url))
    error_message = "The public_base_url value must be empty or an https URL with no path and no trailing slash."
  }
}

variable "event_timezone" {
  description = "IANA time zone of the event, from GetEvent."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z]+(/[A-Za-z_+-]+)+$", var.event_timezone))
    error_message = "The event_timezone value must be an IANA zone such as Area/City."
  }
}

variable "event_window_start" {
  description = "Event start, ISO 8601 with offset, from GetEvent."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?(Z|[+-][0-9]{2}:[0-9]{2})$", var.event_window_start))
    error_message = "The event_window_start value must be ISO 8601 with an offset."
  }
}

variable "event_window_end" {
  description = "Event end, ISO 8601 with offset, from GetEvent."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?(Z|[+-][0-9]{2}:[0-9]{2})$", var.event_window_end))
    error_message = "The event_window_end value must be ISO 8601 with an offset."
  }
}

variable "service_version" {
  description = "Version string returned by the health route."
  type        = string
  default     = "0.0.0"

  validation {
    condition     = can(regex("^[A-Za-z0-9._+-]{1,64}$", var.service_version))
    error_message = "The service_version value must be 1 to 64 letters, digits or . _ + -."
  }
}

variable "id_token_verifier" {
  description = "ID token verifier mode, cognito or oidc (spike SP2)."
  type        = string
  default     = "cognito"

  validation {
    condition     = contains(["cognito", "oidc"], var.id_token_verifier)
    error_message = "The id_token_verifier value must be cognito or oidc."
  }
}

variable "id_token_issuer" {
  description = "Exact iss claim of the ID token (spike SP2)."
  type        = string

  validation {
    condition     = startswith(var.id_token_issuer, "https://")
    error_message = "The id_token_issuer value must be an https URL."
  }
}

variable "id_token_jwks_uri" {
  description = "JWKS URI, required in oidc mode (spike SP2). Empty omits ID_TOKEN_JWKS_URI."
  type        = string
  default     = ""

  validation {
    condition     = var.id_token_jwks_uri == "" || startswith(var.id_token_jwks_uri, "https://")
    error_message = "The id_token_jwks_uri value must be empty or an https URL."
  }
}

variable "apns_enabled" {
  description = "Switch for Apple push notifications (spike SP3 fallback)."
  type        = bool
  default     = true
}

variable "apns_push_type" {
  description = "APNs push type, alert or background (spike SP3). Empty omits APNS_PUSH_TYPE."
  type        = string
  default     = ""

  validation {
    condition     = contains(["", "alert", "background"], var.apns_push_type)
    error_message = "The apns_push_type value must be empty, alert or background."
  }
}

variable "google_wallet_enabled" {
  description = "Switch for Google Wallet (spike SP4, cut-list item 10)."
  type        = bool
  default     = true
}

variable "google_wallet_class_suffix" {
  description = "Suffix of the Google Wallet class id created by scripts/google-wallet-class.mjs."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]{1,64}$", var.google_wallet_class_suffix))
    error_message = "The google_wallet_class_suffix value must be 1 to 64 letters, digits or . _ -."
  }
}
