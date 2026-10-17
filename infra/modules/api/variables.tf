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
