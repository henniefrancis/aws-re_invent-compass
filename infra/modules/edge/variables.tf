variable "env" {
  description = "Environment name, dev or prod. Prefixes the names of account-wide resources so the two environments never collide."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "The env value must be dev or prod."
  }
}

variable "site_bucket_regional_domain_name" {
  description = "Regional domain name of the private site bucket (from the site module)."
  type        = string

  validation {
    condition     = endswith(var.site_bucket_regional_domain_name, ".amazonaws.com")
    error_message = "The site_bucket_regional_domain_name value must be an S3 regional domain name."
  }
}

variable "oac_id" {
  description = "ID of the CloudFront origin access control for the site bucket (from the site module)."
  type        = string

  validation {
    condition     = length(var.oac_id) > 0
    error_message = "The oac_id value must not be empty."
  }
}

variable "api_stage_invoke_host" {
  description = "Host name of the API Gateway stage that serves /api/*, without a scheme or path (from the api module)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]+[.]execute-api[.][a-z0-9-]+[.]amazonaws[.]com$", var.api_stage_invoke_host))
    error_message = "The api_stage_invoke_host value must be an execute-api host name with no scheme or path."
  }
}

variable "origin_verify_secret_value" {
  description = "Value of the x-origin-verify header sent to the API origin. Supply it as a sensitive HCP variable; the same value is loaded into the app secret by scripts/load-secrets.sh."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.origin_verify_secret_value) >= 32
    error_message = "The origin_verify_secret_value value must be at least 32 characters."
  }
}

variable "api_key_value" {
  description = "Value of the x-api-key header sent to the API origin, so API Gateway rejects a direct call before the Lambda runs. Supply it as a sensitive HCP variable."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.api_key_value) >= 20 && length(var.api_key_value) <= 128
    error_message = "The api_key_value value must be 20 to 128 characters."
  }
}

variable "kill_switch_enabled" {
  description = "When true the WAF kill-switch rule blocks every request. When false the rule only counts."
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Custom domain of the site, /board and the API, for example reinvent-compass.vegas. Null keeps the CloudFront default domain and creates no certificate and no DNS record."
  type        = string
  default     = null

  validation {
    condition     = var.domain_name == null ? true : can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}$", var.domain_name))
    error_message = "The domain_name value must be null or a lowercase DNS name."
  }
}

variable "extra_aliases" {
  description = "Further alias names on the same distribution (none are used today). They need domain_name and sit in the same hosted zone."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for a in var.extra_aliases : can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}$", a))])
    error_message = "Each extra alias must be a lowercase DNS name."
  }

  validation {
    condition     = length(var.extra_aliases) == 0 || var.domain_name != null
    error_message = "extra_aliases needs domain_name."
  }
}

variable "hosted_zone_name" {
  description = "Name of the existing public Route 53 hosted zone that holds the aliases, for example reinvent-compass.vegas. Required with domain_name."
  type        = string
  default     = null

  validation {
    condition     = var.domain_name == null || var.hosted_zone_name != null
    error_message = "hosted_zone_name is required when domain_name is set."
  }

  validation {
    condition = var.domain_name == null || var.hosted_zone_name == null ? true : alltrue([
      for n in concat([var.domain_name], var.extra_aliases) :
      n == var.hosted_zone_name || endswith(n, ".${var.hosted_zone_name}")
    ])
    error_message = "Every alias must be the hosted zone name or a name inside it."
  }
}
